/***
 * Upgrade the celo SuperGoodDollar with a transfer blocklist and block the known pools.
 *
 * The token's owner (DEFAULT_ADMIN_ROLE) is the Avatar, so both calls must originate from
 * the Avatar via Controller.genericCall. executeViaSafe wraps each call as
 *   Controller.genericCall(GoodDollar, <calldata>, Avatar, 0)
 * and proposes the batch to the GuardiansSafe, which is the registered scheme allowed to
 * call genericCall (verified on celo mainnet: permissions 0x1f).
 *
 * Proposal:
 *  1. GoodDollar.updateCode(newImpl)
 *  2. GoodDollar.setBlocked(pools, true)
 * Both land in a single Safe transaction and execute atomically in that order.
 *
 * NOTE: genericCall returns (bool success, bytes) and does NOT revert when the inner call
 * fails - a proposal can execute "successfully" while doing nothing. Hence the pre-flight
 * simulation below and the post-execution verification at the end.
 *
 * usage: see the commands at the bottom of this file.
 */

import fs from "fs";
import path from "path";
import { network, ethers } from "hardhat";
import { Contract } from "ethers";

import {
  printDeploy,
  executeViaGuardian,
  executeViaSafe,
  verifyProductionSigner,
  verifyContract
} from "../multichain-deploy/helpers";

import dao from "../../releases/deployment.json";

let { name: networkName } = network;
networkName = networkName.replace("-fork", "");

// pools and their blocked flag are read from a file, not hardcoded.
// default: scripts/upgrades/blocked-pools.json, override with POOLS_FILE=path/to/file.{json,csv}
//
// json, per network - a group flag:
//   { "production-celo": { "blocked": true, "pools": ["0xaaa", "0xbbb"] } }
// or a flag per entry (lets one run block some and unblock others):
//   { "production-celo": [{ "address": "0xaaa", "blocked": true },
//                         { "address": "0xbbb", "blocked": false }] }
// or the shorthand, which means blocked: true:
//   { "production-celo": ["0xaaa"] }
// a flat top level array / object is also accepted and applies to any network.
//
// csv: address[,blocked][,label] - one pool per line. the second column is the flag when
//   it is literally true/false, otherwise it is treated as a label and the flag defaults
//   to true. lines starting with # and a header row are skipped.
const DEFAULT_POOLS_FILE = path.join(__dirname, "blocked-pools.json");

type PoolEntry = { address: string; blocked: boolean };

const toBool = (value: any, file: string): boolean => {
  if (typeof value === "boolean") return value;
  const asString = String(value).trim().toLowerCase();
  if (asString === "true") return true;
  if (asString === "false") return false;
  throw new Error(`invalid "blocked" value in ${file}: "${value}" (expected true or false)`);
};

const parseCsv = (raw: string, file: string): PoolEntry[] => {
  const rows = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"))
    .map(line => line.split(",").map(cell => cell.trim()));

  // drop a header row, but only the first row - every other row must be a valid
  // address so that a typo is an error rather than a silently skipped pool
  if (rows.length && !ethers.utils.isAddress(rows[0][0])) rows.shift();

  return rows.map(([address, second]) => {
    const isFlag = second !== undefined && ["true", "false"].includes(second.toLowerCase());
    return { address, blocked: isFlag ? toBool(second, file) : true };
  });
};

const parseJson = (raw: string, net: string, file: string): PoolEntry[] => {
  const parsed = JSON.parse(raw);

  // a flat array or a { blocked, pools } object applies to every network
  let forNetwork = Array.isArray(parsed) || parsed.pools !== undefined ? parsed : parsed[net];
  if (forNetwork === undefined) {
    throw new Error(`${file} has no entry for network "${net}" (found: ${Object.keys(parsed).join(", ")})`);
  }

  // { blocked, pools } - one flag for the whole group
  if (!Array.isArray(forNetwork)) {
    if (!Array.isArray(forNetwork.pools)) throw new Error(`${file} entry for "${net}" has no "pools" array`);
    const blocked = toBool(forNetwork.blocked, file);
    return forNetwork.pools.map(address => ({ address, blocked }));
  }

  // an array of addresses, or of { address, blocked }
  return forNetwork.map(entry =>
    typeof entry === "string"
      ? { address: entry, blocked: true }
      : { address: entry.address, blocked: toBool(entry.blocked, file) }
  );
};

