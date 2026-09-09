/***
 * Deploy the AdminBurnExecutor and hand it to the guardians for approval.
 *
 * The burn list is fixed at construction time, so what the guardians register is
 * exactly what they audited. Nothing here changes production state: the executor
 * is inert until 5 of 9 guardians sign `registerScheme` in the Safe UI, and it can
 * only burn after that.
 *
 * Requires the SuperGoodDollar implementation with `adminBurn` to already be live
 * (see supergooddollar-admin-burn.ts).
 *
 * Burn list (BURN_LIST, default scripts/upgrades/admin-burn-list.json):
 *   [{ "account": "0x..", "gd": "1234.56", "refundUSD": "78.90", "note": "optional" }]
 *   `gd` is in whole G$ and `refundUSD` in whole USD - both are parsed to 18 decimals.
 *   Raw base units can be given instead as `gdWei` / `refundUSDWei`.
 *
 * Modes (env):
 *   DRY=true        validate the list + preflight balances, deploy nothing
 *   DEPLOY_ONLY=1   deploy + verify, then stop (no Safe proposal)
 *   EXECUTOR=0x..   skip deployment and propose registration for this address
 *   PRINT_ONLY=1    print the raw Safe transaction instead of proposing it
 *   STRICT_SIGNER=1 enforce the repo's canonical deployer address
 */
import fs from "fs";
import path from "path";
import { network, ethers } from "hardhat";
import { execSync } from "child_process";
import { executeViaSafe, executeViaGuardian, printDeploy, verifyProductionSigner } from "../multichain-deploy/helpers";
import dao from "../../releases/deployment.json";

let { name: networkName } = network;
networkName = networkName.replace("-fork", "");

const isSimulation = ["hardhat", "fork", "localhost"].includes(network.name);

// executeViaSafe keys its chainId/RPC off these short names, not the hardhat name.
const SAFE_NETWORK: { [k: string]: string } = {
  "production-celo": "celo",
  "production-xdc": "xdc",
  "production-mainnet": "mainnet",
  production: "fuse"
};

// Controller permission bits: 0x10 == genericCall, nothing else.
const GENERIC_CALL_PERMISSION = "0x00000010";

const DRY = process.env.DRY === "true" || process.env.DRY === "1";
const DEPLOY_ONLY = process.env.DEPLOY_ONLY === "true" || process.env.DEPLOY_ONLY === "1";

export type BurnListItem = {
  account: string;
  gd?: string | number;
  gdWei?: string;
  refundUSD?: string | number;
  refundUSDWei?: string;
  note?: string;
};

/**
 * Parse + validate the burn list. Throws on anything the contract's constructor
 * would reject, so a bad list fails before it costs a deployment.
 */
