/***
 * Upgrade the SuperGoodDollar (celo) with a transfer blocklist.
 * Upgrade Plan:
 * - deploy the new SuperGoodDollar implementation
 * - call updateCode(impl)
 * - call setBlocked(pool, true) for every known pool in BLOCKED_POOLS
 *
 * Blocked addresses can neither send nor receive G$ via ERC20/ERC677/ERC777
 * (incl. the superfluid host batch operations). Note that superfluid streams settle
 * through the agreement layer: a stream can still credit a blocked address, but that
 * address will not be able to move the funds out.
 *
 * usage: yarn hardhat run scripts/upgrades/supergooddollar-block-pools.ts --network <celo|localhost>
 * pools can also be passed via env: BLOCKED_POOLS=0xaaa,0xbbb
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";

import {
  printDeploy,
  executeViaGuardian,
  executeViaSafe,
  verifyProductionSigner,
  verifyContract
} from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";

let { name: networkName } = network;
networkName = networkName.replace("-fork", "");

// known pools (dex pairs/vaults) to block from sending/receiving G$.
// keep one entry per network, addresses are checksum/lowercase agnostic.
const BLOCKED_POOLS: { [network: string]: string[] } = {
  "production-celo": [],
  "development-celo": [],
  staging: [],
  development: []
};

const getPools = () =>
  (process.env.BLOCKED_POOLS ? process.env.BLOCKED_POOLS.split(",") : BLOCKED_POOLS[networkName] || [])
    .map(_ => _.trim())
    .filter(_ => _.length > 0)
    .map(_ => ethers.utils.getAddress(_));

export const upgrade = async () => {
  const isProduction = networkName.includes("production");
  let [root] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  // simulate on fork
  if (network.name === "localhost") {
    await root.sendTransaction({
      to: "0xecA109A2686F074c9461bcb05656b19EF61FbC9e",
      value: ethers.constants.WeiPerEther
    });
    root = await ethers.getImpersonatedSigner("0xecA109A2686F074c9461bcb05656b19EF61FbC9e");
    networkName = "production-celo";
  }

  const release: { [key: string]: any } = dao[networkName];

  defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

  const pools = getPools();
  if (pools.length === 0) {
    throw new Error(
      `no pools to block for ${networkName}, fill BLOCKED_POOLS in the script or pass BLOCKED_POOLS=0x..,0x.. env`
    );
  }

  const supergd = await ethers.getContractAt("SuperGoodDollar", release.GoodDollar);
  const owner = await supergd.owner();
  const host = await supergd.getHost();

  console.log({
    networkName,
    root: root.address,
    supergd: supergd.address,
    owner,
    host,
    pools
  });

  const impl = (await ethers.deployContract("SuperGoodDollar", [host]).then(printDeploy)) as Contract;

  await verifyContract(impl.address, "contracts/token/superfluid/SuperGoodDollar.sol:SuperGoodDollar", networkName);

  const proposalContracts = [release.GoodDollar, ...pools.map(() => release.GoodDollar)];
  const proposalEthValues = proposalContracts.map(() => 0);
  const proposalFunctionSignatures = ["updateCode(address)", ...pools.map(() => "setBlocked(address,bool)")];
  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [impl.address]),
    ...pools.map(pool => ethers.utils.defaultAbiCoder.encode(["address", "bool"], [pool, true]))
  ];

  if (isProduction) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      "0xecA109A2686F074c9461bcb05656b19EF61FbC9e",
      "celo"
    );
  } else {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      root,
      networkName
    );
  }

  // sanity check (works on fork/local after execution, on production after the safe tx is executed)
  for (const pool of pools) {
    console.log("isBlocked", pool, await supergd.isBlocked(pool).catch(e => e.message));
  }
};

export const main = async () => {
  await upgrade().catch(console.log);
};

if (process.argv[1].includes("supergooddollar-block-pools")) main();
