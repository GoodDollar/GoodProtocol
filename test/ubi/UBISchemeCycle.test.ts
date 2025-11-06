import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
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
  let root, acct, claimer1, claimer2, claimer3, signers, nameService, genericCall, ubiScheme: UBIScheme;

  before(async () => {
    [root, acct, claimer1, claimer2, claimer3, ...signers] = await ethers.getSigners();

    const deployedDAO = await loadFixture(createDAO);
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

  it("should deploy the ubi with default cycle of 30 days", async () => {
    expect(await ubiScheme.cycleLength()).to.equal(30);
  });

  it("should not be able to change cycleLength if not avatar", async () => {
    let error = await ubiScheme.setCycleLength(1).catch(e => e);
    expect(error.message).to.have.string("only avatar can call this method");
  });

  it("should be able to change cycleLength if avatar", async () => {
    // initializing the ubi
    let encodedCall = ubiScheme.interface.encodeFunctionData("setCycleLength", [8]);
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
    let encodedCall = firstClaimPool.interface.encodeFunctionData("setUBIScheme", [ubiScheme.address]);

    await genericCall(firstClaimPool.address, encodedCall);
    // await firstClaimPool.start();
  });

  it("should calculate cycle on first day", async () => {
    await increaseTime(2 * ONE_DAY); //make sure

    let balance = await goodDollar.balanceOf(ubiScheme.address);
    let transaction = await (await ubiScheme.connect(claimer1).claim()).wait();
    let cycleLength = await ubiScheme.cycleLength();
    let currentCycle = await ubiScheme.currentCycleLength();
    let dailyAmount = await ubiScheme.dailyUbi();
    expect(currentCycle.toNumber()).to.be.gt(0);
    const cycleEvent = transaction.events.find(e => e.event === "UBICycleCalculated");
    console.log({
      dailyAmount: dailyAmount.toString(),
      event: cycleEvent.args
    });

    expect(cycleEvent.args.day.toNumber()).to.be.a("number");
    expect(cycleEvent.args.pool).to.be.equal(balance);
    expect(cycleEvent.args.cycleLength).to.be.equal(cycleLength);
    expect(cycleEvent.args.dailyUBIPool).to.be.equal(balance.div(cycleLength));
  });

  it("should  have calculated dailyCyclePool and dailyUbi correctly", async () => {
    await ubiScheme.connect(claimer2).claim();
    increaseTime(ONE_DAY);
    let transaction = await ubiScheme.connect(claimer2).claim();
    expect(await goodDollar.balanceOf(claimer2.address).then(_ => _.toNumber())).to.be.equal(
      125 + (await ubiScheme.dailyUbi().then(_ => _.toNumber()))
    ); //first day 125 , second claim 125000 wei daily pool divided by 1000 active users = 125
    expect(await ubiScheme.dailyCyclePool().then(_ => _.toNumber())).to.be.equal(125000);
    expect(await ubiScheme.currentDayInCycle().then(_ => _.toNumber())).to.be.equal(1); //1 day passed
  });

  it("should calculate next cycle even if day passed without claims(setDay)", async () => {
    increaseTime(ONE_DAY * 9);
    expect(await ubiScheme.currentDayInCycle().then(_ => _.toNumber())).to.be.equal(10); //10 days passed total

    const claimerBalanceBefore = await goodDollar.balanceOf(claimer1.address);
    const minActiveUsers = await ubiScheme.minActiveUsers();
    let dailyClaimAmount = (await ubiScheme.dailyCyclePool()).div(minActiveUsers); //initialy we have by default min 1000 active users
    const estimatedUbi = await ubiScheme.estimateNextDailyUBI();
    let totalClaimed = 0;
    const currentDay = (await ubiScheme.currentDay()).toNumber();
    for (let i = currentDay; i >= 0; i--) {
      totalClaimed += (await ubiScheme.claimDay(i)).claimAmount.toNumber();
    }
    let transaction = await (await ubiScheme.connect(claimer1).claim()).wait(); //claims in new ubi cycle
    const cycleEvent = transaction.events.find(e => e.event === "UBICycleCalculated");

    expect(await goodDollar.balanceOf(claimer1.address)).to.be.equal(claimerBalanceBefore.add(dailyClaimAmount)); //intial 10 from first claim pool + daily
    expect(dailyClaimAmount).eq(estimatedUbi);
    expect(cycleEvent).to.be.not.empty;
    expect(await ubiScheme.currentDayInCycle().then(_ => _.toNumber())).to.be.equal(0); //new cycle started
    //intial balance on cycle start 1000000 - 375(3 user that claimed in previous tests) = 99625, divide by cycle length (8) = 124953
    expect(cycleEvent.args.dailyUBIPool).to.be.equal((BigInt(1000000) - BigInt(totalClaimed)) / BigInt(8));
  });

  it("should calculate cycle early if we can increase current daily pool", async () => {
    //increase ubi pool balance
    let encoded = goodDollar.interface.encodeFunctionData("mint", [ubiScheme.address, 400000]);
    await genericCall(goodDollar.address, encoded);
    let balance = await goodDollar.balanceOf(ubiScheme.address);

    const cycleLength = await ubiScheme.cycleLength();
    const curDailyPool = await ubiScheme.dailyCyclePool();

    //verify new daily pool IS gonna be larger than current
    expect(balance.div(cycleLength)).to.be.gt(curDailyPool);

    const estimated = await ubiScheme.estimateNextDailyUBI();
    await increaseTime(ONE_DAY); //make sure
    let transaction = await (await ubiScheme.connect(claimer1).claim()).wait();
    const cycleEvent = transaction.events.find(e => e.event === "UBICycleCalculated");
    const dailyUBI = await ubiScheme.dailyUbi();
    expect(dailyUBI).to.eq(estimated); //the estimated before actual calculation should be correct, ie equal to actual dailyUBI calculated after first claim.
    expect(cycleEvent).to.be.not.empty;
    expect(cycleEvent.args.day.toNumber()).to.be.a("number");
    expect(cycleEvent.args.pool).to.be.equal(balance);
    expect(cycleEvent.args.cycleLength).to.be.equal(cycleLength);
    expect(cycleEvent.args.dailyUBIPool).to.be.equal(balance.div(cycleLength));
  });

  it("should not calculate cycle early if not possible to increase daily ubi pool", async () => {
    //increase ubi pool balance
    let encoded = goodDollar.interface.encodeFunctionData("mint", [ubiScheme.address, 100]);
    await genericCall(goodDollar.address, encoded);
    let balance = await goodDollar.balanceOf(ubiScheme.address);
    const curCycleLen = await ubiScheme.cycleLength();
    const curDailyPool = await ubiScheme.dailyCyclePool();
    //verify new daily pool is not gonna be larger than current
    expect(balance.div(curCycleLen)).to.be.lt(curDailyPool);

    await increaseTime(ONE_DAY); //make sure
    let transaction = await (await ubiScheme.connect(claimer1).claim()).wait();
    const cycleEvent = transaction.events.find(e => e.event === "UBICycleCalculated");
    expect(cycleEvent).to.be.undefined;
  });
});
