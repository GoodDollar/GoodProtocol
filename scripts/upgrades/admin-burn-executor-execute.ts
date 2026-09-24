/***
 * Run a registered AdminBurnExecutor and print the refund ledger it produced.
 *
 * Two modes:
 *  - default: `execute()` burns the pending part of the constructor list. Entries
 *    that fail are skipped and the scheme permission is kept, so this can be
 *    re-run for the leftovers. The permission is given up only once the whole
 *    list has burned.
 *  - FREE_LIST: `burn(accounts, amounts)` burns a freely supplied list for
 *    whatever the constructor list missed. This is terminal - the executor gives
 *    up its permission when it returns, so run it last.
 *
 * Prerequisites:
 *  - the SuperGoodDollar implementation with `adminBurn` is live
 *  - guardians have signed `registerScheme(executor, 0x0, 0x00000010, avatar)`
 *  - the signer is the executor's `owner` (the deployer, unless it was changed)
 *
 * Modes (env):
 *   EXECUTOR=0x..     required - the deployed AdminBurnExecutor
 *   DRY=true          preflight + callStatic only, sends no transaction
 *   FREE_LIST=p.json  call burn() with this list instead of execute() (terminal).
 *                     Same format as the deploy burn list; refundUSD is ignored
 *                     on-chain (burn() emits it as 0) but is kept in the ledger.
 *   CANCEL=1          call cancel() instead: drop the permission, burn nothing
 *   OUT=path.json     write the refund ledger here (default alongside the script)
 */
