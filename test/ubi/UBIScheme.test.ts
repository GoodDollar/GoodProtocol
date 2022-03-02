import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { UBIScheme } from "../../types";
import { createDAO, deployUBI, advanceBlocks, increaseTime } from "../helpers";
import FirstClaimPool from "@gooddollar/goodcontracts/stakingModel/build/contracts/FirstClaimPool.json";
const BN = ethers.BigNumber;
export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

const MAX_INACTIVE_DAYS = 3;
const ONE_DAY = 86400;

describe("UBIScheme", () => {
  let goodDollar,
    identity,
    formula,
    avatar,
    ubi,
    controller,
    firstClaimPool,
    setSchemes,
    addWhitelisted;
  let reputation;
  let root,
    claimer1,
    claimer2,
    claimer3,
    claimer4,
    claimer5,
    claimer6,
    claimer7,
    signers,
    fisherman,
    nameService,
    genericCall,
    ubiScheme;

  before(async () => {
    [
      root,
      claimer1,
      claimer2,
      claimer3,
      claimer4,
      claimer5,
      claimer6,
      claimer7,
      fisherman,
      ...signers
    ] = await ethers.getSigners();
    const fcFactory = new ethers.ContractFactory(
      FirstClaimPool.abi,
      FirstClaimPool.bytecode,
      (await ethers.getSigners())[0]
    );
    const deployedDAO = await createDAO();
    let {
      nameService: ns,
      genericCall: gn,
      reputation: rep,
      setDAOAddress,
      setSchemes: sc,
      identityDeployed: id,
      addWhitelisted: aw,
      gd,
      avatar: av
    } = deployedDAO;
    nameService = ns;
    genericCall = gn;
    reputation = rep;
    setSchemes = sc;
    avatar = av;
    addWhitelisted = aw;
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    firstClaimPool = await fcFactory.deploy(
      await nameService.getAddress("AVATAR"),
      await nameService.getAddress("IDENTITY"),
      100
    );
    identity = id;
    // setDAOAddress("GDAO_CLAIMERS", cd.address);
    //addWhitelisted(claimer1.address, "claimer1");
    //await addWhitelisted(claimer2.address, "claimer2");
    // await increaseTime(60 * 60 * 24);
  });

  it("should not accept 0 inactive days in the constructor", async () => {
    let ubi1 = await (await ethers.getContractFactory("UBIScheme")).deploy();

    await expect(
      ubi1.initialize(nameService.address, firstClaimPool.address, 0)
    ).revertedWith("Max inactive days cannot be zero");
  });

  it("should deploy the ubi", async () => {
    const block = await ethers.provider.getBlock("latest");
    const startUBI = block.timestamp;
    ubi = await upgrades.deployProxy(
      await ethers.getContractFactory("UBIScheme"),
      [nameService.address, firstClaimPool.address, 14]
    );
    const periodStart = await ubi.periodStart();
    // initializing the ubi
    let encodedCall = ubi.interface.encodeFunctionData("setCycleLength", [1]);
    await genericCall(ubi.address, encodedCall); // we should set cyclelength to one cause this tests was implemented according to it
    expect(periodStart.mod(60 * 60 * 24)).to.equal(60 * 60 * 12);
  });

  it("should not be able to set the claim amount if the sender is not the avatar", async () => {
    let error = await firstClaimPool.setClaimAmount(200).catch(e => e);
    expect(error.message).to.have.string("only Avatar");
  });

  it("should not be able to set the ubi scheme if the sender is not the avatar", async () => {
    let error = await firstClaimPool.setUBIScheme(ubi.address).catch(e => e);
    expect(error.message).to.have.string("only Avatar");
  });

  it("should start the ubi", async () => {
    await setSchemes([ubi.address]);
    // await ubi.start();
    const block = await ethers.provider.getBlock("latest");
    const startUBI = block.timestamp;
    const newUbi = await firstClaimPool.ubi();
    let periodStart = await ubi.periodStart().then(_ => _.toNumber());
    let startDate = new Date(periodStart * 1000);
    expect(startDate.toISOString()).to.have.string("T12:00:00.000Z"); //contract set itself to start at noon GMT
    expect(newUbi).to.be.equal(ethers.constants.AddressZero);
    await increaseTime(ONE_DAY / 2); // increase time half of the day to make sure ubi period started
  });

  it("should not be able to execute claiming when the caller is not whitelisted", async () => {
    let error = await ubi.claim().catch(e => e);
    expect(error.message).to.have.string("UBIScheme: not whitelisted");
  });

  it("should not be able to claim when the claim pool is not active", async () => {
    await addWhitelisted(claimer1.address, "claimer1");
    let error = await ubi
      .connect(claimer1)
      .claim()
      .catch(e => e);
    expect(error.message).to.have.string("is not active");
  });

  it("should set the ubi scheme by avatar", async () => {
    let encodedCall = firstClaimPool.interface.encodeFunctionData(
      "setUBIScheme",
      [NULL_ADDRESS]
    );
    await genericCall(firstClaimPool.address, encodedCall);
    const newUbi = await firstClaimPool.ubi();
    expect(newUbi.toString()).to.be.equal(NULL_ADDRESS);
  });

  it("should not be able to claim when the ubi is not initialized", async () => {
    await setSchemes([firstClaimPool.address]);
    await firstClaimPool.start();
    let error = await ubi
      .connect(claimer1)
      .claim()
      .catch(e => e);
    expect(error.message).to.have.string("ubi has not initialized");

    // initializing the ubi
    let encodedCall = firstClaimPool.interface.encodeFunctionData(
      "setUBIScheme",
      [ubi.address]
    );
    await genericCall(firstClaimPool.address, encodedCall);
  });

  it("should not be able to call award user if the caller is not the ubi", async () => {
    let error = await firstClaimPool.awardUser(claimer1.address).catch(e => e);
    expect(error.message).to.have.string("Only UBIScheme can call this method");
  });

  it("should award a new user with 0 on first time execute claim if the first claim contract has no balance", async () => {
    let tx = await (await ubi.connect(claimer1).claim()).wait();
    let claimer1Balance = await goodDollar.balanceOf(claimer1.address);
    expect(claimer1Balance.toNumber()).to.be.equal(0);

    expect(tx.events.find(_ => _.event === "ActivatedUser")).to.be.not.empty;
    expect(tx.events.find(_ => _.event === "UBIClaimed")).to.be.not.empty;
  });

  it("should award a new user with the award amount on first time execute claim", async () => {
    await goodDollar.mint(firstClaimPool.address, "10000000");
    await addWhitelisted(claimer2.address, "claimer2");
    let transaction = await (await ubi.connect(claimer2).claim()).wait();
    let activeUsersCount = await ubi.activeUsersCount();
    let claimer2Balance = await goodDollar.balanceOf(claimer2.address);
    expect(claimer2Balance.toNumber()).to.be.equal(100);
    expect(activeUsersCount.toNumber()).to.be.equal(2);
    expect(transaction.events.find(_ => _.event === "ActivatedUser")).to.be.not
      .empty;
  });

  it("should updates the daily stats when a new user is getting an award", async () => {
    await addWhitelisted(claimer3.address, "claimer3");
    const currentDay = await ubi.currentDay();
    const amountOfClaimersBefore = await ubi.getClaimerCount(
      currentDay.toString()
    );
    const claimAmountBefore = await ubi.getClaimAmount(currentDay.toString());
    await ubi.connect(claimer3).claim();
    const amountOfClaimersAfter = await ubi.getClaimerCount(
      currentDay.toString()
    );
    const claimAmountAfter = await ubi.getClaimAmount(currentDay.toString());
    expect(
      amountOfClaimersAfter.sub(amountOfClaimersBefore).toString()
    ).to.be.equal("1");
    expect(claimAmountAfter.sub(claimAmountBefore).toString()).to.be.equal(
      "100"
    );
  });

  it("should not be able to fish a new user", async () => {
    let error = await ubi
      .connect(fisherman)
      .fish(claimer1.address)
      .catch(e => e);
    expect(error.message).to.have.string("is not an inactive user");
  });

  it("should not initiate the scheme balance and distribution formula when a new user execute claim", async () => {
    let balance = await goodDollar.balanceOf(ubi.address);
    let dailyUbi = await ubi.dailyUbi();
    expect(balance.toString()).to.be.equal("0");
    expect(dailyUbi.toString()).to.be.equal("0");
  });

  it("should returns a valid distribution calculation when the current balance is lower than the number of daily claimers", async () => {
    // there is 0.01 gd and 2 claimers
    // this is an edge case
    await goodDollar.mint(ubi.address, "1");
    await increaseTime(ONE_DAY);
    await ubi.connect(claimer1).claim();
    await ubi.connect(claimer2).claim();
    let ubiBalance = await goodDollar.balanceOf(ubi.address);
    await increaseTime(ONE_DAY);
    let dailyUbi = await ubi.dailyUbi();
    let claimer1Balance = await goodDollar.balanceOf(claimer1.address);
    expect(ubiBalance.toString()).to.be.equal("1");
    expect(dailyUbi.toString()).to.be.equal("0");
    expect(claimer1Balance.toString()).to.be.equal("0");
  });

  it("should calculate the daily distribution and withdraw balance from the dao when an active user executes claim", async () => {
    // checking that the distirbution works ok also when not all claimers claim
    // achieving that goal by leaving the claimed amount of the second claimer
    // in the ubi and in the next day after transferring the balances from the
    // dao, making sure that the tokens that have not been claimed are
    // taken by the formula as expected.
    let encoded = goodDollar.interface.encodeFunctionData("transfer", [
      signers[0].address,
      "1000"
    ]);

    await genericCall(goodDollar.address, encoded); // There is 10gd initially allocated to avatar so I send it to another address for further transactions
    let encodedCall = ubi.interface.encodeFunctionData(
      "setShouldWithdrawFromDAO",
      [true]
    );
    await genericCall(ubi.address, encodedCall); // we should set cyclelength to one cause this tests was implemented according to it
    const currentDay = await ubi.currentDayInCycle().then(_ => _.toNumber());
    await increaseTime(ONE_DAY);
    await goodDollar.mint(avatar, "901");
    //ubi will have 902GD in pool so daily ubi is now 902/1(cycle)/3(claimers) = 300
    await ubi.connect(claimer1).claim();
    await increaseTime(ONE_DAY);
    await goodDollar.mint(avatar, "1");
    //daily ubi is 0 since only 1 GD is in pool and can't be divided
    // an edge case
    await ubi.connect(claimer1).claim();
    let avatarBalance = await goodDollar.balanceOf(avatar);
    let claimer1Balance = await goodDollar.balanceOf(claimer1.address);
    expect(avatarBalance.toString()).to.be.equal("0");
    // 300 GD from first day and 201 from the second day claimed in this test
    expect(claimer1Balance.toString()).to.be.equal("501");
  });

  it("should return the reward value for entitlement user", async () => {
    let amount = await ubi.connect(claimer4)["checkEntitlement()"]();
    let claimAmount = await firstClaimPool.claimAmount();
    expect(amount.toString()).to.be.equal(claimAmount.toString());
  });

  it("should return that a new user is not an active user", async () => {
    let isActiveUser = await ubi.isActiveUser(claimer7.address);
    expect(isActiveUser).to.be.false;
  });

  it("should not be able to fish an active user", async () => {
    await addWhitelisted(claimer4.address, "claimer4");
    await ubi.connect(claimer3).claim();
    await ubi.connect(claimer4).claim();
    let isActiveUser = await ubi.isActiveUser(claimer4.address);
    let error = await ubi
      .connect(fisherman)
      .fish(claimer4.address)
      .catch(e => e);
    expect(isActiveUser).to.be.true;
    expect(error.message).to.have.string("is not an inactive use");
  });

  it("should not be able to execute claim twice a day", async () => {
    await goodDollar.mint(avatar, "20");
    await increaseTime(ONE_DAY);
    let claimer4Balance1 = await goodDollar.balanceOf(claimer4.address);
    await ubi.connect(claimer4).claim();
    let claimer4Balance2 = await goodDollar.balanceOf(claimer4.address);
    let dailyUbi = await ubi.dailyUbi();
    await ubi.connect(claimer4).claim();
    let claimer4Balance3 = await goodDollar.balanceOf(claimer4.address);
    expect(
      claimer4Balance2.toNumber() - claimer4Balance1.toNumber()
    ).to.be.equal(dailyUbi.toNumber());
    expect(
      claimer4Balance3.toNumber() - claimer4Balance1.toNumber()
    ).to.be.equal(dailyUbi.toNumber());
  });

  it("should return the daily ubi for entitlement user", async () => {
    // claimer3 hasn't claimed during that interval so that user
    // may have the dailyUbi
    let amount = await ubi.connect(claimer3)["checkEntitlement()"]();
    let dailyUbi = await ubi.dailyUbi();
    expect(amount.toString()).to.be.equal(dailyUbi.toString());
  });
  it("should return 0 for entitlement if the user has already claimed for today", async () => {
    await ubi.connect(claimer4).claim();
    let amount = await ubi.connect(claimer4)["checkEntitlement()"]();
    expect(amount.toString()).to.be.equal("0");
  });

  it("should be able to fish inactive user", async () => {
    await goodDollar.mint(avatar, "20");
    await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY * 14);
    let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4.address);
    let isFishedBefore = await ubi.fishedUsersAddresses(claimer1.address);
    let tx = await (await ubi.connect(claimer4).fish(claimer1.address)).wait();
    let isFishedAfter = await ubi.fishedUsersAddresses(claimer1.address);
    let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4.address);
    let dailyUbi = await ubi.dailyUbi();
    expect(isFishedBefore).to.be.false;
    expect(isFishedAfter).to.be.true;
    expect(tx.events.find(_ => _.event === "InactiveUserFished")).to.be.not
      .empty;
    expect(
      claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
    ).to.be.equal(dailyUbi.toNumber());
  });

  it("should not be able to fish the same user twice", async () => {
    await goodDollar.mint(avatar, "200");
    await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY);
    let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4.address);
    let isFishedBefore = await ubi.fishedUsersAddresses(claimer1.address);
    let error = await ubi
      .connect(claimer4)
      .fish(claimer1.address)
      .catch(e => e);
    let isFishedAfter = await ubi.fishedUsersAddresses(claimer1.address);
    let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4.address);
    expect(error.message).to.have.string("already fished");
    expect(isFishedBefore).to.be.true;
    expect(isFishedAfter).to.be.true;
    expect(claimer4BalanceAfter.toNumber()).to.be.equal(
      claimer4BalanceBefore.toNumber()
    );
  });
  it("should be able to fish multiple user", async () => {
    await goodDollar.mint(avatar, "20");
    await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY);
    let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4.address);
    let tx = await (
      await ubi
        .connect(claimer4)
        .fishMulti([claimer2.address, claimer3.address])
    ).wait();
    let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4.address);
    let dailyUbi = await ubi.dailyUbi();
    const totalFishedEvent = tx.events.find(e => e.event === "TotalFished");
    expect(tx.events.find(e => e.event === "InactiveUserFished")).to.be.not
      .empty;
    expect(
      claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
    ).to.be.equal(2 * dailyUbi.toNumber());
    expect(totalFishedEvent.args.total.toNumber() === 2).to.be.true;
  });

  it("should not be able to remove an active user that no longer whitelisted", async () => {
    await goodDollar.mint(avatar, "20");
    await ubi.connect(claimer2).claim(); // makes sure that the user is active
    await identity.removeWhitelisted(claimer2.address);
    let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4.address);
    let isFishedBefore = await ubi.fishedUsersAddresses(claimer2.address);
    let error = await ubi
      .connect(claimer4)
      .fish(claimer2.address)
      .catch(e => e);
    let isFishedAfter = await ubi.fishedUsersAddresses(claimer2.address);
    let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4.address);
    expect(error.message).to.have.string("is not an inactive user");
    expect(isFishedBefore).to.be.false;
    expect(isFishedAfter).to.be.false;
    expect(claimer4BalanceAfter.toNumber()).to.be.equal(
      claimer4BalanceBefore.toNumber()
    );
  });

  it("should be able to remove an inactive user that no longer whitelisted", async () => {
    await goodDollar.mint(avatar, "20");
    await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY * 14);
    let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4.address);
    let isFishedBefore = await ubi.fishedUsersAddresses(claimer2.address);
    let tx = await (await ubi.connect(claimer4).fish(claimer2.address)).wait();
    let isFishedAfter = await ubi.fishedUsersAddresses(claimer2.address);
    let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4.address);
    let dailyUbi = await ubi.dailyUbi();
    expect(isFishedBefore).to.be.false;
    expect(isFishedAfter).to.be.true;
    expect(tx.events.find(e => e.event === "InactiveUserFished")).to.be.not
      .empty;
    expect(
      claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
    ).to.be.equal(dailyUbi.toNumber());
  });

  it("should be able to fish user that removed from the whitelist", async () => {
    await goodDollar.mint(avatar, "20");
    await identity.addWhitelisted(claimer2.address);
    await ubi.connect(claimer2).claim();
    await increaseTime(MAX_INACTIVE_DAYS * ONE_DAY * 14);
    await identity.removeWhitelisted(claimer2.address);
    let claimer4BalanceBefore = await goodDollar.balanceOf(claimer4.address);
    let isFishedBefore = await ubi.fishedUsersAddresses(claimer2.address);
    let tx = await (await ubi.connect(claimer4).fish(claimer2.address)).wait();
    let isFishedAfter = await ubi.fishedUsersAddresses(claimer2.address);
    let claimer4BalanceAfter = await goodDollar.balanceOf(claimer4.address);
    let dailyUbi = await ubi.dailyUbi();
    expect(isFishedBefore).to.be.false;
    expect(isFishedAfter).to.be.true;
    expect(tx.events.find(e => e.event === "InactiveUserFished")).to.be.not
      .empty;
    expect(
      claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
    ).to.be.equal(dailyUbi.toNumber());
  });

  it("should recieves a claim reward on claim after removed and added again to the whitelist", async () => {
    let isFishedBefore = await ubi.fishedUsersAddresses(claimer2.address);
    let activeUsersCountBefore = await ubi.activeUsersCount();
    await identity.addWhitelisted(claimer2.address);
    let claimerBalanceBefore = await goodDollar.balanceOf(claimer2.address);
    await ubi.connect(claimer2).claim();
    let claimerBalanceAfter = await goodDollar.balanceOf(claimer2.address);
    let isFishedAfter = await ubi.fishedUsersAddresses(claimer2.address);
    let activeUsersCountAfter = await ubi.activeUsersCount();
    expect(isFishedBefore).to.be.true;
    expect(isFishedAfter).to.be.false;
    expect(
      activeUsersCountAfter.toNumber() - activeUsersCountBefore.toNumber()
    ).to.be.equal(1);
    expect(
      claimerBalanceAfter.toNumber() - claimerBalanceBefore.toNumber()
    ).to.be.equal(100);
  });

  it("distribute formula should return correct value", async () => {
    await goodDollar.mint(avatar, "20");
    await increaseTime(ONE_DAY);
    let ubiBalance = await goodDollar.balanceOf(ubi.address);
    let avatarBalance = await goodDollar.balanceOf(avatar);
    let activeUsersCount = await ubi.activeUsersCount();
    let claimer4BalanceBefore = await goodDollar.balanceOf(claimer2.address);
    await ubi.connect(claimer2).claim();
    let claimer4BalanceAfter = await goodDollar.balanceOf(claimer2.address);
    expect(
      ubiBalance.add(avatarBalance).div(activeUsersCount).toNumber()
    ).to.be.equal(
      claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
    );
  });

  it("distribute formula should return correct value while gd has transferred directly to the ubi", async () => {
    await goodDollar.mint(ubi.address, "200");
    await increaseTime(ONE_DAY);
    let ubiBalance = await goodDollar.balanceOf(ubi.address);
    let avatarBalance = await goodDollar.balanceOf(avatar);
    let activeUsersCount = await ubi.activeUsersCount();
    let claimer4BalanceBefore = await goodDollar.balanceOf(claimer2.address);
    await ubi.connect(claimer2).claim();
    let claimer4BalanceAfter = await goodDollar.balanceOf(claimer2.address);
    let dailyUbi = await ubi.dailyUbi();
    expect(
      ubiBalance.add(avatarBalance).div(activeUsersCount).toNumber()
    ).to.be.equal(
      claimer4BalanceAfter.toNumber() - claimer4BalanceBefore.toNumber()
    );
    expect(
      ubiBalance.add(avatarBalance).div(activeUsersCount).toNumber()
    ).to.be.equal(dailyUbi.toNumber());
  });

  it("should calcualte the correct distribution formula and transfer the correct amount when the ubi has a large amount of tokens", async () => {
    await increaseTime(ONE_DAY);
    await goodDollar.mint(avatar, "948439324829"); // checking claim with a random number
    await increaseTime(ONE_DAY * 2);
    await identity.authenticate(claimer1.address);
    // first claim
    await ubi.connect(claimer1).claim();
    await increaseTime(ONE_DAY * 2);
    let claimer1Balance1 = await goodDollar.balanceOf(claimer1.address);
    // regular claim
    await ubi.connect(claimer1).claim();
    const ubiGdBalance = await goodDollar.balanceOf(ubi.address);
    let claimer1Balance2 = await goodDollar.balanceOf(claimer1.address);
    // there are 3 claimers and the total ubi balance after the minting include the previous balance and
    // the dailyCyclePool is 948439324947 minting tokens. that divides into 3
    expect(claimer1Balance2.sub(claimer1Balance1).toString()).to.be.equal(
      BN.from("948439324947").div(3)
    );
  });

  it("should be able to iterate over all accounts if enough gas in fishMulti", async () => {
    //should not reach fishin first user because atleast 150k gas is required
    let tx = await ubi
      .connect(fisherman)
      .fishMulti([claimer5.address, claimer6.address, claimer1.address], {
        gasLimit: 100000
      })
      .then(_ => true)
      .catch(e => console.log({ e }));
    expect(tx).to.be.true;
    //should loop over all users when enough gas without exceptions
    let res = await ubi
      .fishMulti([claimer5.address, claimer6.address, claimer1.address], {
        gasLimit: 1000000
      })
      .then(_ => true)
      .catch(e => console.log({ e }));
    expect(res).to.be.true;
  });

  it("should return the estimated claim value for entitlement user before anyone claimed", async () => {
    await increaseTime(ONE_DAY);
    await ubi.connect(claimer1).claim();
    await increaseTime(ONE_DAY);
    let amount = await ubi.connect(claimer1)["checkEntitlement()"]();
    let balance2 = await goodDollar.balanceOf(ubi.address);
    let estimated = await ubi.estimateNextDailyUBI();
    expect(amount).to.be.equal(estimated);
  });

  it("should set the ubi claim amount by avatar", async () => {
    let encodedCall = firstClaimPool.interface.encodeFunctionData(
      "setClaimAmount",
      [200]
    );

    genericCall(firstClaimPool.address, encodedCall);
    const claimAmount = await firstClaimPool.claimAmount();
    expect(claimAmount.toString()).to.be.equal("200");
  });

  it("should set if withdraw from the dao or not", async () => {
    let encodedCall = ubi.interface.encodeFunctionData(
      "setShouldWithdrawFromDAO",
      [false]
    );
    await genericCall(ubi.address, encodedCall); // we should set cyclelength to one cause this tests was implemented according to it
    const shouldWithdrawFromDAO = await ubi.shouldWithdrawFromDAO();
    expect(shouldWithdrawFromDAO).to.be.equal(false);
  });
});
