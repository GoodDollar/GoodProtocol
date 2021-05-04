import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  SimpleStaking
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("StakingRewards - staking with cDAI mocks and get Rewards in GoodDollar", () => {
  let dai: Contract;
  let cDAI, cDAI1, cDAI2, cDAI3: Contract;
  let gasFeeOracle, daiEthOracle: Contract;
  let goodReserve: GoodReserveCDai;
  let goodCompoundStaking;
  let goodFundManager: Contract;
  let avatar,
    goodDollar,
    identity,
    marketMaker: GoodMarketMaker,
    contribution,
    controller,
    founder,
    staker,
    schemeMock,
    signers,
    nameService,
    initializeToken,
    setDAOAddress;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
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
      setReserveToken
    } = await createDAO();
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
    goodFundManager = await goodFundManagerFactory.deploy(
      nameService.address,
      cDAI.address,
      founder.address,
      founder.address,
      BLOCK_INTERVAL
    );
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

    goodCompoundStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good DAI",
      "gDAI",
      "172800"
    );

    console.log("initializing marketmaker...");

    cDAI1 = await cdaiFactory.deploy(dai.address);
    const cdaiLowWorthFactory = await ethers.getContractFactory(
      "cDAILowWorthMock"
    );
    cDAI2 = await cdaiLowWorthFactory.deploy(dai.address);
    const cdaiNonMintableFactory = await ethers.getContractFactory(
      "cDAINonMintableMock"
    );
    cDAI3 = await cdaiNonMintableFactory.deploy(dai.address);
    await initializeToken(
      cDAI1.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    await initializeToken(
      cDAI2.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    await initializeToken(
      cDAI3.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );

    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();
    const encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "addActiveStakingContract",
      [goodCompoundStaking.address]
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    const gasFeeMockFactory = await ethers.getContractFactory(
      "GasPriceMockOracle"
    );
    gasFeeOracle = await gasFeeMockFactory.deploy();
    const daiEthPriceMockFactory = await ethers.getContractFactory(
      "DaiEthPriceMockOracle"
    );
    daiEthOracle = await daiEthPriceMockFactory.deploy();
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
  });

  it("should be set rewards per block for particular stacking contract", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        goodCompoundStaking.address,
        currentBlockNumber - 5,
        currentBlockNumber + 10,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    let rewardPerBlock = await goodFundManager.rewardsForStakingContract(
      goodCompoundStaking.address
    );
    expect(rewardPerBlock[0].toString()).to.be.equal("1000");
    expect(rewardPerBlock[1].toString()).to.be.equal(
      (currentBlockNumber - 5).toString()
    );
    expect(rewardPerBlock[2].toString()).to.be.equal(
      (currentBlockNumber + 10).toString()
    );
    expect(rewardPerBlock[3]).to.be.equal(false);
  });

  it("should be able to earn rewards after some block passed", async () => {
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);
    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    await advanceBlocks(4);
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);
    expect(gdBalancerAfterWithdraw.toString()).to.be.equal("2500");
  });

  it("shouldn't be able to earn rewards after rewards blockend passed", async () => {
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);

    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    advanceBlocks(5);
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);

    expect(gdBalancerAfterWithdraw.toString()).to.be.equal(
      gdBalanceBeforeWithdraw.toString()
    );
  });

  it("shouldn't be able to mint reward when staking contract is blacklisted", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", goodCompoundStaking.address, "55", "1000", true] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);

    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    advanceBlocks(5);
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);

    expect(gdBalancerAfterWithdraw).to.be.equal(gdBalanceBeforeWithdraw);
  });

  it("should set blacklisted false and mint rewards", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        goodCompoundStaking.address,
        currentBlockNumber,
        currentBlockNumber + 500,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);

    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    advanceBlocks(5);
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);
    let gCDAIbalanceAfter = await goodCompoundStaking.balanceOf(staker.address);
    let gCDAITotalSupply = await goodCompoundStaking.totalSupply();
    expect(gCDAIbalanceAfter).to.be.equal(gCDAITotalSupply); // staker should own whole staking tokens
    expect(gdBalancerAfterWithdraw.toString()).to.be.equal("5500"); // should mint previous rewards as well
  });

  it("it should send staker's productivity to some other user", async () => {
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);
    let stakersProductivityBefore = await goodCompoundStaking.getProductivity(
      staker.address
    );
    await goodCompoundStaking
      .connect(staker)
      .transfer(founder.address, stakingAmount);
    let stakersProductivityAfter = await goodCompoundStaking
      .connect(staker)
      .getProductivity(staker.address);
    let foundersProductivity = await goodCompoundStaking.getProductivity(
      founder.address
    );

    expect(stakersProductivityAfter[0].toString()).to.be.equal("0");
    expect(foundersProductivity[0].toString()).to.be.equals(
      stakingAmount.toString()
    );
  });

  it("it shouldn't be able to withdraw stake when staker sent it to another user", async () => {
    const stakingAmount = ethers.utils.parseEther("100");
    await expect(
      goodCompoundStaking.connect(staker).withdrawStake(stakingAmount)
    ).to.be.reverted;
  });

  it("it should be able to withdraw their stake when got staking tokens from somebody else", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await goodCompoundStaking.withdrawStake(stakingAmount);

    const foundersProductivity = await goodCompoundStaking.getProductivity(
      founder.address
    );
    expect(foundersProductivity[0].toString()).to.be.equal("0");
    expect(foundersProductivity[1].toString()).to.be.equal("0"); // Total productivity also should equal 0
  });

  it("stake should generate some interest and shoul be used to generate UBI", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);

    for (let i = 0; i <= 1500; i++) {
      await cDAI.exchangeRateCurrent(); // increase interest by calling exchangeRateCurrent
    }
    const currentUBIInterestBeforeWithdraw = await goodCompoundStaking.currentUBIInterest();
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
    const gdBalanceBeforeCollectInterest = await goodDollar.balanceOf(
      staker.address
    );
    const contractAddressesToBeCollected = await goodFundManager.calcSortedContracts("1000000")
    await goodFundManager.connect(staker).collectInterest(contractAddressesToBeCollected);
    const gdBalanceAfterCollectInterest = await goodDollar.balanceOf(
      staker.address
    );
    const currentUBIInterestAfterWithdraw = await goodCompoundStaking.currentUBIInterest();
    expect(currentUBIInterestBeforeWithdraw[0].toString()).to.not.be.equal("0");
    expect(currentUBIInterestAfterWithdraw[0].toString()).to.be.equal("0");
    expect(gdBalanceAfterCollectInterest.gt(gdBalanceBeforeCollectInterest));
  });

  it("it should get rewards with updated values", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        goodCompoundStaking.address,
        currentBlockNumber,
        currentBlockNumber + 5000,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);

    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);

    await advanceBlocks(4);
    let rewardsEarned = await goodCompoundStaking.getUserPendingReward(
      staker.address
    );
    expect(rewardsEarned.toString()).to.be.equal("2000"); // Each block reward is 10gd so total reward 40gd but since multiplier is 0.5 for first month should get 20gd
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
  });

  it("it should get rewards with 1x multiplier for after threshold pass", async () => {
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const simpleStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good DAI",
      "gDAI",
      "50"
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking.address,
        currentBlockNumber,
        currentBlockNumber + 100,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);

    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai.connect(staker).approve(simpleStaking.address, stakingAmount);
    let gdBalanceStakerBeforeWithdraw = await goodDollar.balanceOf(
      staker.address
    );
    await simpleStaking.connect(staker).stake(stakingAmount, 100);

    await advanceBlocks(54);
    await simpleStaking.connect(staker).withdrawStake(stakingAmount);
    let gdBalanceStakerAfterWithdraw = await goodDollar.balanceOf(
      staker.address
    );

    expect(
      gdBalanceStakerAfterWithdraw.sub(gdBalanceStakerBeforeWithdraw).toString()
    ).to.be.equal("30000"); // 50 blocks reward worth 500gd but since it's with the 0.5x multiplier so 250gd then there is 5 blocks which gets full reward so total reward is 300gd
  });

  it("Should transfer somebody's staking token's when they approve", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);
    await goodCompoundStaking
      .connect(staker)
      .approve(founder.address, stakingAmount);
    const stakingTokenBalanceBeforeTransfer = await goodCompoundStaking.balanceOf(
      founder.address
    );
    await goodCompoundStaking.transferFrom(
      staker.address,
      founder.address,
      stakingAmount
    );
    const stakingTokenBalanceAfterTransfer = await goodCompoundStaking.balanceOf(
      founder.address
    );

    expect(
      stakingTokenBalanceAfterTransfer.gt(stakingTokenBalanceBeforeTransfer)
    ).to.be.true;
    await goodCompoundStaking.withdrawStake(stakingAmount);
  });

  it("Should be able to withdraw rewards without withdraw stake", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);
    await advanceBlocks(5);
    const earnedRewardBeforeWithdrawReward = await goodCompoundStaking.getUserPendingReward(
      staker.address
    );
    await goodCompoundStaking.connect(staker).withdrawRewards();
    const earnedRewardAfterWithdrawReward = await goodCompoundStaking.getUserPendingReward(
      staker.address
    );

    expect(earnedRewardAfterWithdrawReward.lt(earnedRewardBeforeWithdrawReward))
      .to.be.true;
    expect(earnedRewardAfterWithdrawReward.toString()).to.be.equal("0");
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
  });

  it("should be able earn to 50% of rewards when owns 50% of total productivity", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai["mint(address,uint256)"](signers[0].address, stakingAmount); // We use some different signer than founder since founder also UBI INTEREST collector
    await dai
      .connect(signers[0])
      .approve(goodCompoundStaking.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    let stakerTwoGDAmountBeforeStake = await goodDollar.balanceOf(
      signers[0].address
    );
    let stakerGDAmountBeforeStake = await goodDollar.balanceOf(staker.address);

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);
    await goodCompoundStaking.connect(signers[0]).stake(stakingAmount, 100);
    await advanceBlocks(5);

    const ubiAmount = await goodCompoundStaking.currentUBIInterest();

    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
    await goodCompoundStaking.connect(signers[0]).withdrawStake(stakingAmount);
    let stakerTwoGDAmountAfterStake = await goodDollar.balanceOf(
      signers[0].address
    );
    let stakerGDAmountAfterStake = await goodDollar.balanceOf(staker.address);

    expect(
      stakerTwoGDAmountAfterStake
        .sub(stakerTwoGDAmountBeforeStake)
        .sub(ubiAmount[0])
        .toString()
    ).to.be.equal(
      stakerGDAmountAfterStake.sub(stakerGDAmountBeforeStake).toString()
    );
  });

  it("should be able to sort staking contracts and collect interests from highest to lowest and only one staking contract's interest should be collected due to gas amount", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);
    for (let i = 0; i <= 1500; i++) {
      await cDAI.exchangeRateCurrent(); // increase interest by calling exchangeRateCurrent
    }

    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const simpleStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good DAI",
      "gDAI",
      "50"
    );
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "addActiveStakingContract",
      [simpleStaking.address]
    );
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(simpleStaking.address, stakingAmount);
    await simpleStaking.connect(staker).stake(stakingAmount, 100);
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    for (let i = 0; i <= 200; i++) {
      await cDAI.exchangeRateCurrent(); // increase interest by calling exchangeRateCurrent
    }
   
   

    const simpleStakingCurrentInterestBeforeCollect = await simpleStaking.currentUBIInterest()
    const contractsToBeCollected = await goodFundManager.calcSortedContracts("750000")
    await goodFundManager.collectInterest(contractsToBeCollected,{
      gasLimit: 750000
    });
    
    const simpleStakingCurrentInterest = await simpleStaking.currentUBIInterest()
    const goodCompoundStakingCurrentInterest = await goodCompoundStaking.currentUBIInterest()
    expect(goodCompoundStakingCurrentInterest[0].toString()).to.be.equal("0")  // Goodcompound staking's interest should be collected so currentinterest should be 0
    expect(simpleStakingCurrentInterestBeforeCollect[0]).to.be.equal(simpleStakingCurrentInterest[0]) // simple staking's interest shouldn't be collected so currentinterest should be equal to before collectinterest
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount)
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "removeActiveStakingContract",
      [simpleStaking.address]
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);

  });
});
