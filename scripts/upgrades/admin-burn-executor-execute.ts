/***
 * Run a registered AdminBurnExecutor: burn the whole list in one transaction and
 * print the refund ledger the burns produced.
 *
 * Prerequisites:
 *  - the SuperGoodDollar implementation with `adminBurn` is live
 *  - guardians have signed `registerScheme(executor, 0x0, 0x00000010, avatar)`
 *  - the signer is the executor's `owner` (the deployer, unless it was changed)
 *
 * Modes (env):
 *   EXECUTOR=0x..   required - the deployed AdminBurnExecutor
 *   DRY=true        preflight + callStatic only, sends no transaction
 *   CANCEL=1        call cancel() instead: drop the permission, burn nothing
 *   OUT=path.json   write the refund ledger to this file (default alongside the script)
 */
import fs from "fs";
import path from "path";
import { network, ethers } from "hardhat";
import dao from "../../releases/deployment.json";

let { name: networkName } = network;
networkName = networkName.replace("-fork", "");

const DRY = process.env.DRY === "true" || process.env.DRY === "1";
const CANCEL = process.env.CANCEL === "true" || process.env.CANCEL === "1";

export const execute = async () => {
  const [root] = await ethers.getSigners();
  const release: { [key: string]: any } = dao[networkName];

  const executorAddress = process.env.EXECUTOR;
  if (!executorAddress) throw new Error("EXECUTOR=0x... is required");
  if ((await ethers.provider.getCode(executorAddress)).length <= 2)
    throw new Error(`no code at EXECUTOR ${executorAddress}`);

  const executor = await ethers.getContractAt("AdminBurnExecutor", executorAddress);
  const supergd = await ethers.getContractAt("SuperGoodDollar", release.GoodDollar);
  const ctrl = await ethers.getContractAt("Controller", release.Controller);

  const [owner, executed, entries, totalGD, totalUSD] = await Promise.all([
    executor.owner(),
    executor.executed(),
    executor.getEntries(),
    executor.totalGDToBurn(),
    executor.totalRefundUSD()
  ]);
  const registered = await ctrl.isSchemeRegistered(executorAddress, release.Avatar);
  const perms = await ctrl.getSchemePermissions(executorAddress, release.Avatar);

  console.log("=== executor ===");
  console.log({
    networkName,
    executor: executorAddress,
    owner,
    signer: root.address,
    executed,
    registered,
    permissions: perms,
    entries: entries.length,
    totalGDToBurn: ethers.utils.formatEther(totalGD),
    totalRefundUSD: ethers.utils.formatEther(totalUSD)
  });

  if (executed) throw new Error("executor has already run - deploy a new one for a new list");
  if (owner.toLowerCase() !== root.address.toLowerCase())
    throw new Error(`signer ${root.address} is not the executor owner ${owner}`);

  if (CANCEL) {
    if (DRY) return console.log("\nDRY - would call cancel() and drop the permission.");
    console.log("\n=== cancel ===");
    const tx = await (await executor.cancel()).wait();
    console.log("cancelled in", tx.transactionHash);
    console.log("still registered:", await ctrl.isSchemeRegistered(executorAddress, release.Avatar));
    return;
  }

  if (!registered)
    throw new Error(`executor is not a registered scheme on the Controller - guardians must sign registerScheme first`);

  // ---------------------------------------------------------------- preflight
  console.log("\n=== preflight ===");
  const [ok, firstShort] = await executor.canExecute();
  const balancesBefore: { [k: string]: any } = {};
  const rows: any[] = [];
  for (const e of entries) {
    const balance = await supergd.balanceOf(e.account);
    balancesBefore[e.account] = balance;
    rows.push({
      account: e.account,
      burnGD: ethers.utils.formatEther(e.gdAmount),
      balanceGD: ethers.utils.formatEther(balance),
      enough: balance.gte(e.gdAmount),
      refundUSD: ethers.utils.formatEther(e.refundUSD)
    });
  }
  console.table(rows);
  console.log("canExecute:", ok, firstShort !== ethers.constants.AddressZero ? `short: ${firstShort}` : "");
  if (!ok)
    throw new Error(
      firstShort !== ethers.constants.AddressZero
        ? `${firstShort} holds less than its listed burn amount - execute() is all-or-nothing`
        : "canExecute() is false - check scheme registration and token ownership"
    );

  const supplyBefore = await supergd.totalSupply();
  await executor.callStatic.execute();
  console.log("execute() simulation: OK");

  if (DRY) return console.log("\nDRY run complete - nothing burned.");

  // ---------------------------------------------------------------- execute
  console.log("\n=== executing ===");
  const receipt = await (await executor.execute()).wait();
  console.log("burned in", receipt.transactionHash, "gas", receipt.gasUsed.toString());

  // ---------------------------------------------------------------- ledger
  const burns = receipt.events
    .filter(e => e.address.toLowerCase() === executorAddress.toLowerCase() && e.event === "AdminBurn")
    .map(e => ({
      account: e.args.account,
      burnedGD: ethers.utils.formatEther(e.args.gdAmount),
      refundUSD: ethers.utils.formatEther(e.args.refundUSD),
      balanceBefore: ethers.utils.formatEther(balancesBefore[e.args.account] ?? 0)
    }));

  const after: any[] = [];
  for (const b of burns)
    after.push({ ...b, balanceAfter: ethers.utils.formatEther(await supergd.balanceOf(b.account)) });
  console.table(after);

  const supplyAfter = await supergd.totalSupply();
  const summary = {
    network: networkName,
    executor: executorAddress,
    txHash: receipt.transactionHash,
    block: receipt.blockNumber,
    accounts: burns.length,
    totalBurnedGD: ethers.utils.formatEther(totalGD),
    totalRefundUSD: ethers.utils.formatEther(totalUSD),
    supplyBefore: ethers.utils.formatEther(supplyBefore),
    supplyAfter: ethers.utils.formatEther(supplyAfter),
    supplyDelta: ethers.utils.formatEther(supplyAfter.sub(supplyBefore)),
    stillRegistered: await ctrl.isSchemeRegistered(executorAddress, release.Avatar),
    refunds: after
  };
  console.log("\n=== summary ===");
  console.log({ ...summary, refunds: `${after.length} entries` });

  if (!supplyBefore.sub(supplyAfter).eq(totalGD))
    console.warn("WARNING: total supply moved by a different amount than burned - other activity in the same block?");
  if (summary.stillRegistered) console.warn("WARNING: executor is still a registered scheme - unregisterSelf failed?");

  // the refund ledger is the input to the off-chain USD compensation process
  const out = path.resolve(process.env.OUT || path.join(__dirname, `admin-burn-refunds-${networkName}.json`));
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log("refund ledger written to", out);
  return summary;
};

export const main = async () => {
  await execute();
};
if (process.argv[1].includes("admin-burn-executor-execute"))
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