import fs from "fs";
import path from "path";
import { network, ethers } from "hardhat";
import { loadBurnList } from "./admin-burn-executor-deploy";
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

  const [owner, relinquished, isComplete, entries, burnedEntries, totalGD, totalUSD, burnedSoFar] = await Promise.all([
    executor.owner(),
    executor.relinquished(),
    executor.complete(),
    executor.getEntries(),
    executor.burnedEntries(),
    executor.totalGDToBurn(),
    executor.totalRefundUSD(),
    executor.totalGDBurned()
  ]);
  const registered = await ctrl.isSchemeRegistered(executorAddress, release.Avatar);
  const perms = await ctrl.getSchemePermissions(executorAddress, release.Avatar);

  const freeListFile = process.env.FREE_LIST && path.resolve(process.env.FREE_LIST);
  const freeList = freeListFile ? loadBurnList(freeListFile) : null;

  console.log("=== executor ===");
  console.log({
    networkName,
    executor: executorAddress,
    mode: CANCEL ? "cancel()" : freeList ? "burn() [terminal]" : "execute()",
    owner,
    signer: root.address,
    relinquished,
    complete: isComplete,
    registered,
    permissions: perms,
    entries: entries.length,
    entriesBurned: `${burnedEntries.toString()}/${entries.length}`,
    totalGDToBurn: ethers.utils.formatEther(totalGD),
    totalGDBurnedSoFar: ethers.utils.formatEther(burnedSoFar),
    totalRefundUSD: ethers.utils.formatEther(totalUSD)
  });

  if (relinquished) throw new Error("executor has given up its permission - deploy a new one");
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
    throw new Error("executor is not a registered scheme on the Controller - guardians must sign registerScheme first");
  if (!freeList && isComplete)
    throw new Error("constructor list is fully burned - use FREE_LIST=... if more accounts need burning");

  // ---------------------------------------------------------------- preflight
  // what this run will actually attempt: the pending constructor entries, or
  // the free list
  const targets = freeList
    ? freeList.map(e => ({ account: e.account, gdAmount: e.gdAmount, refundUSD: e.refundUSD }))
    : (await executor.pendingEntries()).map(e => ({
        account: e.account,
        gdAmount: e.gdAmount,
        refundUSD: e.refundUSD
      }));

  console.log("\n=== preflight ===");
  const balancesBefore: { [k: string]: any } = {};
  const rows: any[] = [];
  let short = 0;
  for (const t of targets) {
    const balance = await supergd.balanceOf(t.account);
    balancesBefore[t.account] = balance;
    const enough = balance.gte(t.gdAmount);
    if (!enough) short++;
    rows.push({
      account: t.account,
      burnGD: ethers.utils.formatEther(t.gdAmount),
      balanceGD: ethers.utils.formatEther(balance),
      enough,
      refundUSD: ethers.utils.formatEther(t.refundUSD)
    });
  }
  console.table(rows);

  const [ok, firstShort] = await executor.canExecute();
  console.log("canExecute:", ok, firstShort !== ethers.constants.AddressZero ? `short: ${firstShort}` : "");
  if (!freeList && !ok)
    throw new Error("canExecute() is false - check scheme registration, token ownership and relinquished state");
  if (short > 0)
    console.warn(
      `WARNING: ${short} of ${targets.length} account(s) hold less than their listed amount. ` +
        (freeList
          ? "burn() skips them and still gives up the permission - they can not be retried with this executor."
          : "execute() skips them and keeps the permission, so it can be re-run later.")
    );

  const supplyBefore = await supergd.totalSupply();
  const sim = freeList
    ? await executor.callStatic.burn(
        freeList.map(e => e.account),
        freeList.map(e => e.gdAmount)
      )
    : await executor.callStatic.execute();
  console.log("simulation:", {
    burnedNow: sim.burnedNow.toString(),
    failedNow: sim.failedNow.toString()
  });
  if (sim.burnedNow.eq(0)) console.warn("WARNING: simulation burns nothing at all");

  if (DRY) return console.log("\nDRY run complete - nothing burned.");

  // ---------------------------------------------------------------- execute
  console.log("\n=== burning ===");
  const receipt = await (
    await (freeList
      ? executor.burn(
          freeList.map(e => e.account),
          freeList.map(e => e.gdAmount)
        )
      : executor.execute())
  ).wait();
  console.log("burned in", receipt.transactionHash, "gas", receipt.gasUsed.toString());

  // ---------------------------------------------------------------- ledger
  const own = (e: any) => e.address.toLowerCase() === executorAddress.toLowerCase();
  const burns = receipt.events.filter(e => own(e) && e.event === "AdminBurn");
  const failures = receipt.events.filter(e => own(e) && e.event === "BurnFailed");

  const ledger: any[] = [];
  for (const e of burns)
    ledger.push({
      account: e.args.account,
      burnedGD: ethers.utils.formatEther(e.args.gdAmount),
      // burn() has no refund data on-chain; fall back to the free list
      refundUSD: ethers.utils.formatEther(
        e.args.refundUSD.gt(0) ? e.args.refundUSD : freeList?.find(f => f.account === e.args.account)?.refundUSD ?? 0
      ),
      balanceBefore: ethers.utils.formatEther(balancesBefore[e.args.account] ?? 0),
      balanceAfter: ethers.utils.formatEther(await supergd.balanceOf(e.args.account))
    });
  console.table(ledger);

  if (failures.length) {
    console.warn(`\n${failures.length} account(s) failed:`);
    console.table(
      failures.map(e => ({
        account: e.args.account,
        gdAmount: ethers.utils.formatEther(e.args.gdAmount),
        reason: e.args.reason
      }))
    );
  }

  const supplyAfter = await supergd.totalSupply();
  const burnedThisRun = burns.reduce((a, e) => a.add(e.args.gdAmount), ethers.constants.Zero);
  const summary = {
    network: networkName,
    executor: executorAddress,
    mode: freeList ? "burn" : "execute",
    freeList: freeListFile ?? null,
    txHash: receipt.transactionHash,
    block: receipt.blockNumber,
    burned: burns.length,
    failed: failures.length,
    burnedThisRunGD: ethers.utils.formatEther(burnedThisRun),
    totalGDBurned: ethers.utils.formatEther(await executor.totalGDBurned()),
    entriesBurned: `${(await executor.burnedEntries()).toString()}/${entries.length}`,
    listComplete: await executor.complete(),
    supplyBefore: ethers.utils.formatEther(supplyBefore),
    supplyAfter: ethers.utils.formatEther(supplyAfter),
    supplyDelta: ethers.utils.formatEther(supplyAfter.sub(supplyBefore)),
    relinquished: await executor.relinquished(),
    stillRegistered: await ctrl.isSchemeRegistered(executorAddress, release.Avatar),
    refunds: ledger,
    failures: failures.map(e => ({
      account: e.args.account,
      gdAmount: ethers.utils.formatEther(e.args.gdAmount),
      reason: e.args.reason
    }))
  };

  console.log("\n=== summary ===");
  console.log({ ...summary, refunds: `${ledger.length} entries`, failures: `${failures.length} entries` });

  if (!supplyBefore.sub(supplyAfter).eq(burnedThisRun))
    console.warn("WARNING: total supply moved by a different amount than burned - other activity in the same block?");
  if (summary.relinquished && summary.stillRegistered)
    console.warn("WARNING: permission relinquished but the scheme is still registered - unregisterSelf failed?");
  if (!summary.relinquished)
    console.log(
      `\npermission retained: ${failures.length} entry(ies) still pending. ` +
        `Re-run once resolved, or use FREE_LIST=... to finish and give up the permission.`
    );

  // the refund ledger is the input to the off-chain USD compensation process
  const out = path.resolve(
    process.env.OUT || path.join(__dirname, `admin-burn-refunds-${networkName}-${receipt.blockNumber}.json`)
  );
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