export const loadBurnList = (file: string) => {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as BurnListItem[];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${file}: expected a non-empty array`);

  const seen = new Set<string>();
  return raw.map((item, i) => {
    const where = `${file}[${i}]`;
    let account: string;
    try {
      account = ethers.utils.getAddress(item.account);
    } catch {
      throw new Error(`${where}: invalid address '${item.account}'`);
    }
    if (seen.has(account.toLowerCase())) throw new Error(`${where}: duplicate account ${account}`);
    seen.add(account.toLowerCase());

    if (item.gd == null && item.gdWei == null) throw new Error(`${where}: missing 'gd' or 'gdWei'`);
    const gdAmount = item.gdWei ? ethers.BigNumber.from(item.gdWei) : ethers.utils.parseEther(String(item.gd));
    if (gdAmount.lte(0)) throw new Error(`${where}: burn amount must be > 0`);

    const refundUSD = item.refundUSDWei
      ? ethers.BigNumber.from(item.refundUSDWei)
      : ethers.utils.parseEther(String(item.refundUSD ?? 0));

    return { account, gdAmount, refundUSD, note: item.note ?? "" };
  });
};

export const deploy = async () => {
  const isProduction = networkName.includes("production");
  const [root] = await ethers.getSigners();
  const release: { [key: string]: any } = dao[networkName];

  if (!release?.GoodDollar) throw new Error(`no GoodDollar in deployment.json for network '${networkName}'`);
  const safeAddress = release.GuardiansSafe;
  if (!safeAddress) throw new Error(`no GuardiansSafe in deployment.json for network '${networkName}'`);

  if (isProduction && process.env.STRICT_SIGNER) verifyProductionSigner(root);

  const listFile = path.resolve(process.env.BURN_LIST || path.join(__dirname, "admin-burn-list.json"));
  const entries = loadBurnList(listFile);
  const totalGD = entries.reduce((a, e) => a.add(e.gdAmount), ethers.constants.Zero);
  const totalUSD = entries.reduce((a, e) => a.add(e.refundUSD), ethers.constants.Zero);

  const supergd = await ethers.getContractAt("SuperGoodDollar", release.GoodDollar);
  const owner = await supergd.owner();

  console.log("=== target ===");
  console.log({
    networkName,
    burnList: listFile,
    token: release.GoodDollar,
    tokenOwner: owner,
    avatar: release.Avatar,
    controller: release.Controller,
    guardiansSafe: safeAddress,
    deployer: root.address,
    deployerBalance: (await ethers.provider.getBalance(root.address)).toString()
  });

  if (owner.toLowerCase() !== release.Avatar.toLowerCase())
    throw new Error(`token owner ${owner} is not the Avatar ${release.Avatar} - adminBurn would revert`);

  // the executor is useless against an implementation that has no adminBurn
  if (!supergd.interface.functions["adminBurn(address,uint256)"])
    throw new Error("local artifacts have no adminBurn(address,uint256) - run `yarn compile`");
  // ...and against a *live* implementation that has no adminBurn either. The
  // proxy would delegate the call into an implementation that reverts, so check
  // the selector is actually present in the deployed code.
  const selector = supergd.interface.getSighash("adminBurn(address,uint256)");
  const liveImpl = await supergd.getCodeAddress();
  const liveCode = await ethers.provider.getCode(liveImpl);
  if (!liveCode.includes(selector.slice(2)))
    throw new Error(
      `live SuperGoodDollar implementation ${liveImpl} has no adminBurn - run supergooddollar-admin-burn.ts first`
    );
  console.log("live implementation:", liveImpl, "(adminBurn present)");

  // ---------------------------------------------------------------- the list
  console.log("\n=== burn list ===");
  const rows: any[] = [];
  let short = 0;
  for (const e of entries) {
    const balance = await supergd.balanceOf(e.account);
    const enough = balance.gte(e.gdAmount);
    if (!enough) short++;
    rows.push({
      account: e.account,
      burnGD: ethers.utils.formatEther(e.gdAmount),
      balanceGD: ethers.utils.formatEther(balance),
      enough,
      refundUSD: ethers.utils.formatEther(e.refundUSD),
      note: e.note
    });
  }
  console.table(rows);
  console.log({
    accounts: entries.length,
    totalBurnGD: ethers.utils.formatEther(totalGD),
    totalRefundUSD: ethers.utils.formatEther(totalUSD),
    totalSupplyGD: ethers.utils.formatEther(await supergd.totalSupply()),
    accountsWithInsufficientBalance: short
  });
  if (short > 0)
    console.warn(
      `WARNING: ${short} account(s) hold less than the listed amount. execute() is all-or-nothing and would revert.`
    );

  if (DRY) return console.log("\nDRY run complete - list validated, nothing deployed.");

  // ---------------------------------------------------------------- deploy
  let executorAddress = process.env.EXECUTOR;
  if (executorAddress) {
    console.log("\n=== using existing executor ===", executorAddress);
    if ((await ethers.provider.getCode(executorAddress)).length <= 2)
      throw new Error(`no code at EXECUTOR ${executorAddress}`);
  } else {
    console.log("\n=== deploying AdminBurnExecutor ===");
    const ctorEntries = entries.map(e => [e.account, e.gdAmount, e.refundUSD]);
    const executor = await ethers
      .deployContract("AdminBurnExecutor", [release.Controller, release.GoodDollar, root.address, ctorEntries])
      .then(printDeploy);
    executorAddress = (executor as any).address;
  }

  const executor = await ethers.getContractAt("AdminBurnExecutor", executorAddress);

  // ---------------------------------------------------------------- preflight
  console.log("\n=== preflight ===");
  const [onChainGD, onChainUSD, count] = await Promise.all([
    executor.totalGDToBurn(),
    executor.totalRefundUSD(),
    executor.entriesCount()
  ]);
  console.log({
    entries: count.toString(),
    totalGDToBurn: ethers.utils.formatEther(onChainGD),
    totalRefundUSD: ethers.utils.formatEther(onChainUSD),
    owner: await executor.owner()
  });
  if (!onChainGD.eq(totalGD) || !onChainUSD.eq(totalUSD) || !count.eq(entries.length))
    throw new Error("deployed executor does not match the local burn list");

  // not registered yet, so canExecute is expected to be false on the scheme check
  const [ok, firstShort] = await executor.canExecute();
  console.log("canExecute (pre-registration):", ok, firstShort !== ethers.constants.AddressZero ? firstShort : "");

  if (!process.env.SKIP_VERIFY && !isSimulation) await verifyExecutor(executorAddress, entries, release);

  if (DEPLOY_ONLY) return console.log("\nDEPLOY_ONLY - executor ready:", executorAddress);

  // ---------------------------------------------------------------- registration
  // genericCall permission only - the executor can not register schemes, upgrade
  // the controller, or move the avatar's funds.
  const registerArgs = ethers.utils.defaultAbiCoder.encode(
    ["address", "bytes32", "bytes4", "address"],
    [executorAddress, ethers.constants.HashZero, GENERIC_CALL_PERMISSION, release.Avatar]
  );

  if (process.env.PRINT_ONLY) {
    const ctrl = await ethers.getContractAt("Controller", release.Controller);
    const safeTxData = ctrl.interface.encodeFunctionData("registerScheme", [
      executorAddress,
      ethers.constants.HashZero,
      GENERIC_CALL_PERMISSION,
      release.Avatar
    ]);
    console.log("\n=== Safe transaction - enter manually in the Safe UI ===");
    console.log("safe      :", safeAddress);
    console.log("to        :", release.Controller, "(Controller)");
    console.log("value     : 0");
    console.log("operation : 0 (CALL)");
    console.log("data      :", safeTxData);
    console.log("\ndecodes to: Controller.registerScheme(");
    console.log("   _scheme     :", executorAddress, "(AdminBurnExecutor)");
    console.log("   _paramsHash : 0x00..00");
    console.log("   _permissions:", GENERIC_CALL_PERMISSION, "(genericCall only)");
    console.log("   _avatar     :", release.Avatar, ")");
    console.log("\nafter signing, run admin-burn-executor-execute.ts with EXECUTOR=" + executorAddress);
    return;
  }

  console.log("\n=== proposing registerScheme ===");
  if (isSimulation) {
    const guardian = await ethers.getImpersonatedSigner(safeAddress);
    await root.sendTransaction({ to: safeAddress, value: ethers.utils.parseEther("1") });
    await executeViaGuardian(
      [release.Controller],
      [0],
      ["registerScheme(address,bytes32,bytes4,address)"],
      [registerArgs],
      guardian,
      networkName
    );
  } else {
    const safeNetwork = SAFE_NETWORK[networkName];
    if (!safeNetwork) throw new Error(`no Safe network mapping for '${networkName}'`);
    await executeViaSafe(
      [release.Controller],
      [0],
      ["registerScheme(address,bytes32,bytes4,address)"],
      [registerArgs],
      safeAddress,
      safeNetwork,
      {},
      true // strict: throw instead of proposing a call that simulates false
    );
  }

  console.log("\nproposed. 5 of 9 guardians must now sign in the Safe UI.");
  console.log("executor:", executorAddress);
  console.log(
    "then run: EXECUTOR=" +
      executorAddress +
      " yarn hardhat run scripts/upgrades/admin-burn-executor-execute.ts --network " +
      network.name
  );
  return executorAddress;
};

/**
 * The constructor takes a dynamic struct array, which the shared verifyContract
 * helper can not express on the command line - hardhat needs a --constructor-args
 * module instead.
 */
const verifyExecutor = async (address: string, entries: any[], release: any) => {
  const argsFile = path.join(__dirname, ".admin-burn-ctor-args.js");
  const args = [
    release.Controller,
    release.GoodDollar,
    (await ethers.getSigners())[0].address,
    entries.map(e => [e.account, e.gdAmount.toString(), e.refundUSD.toString()])
  ];
  fs.writeFileSync(argsFile, `module.exports = ${JSON.stringify(args, null, 2)};\n`);
  const cmd = `yarn hardhat verify --contract contracts/utils/AdminBurnExecutor.sol:AdminBurnExecutor --constructor-args ${argsFile} ${address} --network ${network.name}`;
  console.log("\n=== verifying ===\n" + cmd);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (e) {
    console.warn("verification failed (non-fatal). re-run manually:\n" + cmd);
  }
};

export const main = async () => {
  await deploy();
};
if (process.argv[1].includes("admin-burn-executor-deploy"))
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
