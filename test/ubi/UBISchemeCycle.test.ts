import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { UBIScheme } from "../../types";
import { createDAO, deployUBI, advanceBlocks, increaseTime } from "../helpers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

const MAX_INACTIVE_DAYS = 3;
const ONE_DAY = 86400;

describe("UBIScheme cycle", () => {
  let goodDollar, firstClaimPool;
  let reputation;
  let root,
    acct,
    claimer1,
    claimer2,
    claimer3,
    signers,
    nameService,
    genericCall,
    ubiScheme: UBIScheme;

  before(async () => {
    [
      root,
      acct,
      claimer1,
      claimer2,
      claimer3,
      ...signers
    ] = await ethers.getSigners();

    const deployedDAO = await createDAO();
    let {
      nameService: ns,
      genericCall: gn,
      reputation: rep,
      setDAOAddress,
      setSchemes,
      addWhitelisted,
      gd
    } = deployedDAO;
    nameService = ns;
    genericCall = gn;
    reputation = rep;

    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    let ubi = await deployUBI(deployedDAO);

    ubiScheme = ubi.ubiScheme as UBIScheme;
    firstClaimPool = ubi.firstClaim;

    // setDAOAddress("GDAO_CLAIMERS", cd.address);
    addWhitelisted(claimer1.address, "claimer1");
    await addWhitelisted(claimer2.address, "claimer2");
    // await increaseTime(60 * 60 * 24);
  });

  it("should deploy the ubi with default cycle of 90 days", async () => {
    expect(await ubiScheme.cycleLength()).to.equal(90);
  });

  it("should not be able to change cycleLength if not avatar", async () => {
    let error = await ubiScheme.setCycleLength(1).catch(e => e);
    expect(error.message).to.have.string("only avatar can call this method");
  });

  it("should be able to change cycleLength if avatar", async () => {
    // initializing the ubi
    let encodedCall = ubiScheme.interface.encodeFunctionData("setCycleLength", [
      8
    ]);
    await genericCall(ubiScheme.address, encodedCall);
    expect(await ubiScheme.cycleLength()).to.be.equal(8);
  });

  it("should start the ubi cycle at noon", async () => {
    const newUbi = await firstClaimPool.ubi();
    let periodStart = await ubiScheme.periodStart().then(_ => _.toNumber());
    let startDate = new Date(periodStart * 1000);
    expect(startDate.toISOString()).to.have.string("T12:00:00.000Z");
    expect(newUbi.toString()).to.be.equal(ubiScheme.address);
  });

  it("should set ubischeme", async () => {
    // initializing the ubi
    let encodedCall = firstClaimPool.interface.encodeFunctionData(
      "setUBIScheme",
      [ubiScheme.address]
    );

    await genericCall(firstClaimPool.address, encodedCall);
    // await firstClaimPool.start();
  });

  it("should calculate cycle on first day", async () => {
    await increaseTime(ONE_DAY + 10); //make sure
    let transaction = await (await ubiScheme.connect(claimer1).claim()).wait();
    await ubiScheme.connect(claimer2).claim();
    let cycleLength = await ubiScheme.cycleLength();
    let currentCycle = await ubiScheme.currentCycleLength();
    let balance = await goodDollar.balanceOf(ubiScheme.address);
    expect(currentCycle.toNumber()).to.be.gt(0);
    const cycleEvent = transaction.events.find(
      e => e.event === "UBICycleCalculated"
    );
    expect(cycleEvent.args.day.toNumber()).to.be.a("number");
    expect(cycleEvent.args.pool).to.be.equal(balance);
    expect(cycleEvent.args.cycleLength).to.be.equal(cycleLength);
    expect(cycleEvent.args.dailyUBIPool).to.be.equal(balance.div(cycleLength));
  });

  it("should  have calculated dailyCyclePool and dailyUbi correctly", async () => {
    increaseTime(ONE_DAY);
    let transaction = await ubiScheme.connect(claimer2).claim();
    expect(
      await goodDollar.balanceOf(claimer2.address).then(_ => _.toNumber())
    ).to.be.equal(1000 + (await ubiScheme.dailyUbi().then(_ => _.toNumber()))); //first day 10G$ (1000 wei), second claim 125000 wei daily pool divided by 2 active users = 625000
    expect(
      await ubiScheme.dailyCyclePool().then(_ => _.toNumber())
    ).to.be.equal(125000);
    expect(
      await ubiScheme.currentDayInCycle().then(_ => _.toNumber())
    ).to.be.equal(1); //1 day passed
  });

  it("should calculate next cycle even if day passed without claims(setDay)", async () => {
    increaseTime(ONE_DAY * 9);
    expect(
      await ubiScheme.currentDayInCycle().then(_ => _.toNumber())
    ).to.be.equal(10); //10 days passed total
    let transaction = await (await ubiScheme.connect(claimer1).claim()).wait(); //claims in new ubi cycle
    expect(
      await goodDollar.balanceOf(claimer1.address).then(_ => _.toNumber())
    ).to.be.equal(
      1000 + 58593 //58 amount of new ubicycle
    );
    const cycleEvent = transaction.events.find(
      e => e.event === "UBICycleCalculated"
    );

    expect(cycleEvent).to.be.not.empty;

    expect(
      await ubiScheme.currentDayInCycle().then(_ => _.toNumber())
    ).to.be.equal(0); //new cycle started
    expect(cycleEvent.args.dailyUBIPool).to.be.equal(117187); //pool balance: (1000000 - 62500 given to first claimer) divided by 8 days - only first claimer got 62500 in first cycle
  });

  it("should calculate cycle early if  (currentBalance > 1.3 * openBalance[prevDay]) and currentBalance > 80% of current cycle starting balance", async () => {
    //increase ubi pool balance
    let encoded = goodDollar.interface.encodeFunctionData("mint", [
      ubiScheme.address,
      400000
    ]);
    await genericCall(goodDollar.address, encoded);
    let balance = await goodDollar.balanceOf(ubiScheme.address);

    await increaseTime(ONE_DAY); //make sure
    let transaction = await (await ubiScheme.connect(claimer1).claim()).wait();
    let cycleLength = await ubiScheme.cycleLength();
    let currentCycle = await ubiScheme.currentCycleLength();
    const cycleEvent = transaction.events.find(
      e => e.event === "UBICycleCalculated"
    );
    expect(cycleEvent.args.day.toNumber()).to.be.a("number");
    expect(cycleEvent.args.pool).to.be.equal(balance);
    expect(cycleEvent.args.cycleLength).to.be.equal(cycleLength);
    expect(cycleEvent.args.dailyUBIPool).to.be.equal(balance.div(cycleLength));
  });

  it("should not calculate cycle early if only currentBalance > 80% of current cycle starting balanc", async () => {
    //increase ubi pool balance
    let encoded = goodDollar.interface.encodeFunctionData("mint", [
      ubiScheme.address,
      100000
    ]);
    await genericCall(goodDollar.address, encoded);
    let balance = await goodDollar.balanceOf(ubiScheme.address);
    const curCycleLen = await ubiScheme.currentCycleLength();
    const curDailyUbi = await ubiScheme.dailyUbi();
    const cycleStartingBalance = curCycleLen.mul(curDailyUbi);

    //pass one condition
    expect(balance).to.be.gt(cycleStartingBalance.mul(80).div(100));

    //dont pass other condition
    const curCycle = await ubiScheme.dailyUBIHistory(
      await ubiScheme.currentDay()
    );
    expect(balance).to.be.lt(curCycle.openAmount.mul(130).div(100));

    await increaseTime(ONE_DAY); //make sure
    let transaction = await (await ubiScheme.connect(claimer1).claim()).wait();
    const cycleEvent = transaction.events.find(
      e => e.event === "UBICycleCalculated"
    );
    expect(cycleEvent).to.be.undefined;
  });

  it("should not calculate cycle early if  only currentBalance > 1.3 * openBalance[prevDay])", async () => {
    for (let i = 0; i < 13; i++) {
      await increaseTime(ONE_DAY); //make sure
      await ubiScheme.connect(claimer1).claim();
      await ubiScheme.connect(claimer2).claim();
    }
    //increase ubi pool balance
    let encoded = goodDollar.interface.encodeFunctionData("mint", [
      ubiScheme.address,
      55000
    ]);
    await genericCall(goodDollar.address, encoded);
    let balance = await goodDollar.balanceOf(ubiScheme.address);
    const curCycle = await ubiScheme.dailyUBIHistory(
      await ubiScheme.currentDay()
    );

    //verify we pass 1 condition for early cycle
    expect(balance).to.be.gt(curCycle.openAmount.mul(130).div(100));

    //dont pass second condition
    const curCycleLen = await ubiScheme.currentCycleLength();
    const curDailyUbi = await ubiScheme.dailyUbi();
    const cycleStartingBalance = curCycleLen.mul(curDailyUbi);
    expect(balance).to.be.lt(cycleStartingBalance.mul(80).div(100));

    await increaseTime(ONE_DAY); //make sure
    let transaction = await (await ubiScheme.connect(claimer1).claim()).wait();
    const cycleEvent = transaction.events.find(
      e => e.event === "UBICycleCalculated"
    );
    expect(cycleEvent).to.be.undefined;
  });
});
