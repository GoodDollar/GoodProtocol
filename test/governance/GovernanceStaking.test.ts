import { default as hre, ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber, Contract, Signer } from "ethers";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  SimpleStaking,
  GReputation
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("GovernanceStaking - staking with GD  and get Rewards in GDAO", () => {
  let dai: Contract;
  let cDAI: Contract;
  let goodReserve: GoodReserveCDai;
  let governanceStaking: Contract;
  let goodFundManager: Contract;
  let grep: GReputation;
  let avatar,
    goodDollar,
    identity,
    marketMaker: GoodMarketMaker,
    contribution,
    controller,
    founder,
    staker,
    staker2,
    staker3,
    schemeMock,
    signers,
    nameService,
    initializeToken,
    setDAOAddress;

  before(async () => {
    [founder, staker, staker2, staker3, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      daoCreator,
      nameService: ns,
      setDAOAddress: sda,
      setSchemes,
      marketMaker: mm,
      daiAddress,
      cdaiAddress,
      reserve,
      reputation,
      setReserveToken
    } = await loadFixture(createDAO);
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    initializeToken = setReserveToken;
    goodReserve = reserve as GoodReserveCDai;
    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar
    });
    goodFundManager = await upgrades.deployProxy(
      goodFundManagerFactory,
      [nameService.address],
      { kind: "uups" }
    );
    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address
    });
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    contribution = await ethers.getContractAt(
      ContributionCalculation.abi,
      await nameService.getAddress("CONTRIBUTION_CALCULATION")
    );

    marketMaker = mm;

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });

    console.log("setting permissions...");
    governanceStaking = await governanceStakingFactory.deploy(
      nameService.address
    );

    await setDAOAddress("CDAI", cDAI.address);
    await setDAOAddress("DAI", dai.address);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();

    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
  });

  it("Should not mint reward when staking contract is not minter ", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(5);
    const error = await governanceStaking.withdrawStake("100").catch(e => e);
    expect(error.message).to.have.string(
      "GReputation: need minter role or be GDAO contract"
    );
  });

  it("Should be able mint rewards after set GDAO staking contract", async () => {
    await setDAOAddress("GDAO_STAKING", governanceStaking.address);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);

    expect(GDAOBalanceAfterWithdraw).to.gt(GDAOBalanceBeforeWithdraw);
  });

  it("Avatar should be able to change rewards per block", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      [ethers.utils.parseEther("1728000")]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
    const rewardsPerBlock = await governanceStaking.getRewardsPerBlock();
    expect(rewardsPerBlock).to.equal(
      ethers.utils.parseEther("1728000").div(BN.from("518400")) // 1728000 is montlhy reward amount and 518400 is monthly blocks for FUSE chain
    );
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking.withdrawStake("100");
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(calculatedReward)
    );
    encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      [ethers.utils.parseEther("12000000")]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
  });

  it("Should be able to withdraw rewards without withdraw stake", async () => {
    const rewardsPerBlock = await governanceStaking.getRewardsPerBlock();
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    const transaction = await (
      await governanceStaking.withdrawRewards()
    ).wait();
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(calculatedReward)
    );
    expect(transaction.events.find(_ => _.event === "ReputationEarned")).to.be
      .not.empty;
    await governanceStaking.withdrawStake("100");
  });

  it("Should be able to withdraw transferred stakes", async () => {
    await goodDollar.mint(staker.address, "100");
    await goodDollar.connect(staker).approve(governanceStaking.address, "100");
    await governanceStaking.connect(staker).stake("100");
    await advanceBlocks(4);
    await governanceStaking.connect(staker).transfer(founder.address, "100");
    await governanceStaking.connect(staker).withdrawRewards();
    const gdaoBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking.withdrawStake("100");
    const gdaoBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    expect(gdaoBalanceAfterWithdraw).to.gt(gdaoBalanceBeforeWithdraw);
  });

  it("should not be able to withdraw after they send their stake to somebody else", async () => {
    let transaction = await governanceStaking
      .connect(staker)
      .withdrawStake("100")
      .catch(e => e);
    expect(transaction.message).to.have.string("Not enough token staked");
  });

  it("it should distribute reward with correct precision", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      ["17280000000000000000"] // Give 0.0001 GDAO per block so 17.28 GDAO per month
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
    const rewardsPerBlock = await governanceStaking.getRewardsPerBlock();
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking.withdrawStake("100");
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(calculatedReward)
    );
  });

  it("it should not generate rewards when rewards per block set to 0", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      ["0"] // Give 0 GDAO per block
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    const userProductivity = await governanceStaking[
      "getProductivity(address)"
    ](founder.address);
    expect(userProductivity[0]).to.be.equal(BN.from("100"));
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    expect(GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw)).to.equal(0);
    encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      [ethers.utils.parseEther("12000000")]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
  });

  it("it should return productivity values correctly", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    const productivityValue = await governanceStaking[
      "getProductivity(address)"
    ](founder.address);

    expect(productivityValue[0].toString()).to.be.equal("100");
    expect(productivityValue[1].toString()).to.be.equal("100");
    await governanceStaking.withdrawStake("100");
  });

  it("it should return earned rewards with pending ones properly", async () => {
    const rewardsPerBlock = await governanceStaking.getRewardsPerBlock();
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await governanceStaking.stake("100");
    await advanceBlocks(5);
    const totalEarned = await governanceStaking[
      "getUserPendingReward(address)"
    ](founder.address);
    const pendingRewardBlockNumber = await ethers.provider.getBlockNumber();
    const multiplier = pendingRewardBlockNumber - stakeBlockNumber;
    const calculatedPendingReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(totalEarned).to.be.equal(calculatedPendingReward);
    await governanceStaking.withdrawStake("100");
  });

  it("Accumulated per share has enough precision when reward << totalproductivity", async () => {
    const rewardsPerBlock = await governanceStaking.getRewardsPerBlock();
    await goodDollar.mint(founder.address, "100000000000000"); // 1 trillion gd stake
    await goodDollar.approve(governanceStaking.address, "1000000000000");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await governanceStaking.stake("1000000000000");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking.withdrawStake("1000000000000");
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(calculatedReward)
    );
  });

  it("user receive fractional gdao properly when his stake << totalProductivity", async () => {
    const rewardsPerBlock = await governanceStaking.getRewardsPerBlock();
    await goodDollar.mint(founder.address, "800"); // 8gd
    await goodDollar.mint(staker.address, "200"); // 2gd
    await goodDollar.approve(governanceStaking.address, "800");
    await goodDollar.connect(staker).approve(governanceStaking.address, "200");
    await governanceStaking.stake("800");
    const secondStakerStakeBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;
    await governanceStaking.connect(staker).stake("200");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(staker.address);
    const FounderGDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking.withdrawStake("800");
    const founderWithdrawBlockNumber = await ethers.provider.getBlockNumber();
    await governanceStaking.connect(staker).withdrawStake("200");
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(staker.address);
    const FounderGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    const founderCalculatedRewards = rewardsPerBlock.add(
      rewardsPerBlock
        .mul(80)
        .mul(founderWithdrawBlockNumber - secondStakerStakeBlockNumber)
        .div(100)
    ); // Founder should get full rewards for one block then owns of %80 of rewards
    const stakerCalculatedRewards = rewardsPerBlock
      .mul(20)
      .mul(founderWithdrawBlockNumber - secondStakerStakeBlockNumber)
      .div(100)
      .add(rewardsPerBlock); // Staker should get %20 of rewards initially then when Founder withdraw their stake Staker would own %100 of rewards and would get full amount
    expect(FounderGDAOBalanceAfterWithdraw).to.be.equal(
      FounderGDAOBalanceBeforeWithdraw.add(founderCalculatedRewards)
    );
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(stakerCalculatedRewards)
    );
  });

  it("it should be able to tranfer tokens when user approve", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await governanceStaking.approve(staker.address, "100");
    const stakerProductivityBeforeTransfer = await governanceStaking[
      "getProductivity(address)"
    ](staker.address);

    await governanceStaking
      .connect(staker)
      .transferFrom(founder.address, staker.address, "100");
    const stakerProductivity = await governanceStaking[
      "getProductivity(address)"
    ](staker.address);

    expect(await governanceStaking.balanceOf(founder.address)).to.equal(0);
    expect(await governanceStaking.balanceOf(staker.address)).to.equal(100);

    expect((await governanceStaking.users(staker.address)).amount).to.equal(
      100
    );
    expect(stakerProductivityBeforeTransfer[0]).to.be.equal(0);
    expect(stakerProductivity[0]).to.be.equal("100");
  });

  it("it should return staker data", async () => {
    await goodDollar.mint(staker2.address, "100");
    await goodDollar.connect(staker2).approve(governanceStaking.address, "100");
    await governanceStaking.connect(staker2).stake("100");

    await advanceBlocks(10);

    expect((await governanceStaking.users(staker2.address)).rewardDebt).to.gt(
      0
    ); //debt should start according to accumulated rewards in contract. debt is the user stake starting point.

    await governanceStaking.connect(staker2).withdrawStake("1");

    expect(await governanceStaking.balanceOf(staker2.address)).to.equal(99);

    expect((await governanceStaking.users(staker2.address)).amount).to.equal(
      99
    );
    expect((await governanceStaking.users(staker2.address)).rewardDebt).to.gt(
      0
    ); //should have withdrawn rewards after withdraw stake
    expect(
      (await governanceStaking.users(staker2.address)).rewardEarn
    ).to.equal(0); //should have 0 pending rewards after withdraw stake

    await advanceBlocks(10);
    await goodDollar.connect(staker2).approve(governanceStaking.address, "200");

    await governanceStaking.connect(staker2).stake("1"); //should calculate user pending rewards

    expect(
      (await governanceStaking.users(staker2.address)).rewardEarn
    ).to.be.equal(
      0 //should have 0 rewardEarned because every action, like the above stake withdraws gdao rewards
    );
    await advanceBlocks(2); // pass some blocks
    const userPendingReward = await governanceStaking[
      "getUserPendingReward(address)"
    ](staker2.address);
    governanceStaking.connect(staker2).withdrawStake("100");
    expect(userPendingReward).to.be.gt(0);
  });

  it("it should return pendingRewards equal zero after withdraw", async () => {
    let userPendingRewards = await governanceStaking[
      "getUserPendingReward(address)"
    ](staker.address);
    expect(userPendingRewards).to.be.gt(0);
    await governanceStaking.connect(staker).withdrawRewards();
    userPendingRewards = await governanceStaking[
      "getUserPendingReward(address)"
    ](staker.address);
    expect(userPendingRewards).to.equal(0);
    await advanceBlocks(1);
    userPendingRewards = await governanceStaking[
      "getUserPendingReward(address)"
    ](staker.address);
    expect(userPendingRewards).to.gt(0); //one block passed

    await governanceStaking.connect(staker).withdrawStake(0);
    userPendingRewards = await governanceStaking[
      "getUserPendingReward(address)"
    ](staker.address);
    expect(userPendingRewards).to.be.equal(0);
  });

  it("it should calculate accumulated rewards per share correctly", async () => {
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    const simpleGovernanceStaking = await governanceStakingFactory.deploy(
      nameService.address
    );
    await setDAOAddress("GDAO_STAKING", simpleGovernanceStaking.address);
    await goodDollar.mint(founder.address, "200");
    await goodDollar.mint(staker.address, "200");

    await goodDollar.approve(simpleGovernanceStaking.address, "200");
    await goodDollar
      .connect(staker)
      .approve(simpleGovernanceStaking.address, "200");

    await simpleGovernanceStaking.stake("100");
    let accumulatedRewardsPerShare = await simpleGovernanceStaking[
      "totalRewardsPerShare()"
    ]();
    expect(accumulatedRewardsPerShare).to.equal(0); //first has no accumulated rewards yet, since no blocks have passed since staking

    await simpleGovernanceStaking.stake("100");
    accumulatedRewardsPerShare = await simpleGovernanceStaking[
      "totalRewardsPerShare()"
    ]();
    expect(await simpleGovernanceStaking.getRewardsPerBlock()).to.equal(
      ethers.utils
        .parseEther("2000000") //2M reputation
        .div(await simpleGovernanceStaking.FUSE_MONTHLY_BLOCKS())
    );
    let totalProductiviy = BN.from("100");

    //totalRewardsPerShare is in 1e27 , divid by  1e9 to get 1e18 decimals
    expect(accumulatedRewardsPerShare.div(BN.from(1e9))).to.equal(
      ethers.utils
        .parseEther("2000000") //monthly rewards
        .mul(BN.from(1e2)) //G$ is 2 decimals, dividing reduces decimals by 2, so we first increase to 1e20 decimals
        .div(await simpleGovernanceStaking.FUSE_MONTHLY_BLOCKS()) //=rewards per block
        .mul(BN.from("1")) //=rewards per block * number of blocks = rewards earned in period
        .div(totalProductiviy) //=rewards per share
        .mul(BN.from("10000000000000000")), //restore lost precision from dividing by totalProductivity G$ 2 decimals;
      "1 block"
    ); //1 block passed with actual staking

    totalProductiviy = totalProductiviy.add(BN.from("100")); //second stake
    await simpleGovernanceStaking.connect(staker).stake("100");
    let accumulatedRewardsPerShare2 = await simpleGovernanceStaking[
      "totalRewardsPerShare()"
    ]();

    //shouldnt be naive accumlattion of 2 blocks, since total productivity has changed between blocks
    expect(accumulatedRewardsPerShare2.div(BN.from(1e9))).to.not.equal(
      ethers.utils
        .parseEther("2000000")
        .mul(BN.from(1e2)) //G$ is 2 decimals, dividing reduces decimals by 2, so we first increase to 1e20 decimals
        .div(await simpleGovernanceStaking.FUSE_MONTHLY_BLOCKS())
        .div(totalProductiviy)
        .mul(BN.from("2"))
        .mul(BN.from("10000000000000000")), //increase precision to 1e18 from totalProductivity G$ 2 decimals;

      "2 blocks"
    ); //2 blocks passed but now we have 200 total productivity before 3rd stake

    console.log(
      accumulatedRewardsPerShare2.toString(),
      accumulatedRewardsPerShare.toString()
    );

    const calculatedAccRewards = rdiv(
      ethers.utils
        .parseEther("2000000")
        .div(await simpleGovernanceStaking.FUSE_MONTHLY_BLOCKS()),
      totalProductiviy
    );
    //accumulated so far plus block accumulation
    expect(accumulatedRewardsPerShare2).to.equal(
      calculatedAccRewards.add(accumulatedRewardsPerShare), //add rewards from previous block
      "2 blocks correct"
    );
    await setDAOAddress("GDAO_STAKING", governanceStaking.address);
  });

  it("Staking tokens should be 2 decimals", async () => {
    const decimals = await governanceStaking.decimals();
    expect(decimals.toString()).to.be.equal("2");
  });

  it("Stake amount should be positive", async () => {
    const tx = await governanceStaking.stake("0").catch(e => e);
    expect(tx.message).to.have.string(
      "You need to stake a positive token amount"
    );
  });

  it("It should approve stake amount in order to stake", async () => {
    const tx = await governanceStaking
      .stake(ethers.utils.parseEther("10000000"))
      .catch(e => e);
    expect(tx.message).not.to.be.empty;
  });

  it("Withdraw 0 should withdraw everything", async () => {
    await expect(governanceStaking.withdrawStake("0")).to.revertedWith(
      "positive amount"
    );
  });

  it("Should use overriden _transfer that handles productivity when using transferFrom which is defined in super erc20 contract", async () => {
    await expect(
      governanceStaking.transferFrom(
        founder.address,
        staker.address,
        ethers.utils.parseEther("10000000")
      )
    ).to.reverted;
  });

  it("it should get rewards for previous stakes when stake new amount of tokens", async () => {
    const rewardsPerBlock = await governanceStaking.getRewardsPerBlock();
    await goodDollar.mint(founder.address, "200");
    await goodDollar.approve(governanceStaking.address, "200");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await governanceStaking.stake("100");
    await advanceBlocks(5);
    const gdaoBalanceBeforeGetRewards = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking.stake("100");
    const getRewardsBlockNumber = await ethers.provider.getBlockNumber();
    const gdaoBalanceAfterGetRewards = await grep.balanceOfLocal(
      founder.address
    );
    const multiplier = getRewardsBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    await governanceStaking.withdrawStake("200");
    expect(gdaoBalanceAfterGetRewards).to.be.equal(
      gdaoBalanceBeforeGetRewards.add(calculatedReward)
    );
  });
  it("it should distribute rewards properly when there is multiple stakers", async () => {
    const rewardsPerBlock = await governanceStaking.getRewardsPerBlock();
    const stakingAmount = BN.from("100");
    await goodDollar.mint(founder.address, stakingAmount);
    await goodDollar.mint(staker.address, stakingAmount);
    await goodDollar.mint(signers[0].address, stakingAmount);
    await goodDollar.mint(signers[1].address, stakingAmount);

    await goodDollar.approve(governanceStaking.address, stakingAmount);
    await goodDollar
      .connect(staker)
      .approve(governanceStaking.address, stakingAmount);
    await goodDollar
      .connect(signers[0])
      .approve(governanceStaking.address, stakingAmount);
    await goodDollar
      .connect(signers[1])
      .approve(governanceStaking.address, stakingAmount);
    await governanceStaking.stake(stakingAmount);
    const stakerOneGDAOBalanceAfterStake = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking.connect(staker).stake(stakingAmount.div(10));
    const stakerTwoGDAOBalanceAfterStake = await grep.balanceOfLocal(
      staker.address
    );
    await governanceStaking.connect(signers[0]).stake(stakingAmount.div(4));
    const stakerThreeGDAOBalanceAfterStake = await grep.balanceOfLocal(
      signers[0].address
    );
    const stakerFourStakeBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;
    await governanceStaking.connect(signers[1]).stake(stakingAmount.div(5));
    const stakerFourGDAOBalanceAfterStake = await grep.balanceOfLocal(
      signers[1].address
    );
    await advanceBlocks(10);
    await governanceStaking.withdrawStake(stakingAmount);
    const stakerOneWithdrawBlockNumber = await ethers.provider.getBlockNumber();
    const stakerOneGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await governanceStaking
      .connect(staker)
      .withdrawStake(stakingAmount.div(10));
    const stakerTwoGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      staker.address
    );
    await governanceStaking
      .connect(signers[0])
      .withdrawStake(stakingAmount.div(4));
    const stakerThreeGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      signers[0].address
    );
    await governanceStaking
      .connect(signers[1])
      .withdrawStake(stakingAmount.div(5));
    const stakerFourGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      signers[1].address
    );
    const stakerOneRewardsCalculated = rewardsPerBlock
      .add(rewardsPerBlock.mul(100).div(110))
      .add(rewardsPerBlock.mul(100).div(135))
      .add(
        rewardsPerBlock
          .mul(100)
          .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
          .div(155)
      )
      .add(BN.from("2"));
    const stakerTwoRewardsCalculated = rewardsPerBlock
      .mul(10)
      .div(110)
      .add(rewardsPerBlock.mul(10).div(135))
      .add(
        rewardsPerBlock
          .mul(10)
          .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
          .div(155)
      )
      .add(rewardsPerBlock.mul(10).div(55))
      .add(BN.from("1"));
    const stakerThreeRewardsCalculated = rewardsPerBlock
      .mul(25)
      .div(135)
      .add(
        rewardsPerBlock
          .mul(25)
          .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
          .div(155)
      )
      .add(rewardsPerBlock.mul(25).div(55))
      .add(rewardsPerBlock.mul(25).div(45))
      .add(BN.from("1"));
    const stakerFourRewardsCalculated = rewardsPerBlock
      .mul(20)
      .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
      .div(155)
      .add(rewardsPerBlock.mul(20).div(55))
      .add(rewardsPerBlock.mul(20).div(45))
      .add(rewardsPerBlock)
      .add(BN.from("1"));
    expect(stakerOneGDAOBalanceAfterWithdraw).to.be.equal(
      stakerOneGDAOBalanceAfterStake.add(stakerOneRewardsCalculated)
    );
    expect(stakerTwoGDAOBalanceAfterWithdraw).to.be.equal(
      stakerTwoGDAOBalanceAfterStake.add(stakerTwoRewardsCalculated)
    );
    expect(stakerThreeGDAOBalanceAfterWithdraw).to.be.equal(
      stakerThreeGDAOBalanceAfterStake.add(stakerThreeRewardsCalculated)
    );
    expect(stakerFourGDAOBalanceAfterWithdraw).to.be.equal(
      stakerFourGDAOBalanceAfterStake.add(stakerFourRewardsCalculated)
    );
  });
  it("it should get staking reward even reward amount is too low", async () => {
    const rewardsPerBlock = await governanceStaking.getRewardsPerBlock();
    console.log(rewardsPerBlock.toString());
    const stakingAmount = BN.from("10000");
    await goodDollar.mint(founder.address, stakingAmount);
    await goodDollar.mint(staker.address, stakingAmount);
    await goodDollar.approve(governanceStaking.address, stakingAmount);
    await goodDollar
      .connect(staker)
      .approve(governanceStaking.address, stakingAmount);
    await governanceStaking.stake(stakingAmount);
    const stakerOneGDAOBalanceAfterStake = await grep.balanceOfLocal(
      founder.address
    );
    const stakerTwoStakeBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;
    await governanceStaking.connect(staker).stake(stakingAmount.div(10000));
    const stakerTwoGDAOBalanceAfterStake = await grep.balanceOfLocal(
      staker.address
    );
    await advanceBlocks(10);

    await governanceStaking
      .connect(staker)
      .withdrawStake(stakingAmount.div(10000));
    const stakerTwoWithdrawBlockNumber = await ethers.provider.getBlockNumber();
    await governanceStaking.withdrawStake(stakingAmount);

    const stakerOneGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    const stakerTwoGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      staker.address
    );
    const calculatedRewardsStakerOne = rewardsPerBlock
      .add(
        rewardsPerBlock
          .mul(10000)
          .mul(stakerTwoWithdrawBlockNumber - stakerTwoStakeBlockNumber)
          .div(10001)
      )
      .add(rewardsPerBlock);
    const calculatedRewardsStakerTwo = rewardsPerBlock
      .mul(1)
      .mul(stakerTwoWithdrawBlockNumber - stakerTwoStakeBlockNumber)
      .div(10001)
      .add(BN.from("1"));
    expect(stakerOneGDAOBalanceAfterWithdraw).to.be.equal(
      stakerOneGDAOBalanceAfterStake.add(calculatedRewardsStakerOne)
    );
    expect(stakerTwoGDAOBalanceAfterWithdraw).to.be.equal(
      stakerTwoGDAOBalanceAfterStake.add(calculatedRewardsStakerTwo)
    );
  });

  it("it should mint rewards properly when withdrawRewards", async () => {
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    const simpleGovernanceStaking = await governanceStakingFactory.deploy(
      nameService.address
    );
    await setDAOAddress("GDAO_STAKING", simpleGovernanceStaking.address);
    await goodDollar.mint(founder.address, "100");
    const rewardsPerBlock = await simpleGovernanceStaking.getRewardsPerBlock();
    await goodDollar.approve(simpleGovernanceStaking.address, "200");

    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await simpleGovernanceStaking.stake("200");
    const GDAOBalanceAfterStake = await grep.balanceOfLocal(founder.address);
    await advanceBlocks(100);
    await simpleGovernanceStaking.withdrawRewards();
    const withdrawRewardsBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);

    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceAfterStake.add(
        rewardsPerBlock.mul(withdrawRewardsBlockNumber - stakeBlockNumber)
      )
    );

    await setDAOAddress("GDAO_STAKING", governanceStaking.address);
  });

  it("it should not overmint rewards when staker withdraw their rewards", async () => {
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    const simpleGovernanceStaking = await governanceStakingFactory.deploy(
      nameService.address
    );
    await setDAOAddress("GDAO_STAKING", simpleGovernanceStaking.address);
    const overmintTesterFactory = await ethers.getContractFactory(
      "OverMintTester"
    );
    const overMintTester = await overmintTesterFactory.deploy(
      goodDollar.address,
      simpleGovernanceStaking.address,
      grep.address
    );
    await goodDollar.mint(overMintTester.address, "100");
    const rewardsPerBlock = await simpleGovernanceStaking.getRewardsPerBlock();
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await overMintTester.stake();
    const GDAOBalanceAfterStake = await grep.balanceOfLocal(
      overMintTester.address
    );
    await advanceBlocks(100);
    await overMintTester.overMintTest();
    const withdrawRewardsBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdrawReward = await grep.balanceOfLocal(
      overMintTester.address
    );
    await advanceBlocks(20);
    await overMintTester.overMintTest();
    const secondWithdrawRewardsBlockNumber =
      await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterSecondWithdrawReward = await grep.balanceOfLocal(
      overMintTester.address
    );

    expect(GDAOBalanceAfterWithdrawReward).to.be.gt(GDAOBalanceAfterStake);
    expect(
      GDAOBalanceAfterWithdrawReward.sub(GDAOBalanceAfterStake)
    ).to.be.equal(
      rewardsPerBlock.mul(withdrawRewardsBlockNumber - stakeBlockNumber)
    );
    expect(GDAOBalanceAfterSecondWithdrawReward).to.be.gt(
      GDAOBalanceAfterWithdrawReward
    );
    expect(
      GDAOBalanceAfterSecondWithdrawReward.sub(GDAOBalanceAfterWithdrawReward)
    ).to.be.equal(
      rewardsPerBlock.mul(
        secondWithdrawRewardsBlockNumber - withdrawRewardsBlockNumber
      )
    );
    await setDAOAddress("GDAO_STAKING", governanceStaking.address);
  });

  it("it should accrue previous rewards based on previous monthly rate on monthly rewards rate change to 0", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    const simpleGovernanceStaking = await governanceStakingFactory.deploy(
      nameService.address
    );

    const rewardsPerBlock = await simpleGovernanceStaking.getRewardsPerBlock();

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(simpleGovernanceStaking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await simpleGovernanceStaking.stake("100");
    await advanceBlocks(4);

    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      ["0"] // Give 0.0001 GDAO per block so 17.28 GDAO per month
    );
    await ictrl.genericCall(
      simpleGovernanceStaking.address,
      encodedCall,
      avatar,
      0
    );

    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier);
    const pendingReward = await simpleGovernanceStaking[
      "getUserPendingReward(address)"
    ](founder.address);
    expect(pendingReward).to.equal(calculatedReward);
    await advanceBlocks(4);
  });

  function rdiv(x: BigNumber, y: BigNumber) {
    return x.mul(BN.from("10").pow(27)).add(y.div(2)).div(y);
  }
});