export const getPools = (net: string): PoolEntry[] => {
  const file = process.env.POOLS_FILE || DEFAULT_POOLS_FILE;
  if (!fs.existsSync(file)) throw new Error(`pools file not found: ${file}`);

  const raw = fs.readFileSync(file, "utf8");
  const entries = file.toLowerCase().endsWith(".csv") ? parseCsv(raw, file) : parseJson(raw, net, file);

  const pools = entries.map(({ address, blocked }) => {
    const trimmed = String(address ?? "").trim();
    if (!ethers.utils.isAddress(trimmed)) {
      throw new Error(`invalid address in ${file}: "${trimmed}" (bad checksum? try all-lowercase)`);
    }
    return { address: ethers.utils.getAddress(trimmed), blocked };
  });

  const addresses = pools.map(_ => _.address);
  const duplicates = addresses.filter((a, i) => addresses.indexOf(a) !== i);
  if (duplicates.length) throw new Error(`duplicate pools in ${file}: ${[...new Set(duplicates)].join(", ")}`);

  console.log(
    `loaded ${pools.length} pools from ${file}:`,
    pools.map(_ => `${_.address} blocked=${_.blocked}`)
  );
  return pools;
};

export const upgrade = async () => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");
  const isForkSimulation = network.name === "localhost" || network.name === "fork";

  // on a fork we run against the production-celo deployment
  let networkEnv = isForkSimulation ? "production-celo" : networkName;
  const release: { [key: string]: any } = dao[networkEnv];

  // if (isProduction && !isForkSimulation) verifyProductionSigner(root);

  let guardian = root;
  if (isForkSimulation) {
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);
    await root.sendTransaction({
      to: guardian.address,
      value: ethers.constants.WeiPerEther.mul(3)
    });
  }

  const pools = getPools(networkEnv);
  if (pools.length === 0) {
    throw new Error(`no pools to block for ${networkEnv}, add them to the pools file first`);
  }

  // one setBlocked call per flag, so a file can block some pools and unblock others
  const groups = [true, false]
    .map(blocked => ({ blocked, addresses: pools.filter(_ => _.blocked === blocked).map(_ => _.address) }))
    .filter(group => group.addresses.length > 0);

  const supergd = await ethers.getContractAt("SuperGoodDollar", release.GoodDollar);
  const owner = await supergd.owner();
  const host = await supergd.getHost();

  console.log({
    networkName,
    networkEnv,
    isProduction,
    isForkSimulation,
    signer: root.address,
    guardiansSafe: release.GuardiansSafe,
    controller: release.Controller,
    avatar: release.Avatar,
    goodDollar: supergd.address,
    owner,
    host,
    pools: pools.length
  });

  // the whole plan depends on the Avatar being the token owner
  if (owner.toLowerCase() !== release.Avatar.toLowerCase()) {
    throw new Error(`token owner ${owner} is not the Avatar ${release.Avatar}, genericCall will not work`);
  }

  // fail fast on a broke / wrong deployer instead of half way through the run
  const gasPrice = (await ethers.provider.getGasPrice()).mul(11).div(10); // +10% headroom
  const balance = await ethers.provider.getBalance(root.address);
  const estimatedCost = gasPrice.mul(6_000_000); // the implementation deploy is ~5.4M gas
  console.log("deployer:", {
    address: root.address,
    balance: ethers.utils.formatEther(balance),
    gasPriceGwei: ethers.utils.formatUnits(gasPrice, "gwei"),
    estimatedDeployCost: ethers.utils.formatEther(estimatedCost)
  });
  if (balance.lt(estimatedCost)) {
    throw new Error(
      `deployer ${root.address} has ${ethers.utils.formatEther(balance)} but the deploy needs about ` +
        `${ethers.utils.formatEther(estimatedCost)} - fund it, or set DEPLOYER_KEY in .env to the intended deployer`
    );
  }

  const impl = (await ethers.deployContract("SuperGoodDollar", [host]).then(printDeploy)) as Contract;

  if (!isForkSimulation) {
    // the constructor takes the superfluid host - without it etherscan rejects the source
    await verifyContract(
      impl.address,
      "contracts/token/superfluid/SuperGoodDollar.sol:SuperGoodDollar",
      networkEnv,
      false,
      host
    );
  }

  const proposalContracts = [release.GoodDollar, ...groups.map(() => release.GoodDollar)];
  const proposalEthValues = proposalContracts.map(() => 0);
  const proposalFunctionSignatures = ["updateCode(address)", ...groups.map(() => "setBlocked(address[],bool)")];
  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [impl.address]),
    ...groups.map(group =>
      ethers.utils.defaultAbiCoder.encode(["address[]", "bool"], [group.addresses, group.blocked])
    )
  ];

  // encode every call twice: the inner call on the token, and the genericCall wrapper that
  // the guardians safe actually sends to the Controller. printed so the batch can also be
  // proposed by hand in the safe UI, and reused for the simulation below.
  const ctrl = await ethers.getContractAt("Controller", release.Controller);
  // provider-connected copy: ethers v5 rejects a "from" override on a signer-connected contract
  const ctrlRead = ctrl.connect(ethers.provider);
  const encodeInner = (i: number) =>
    ethers.utils.solidityPack(
      ["bytes4", "bytes"],
      [
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes(proposalFunctionSignatures[i])).slice(0, 10),
        proposalFunctionInputs[i]
      ]
    );

  const txs = proposalFunctionSignatures.map((sig, i) => {
    const inner = encodeInner(i);
    return {
      sig,
      target: proposalContracts[i],
      inner,
      genericCall: ctrl.interface.encodeFunctionData("genericCall", [
        proposalContracts[i],
        inner,
        release.Avatar,
        0
      ])
    };
  });

  console.log("\n================ safe transaction batch ================");
  console.log("new SuperGoodDollar implementation:", impl.address);
  txs.forEach((tx, i) => {
    console.log(`\n--- tx #${i + 1}: ${tx.sig} ---`);
    console.log("  inner call on the token");
    console.log("    target:", tx.target, "(GoodDollar)");
    console.log("    data:  ", tx.inner);
    console.log("  what the safe sends (genericCall wrapper)");
    console.log("    to:    ", ctrl.address, "(Controller)");
    console.log("    value: ", 0);
    console.log("    data:  ", tx.genericCall);
  });
  console.log("\n========================================================\n");

  // pre-flight: updateCode must simulate green. setBlocked can not be simulated against
  // mainnet state because the currently deployed implementation has no such function -
  // it only becomes callable after tx #1 in the same batch.
  const sim = await ctrlRead.callStatic
    .genericCall(release.GoodDollar, txs[0].inner, release.Avatar, 0, { from: release.GuardiansSafe })
    .catch(e => ["revert: " + e.message]);
  console.log("updateCode genericCall simulation:", sim[0]);
  if (sim[0] !== true) throw new Error("updateCode simulation failed, aborting");

  if (isProduction && !isForkSimulation) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "celo"
    );
    console.log("\nproposed to the guardians safe - verify isBlocked() after the guardians execute it");
  } else {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv
    );

    // genericCall swallows inner reverts, so verify the end state explicitly
    for (const pool of pools) {
      const onchain = await supergd.isBlocked(pool.address);
      console.log("isBlocked", pool.address, onchain, "expected", pool.blocked);
      if (onchain !== pool.blocked) throw new Error(`pool ${pool.address} is ${onchain}, expected ${pool.blocked}`);
    }
    console.log("upgrade + blocklist verified");
  }
};

export const main = async () => {
  await upgrade().catch(e => {
    console.error(e);
    process.exit(1);
  });
};

if (process.argv[1].includes("supergooddollar-block-pools")) main();
