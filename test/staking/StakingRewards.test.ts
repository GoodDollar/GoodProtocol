import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  SimpleStaking,
  GoodFundManager
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("StakingRewards - staking with cDAI mocks and get Rewards in GoodDollar", () => {
  let dai: Contract;
  let bat: Contract;
  let pair: Contract, uniswapRouter: Contract;
  let cDAI, cDAI1, cDAI2, cDAI3, cBat: Contract;
  let gasFeeOracle,
    daiEthOracle: Contract,
    daiUsdOracle: Contract,
    batUsdOracle: Contract,
    ethUsdOracle: Contract;
  let goodReserve: GoodReserveCDai;
  let goodCompoundStaking;
  let goodFundManager: GoodFundManager;
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
    setDAOAddress,
    genericCall;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cBatFactory = await ethers.getContractFactory("cBATMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const routerFactory = new ethers.ContractFactory(
      UniswapV2Router02.abi,
      UniswapV2Router02.bytecode,
      founder
    );
    const uniswapFactory = new ethers.ContractFactory(
      UniswapV2Factory.abi,
      UniswapV2Factory.bytecode,
      founder
    );
    const wethFactory = new ethers.ContractFactory(
      WETH9.abi,
      WETH9.bytecode,
      founder
    );
    const daiFactory = await ethers.getContractFactory("DAIMock");
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
      setReserveToken,
      genericCall: gc
    } = await createDAO();

    genericCall = gc;
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
    goodFundManager = (await upgrades.deployProxy(
      goodFundManagerFactory,
      [nameService.address],
      {
        kind: "uups"
      }
    )) as GoodFundManager;
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address
    });
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    contribution = await ethers.getContractAt(
      ContributionCalculation.abi,
      await nameService.getAddress("CONTRIBUTION_CALCULATION")
    );

    marketMaker = mm;
    const weth = await wethFactory.deploy();
    const factory = await uniswapFactory.deploy(founder.address);
    uniswapRouter = await routerFactory.deploy(factory.address, weth.address);
    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });

    console.log("setting permissions...");
    const tokenUsdOracleFactory = await ethers.getContractFactory(
      "BatUSDMockOracle"
    );
    daiUsdOracle = await tokenUsdOracleFactory.deploy();
    goodCompoundStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good DAI",
      "gDAI",
      "172800",
      daiUsdOracle.address,
      "100000"
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
    bat = await daiFactory.deploy(); // Another erc20 token for uniswap router test
    cBat = await cBatFactory.deploy(bat.address);
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
    setDAOAddress("UNISWAP_ROUTER", uniswapRouter.address);
    await factory.createPair(bat.address, dai.address); // Create tokenA and dai pair
    const pairAddress = factory.getPair(bat.address, dai.address);
    pair = new Contract(
      pairAddress,
      JSON.stringify(IUniswapV2Pair.abi),
      staker
    ).connect(founder);
    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();
    const gasFeeMockFactory = await ethers.getContractFactory(
      "GasPriceMockOracle"
    );
    gasFeeOracle = await gasFeeMockFactory.deploy();
    const daiEthPriceMockFactory = await ethers.getContractFactory(
      "DaiEthPriceMockOracle"
    );
    daiEthOracle = await daiEthPriceMockFactory.deploy();

    const ethUsdOracleFactory = await ethers.getContractFactory(
      "EthUSDMockOracle"
    );

    batUsdOracle = await tokenUsdOracleFactory.deploy();
    ethUsdOracle = await ethUsdOracleFactory.deploy();
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("2000000")
    );
    await bat["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("2000000")
    );

    await addLiquidity(
      ethers.utils.parseEther("2000000"),
      ethers.utils.parseEther("2000000")
    );
    await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
  });

  it("should be set rewards per block for particular stacking contract", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
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
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
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
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 0, false);
    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    await advanceBlocks(4);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);
    expect(gdBalancerAfterWithdraw.toString()).to.be.equal("2500");
  });

  it("shouldn't be able to earn rewards after rewards blockend passed", async () => {
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);

    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    advanceBlocks(5);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);

    expect(gdBalancerAfterWithdraw.toString()).to.be.equal(
      gdBalanceBeforeWithdraw.toString()
    );
  });

  it("shouldn't be able to mint reward when staking contract is blacklisted", async () => {
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const goodCompoundStaking2 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good DAI",
      "gDAI",
      "172800",
      daiUsdOracle.address,
      "100000"
    );

    let encodedDataTwo = goodFundManager.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", goodCompoundStaking2.address, "55", "1000", false] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedDataTwo);

    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking2.address, stakingAmount);
    await goodCompoundStaking2.connect(staker).stake(stakingAmount, 100, false);

    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    advanceBlocks(5);

    encodedDataTwo = goodFundManager.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", goodCompoundStaking2.address, "55", "1000", true] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedDataTwo);

    await goodCompoundStaking2
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);

    expect(gdBalancerAfterWithdraw).to.be.equal(gdBalanceBeforeWithdraw);
  });

  // it("should set blacklisted false and mint rewards", async () => {
  //   const goodFundManagerFactory = await ethers.getContractFactory(
  //     "GoodFundManager"
  //   );
  //   const ictrl = await ethers.getContractAt(
  //     "Controller",
  //     controller,
  //     schemeMock
  //   );
  //   const currentBlockNumber = await ethers.provider.getBlockNumber();
  //   const encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
  //     "setStakingReward",
  //     [
  //       "1000",
  //       goodCompoundStaking.address,
  //       currentBlockNumber,
  //       currentBlockNumber + 500,
  //       false
  //     ] // set 10 gd per block
  //   );
  //   await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
  //   let stakingAmount = ethers.utils.parseEther("100");
  //   await dai["mint(address,uint256)"](staker.address, stakingAmount);
  //   await dai
  //     .connect(staker)
  //     .approve(goodCompoundStaking.address, stakingAmount);
  //   await goodCompoundStaking.connect(staker).stake(stakingAmount, 0);

  //   let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
  //   advanceBlocks(5);
  //   await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
  //   let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);
  //   let gCDAIbalanceAfter = await goodCompoundStaking.balanceOf(staker.address);
  //   let gCDAITotalSupply = await goodCompoundStaking.totalSupply();
  //   expect(gCDAIbalanceAfter).to.be.equal(gCDAITotalSupply); // staker should own whole staking tokens
  //   expect(gdBalancerAfterWithdraw.toString()).to.be.equal("5500"); // should mint previous rewards as well
  // });

  it("it should send staker's productivity to some other user", async () => {
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);
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
      goodCompoundStaking.connect(staker).withdrawStake(stakingAmount, false)
    ).to.be.reverted;
  });

  it("it should be able to withdraw their stake when got staking tokens from somebody else", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await goodCompoundStaking.withdrawStake(stakingAmount, false);

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
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);

    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("1000000")
    );
    await dai
      .connect(staker)
      .transfer(cDAI.address, ethers.utils.parseEther("1000000")); // We should put extra DAI to mock cDAI contract in order to provide interest
    await cDAI.increasePriceWithMultiplier("1500"); // increase interest by calling exchangeRateCurrent

    const currentUBIInterestBeforeWithdraw = await goodCompoundStaking.currentUBIInterest();
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    const gdBalanceBeforeCollectInterest = await goodDollar.balanceOf(
      staker.address
    );
    const contractAddressesToBeCollected = await goodFundManager.calcSortedContracts(
      "1100000"
    );
    console.log(contractAddressesToBeCollected.toString());
    await goodFundManager
      .connect(staker)
      .collectInterest(contractAddressesToBeCollected);
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
    await genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);

    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 0, false);

    await advanceBlocks(4);
    const stakingContractVals = await goodFundManager.rewardsForStakingContract(
      goodCompoundStaking.address
    );
    let rewardsEarned = await goodCompoundStaking.getUserPendingReward(
      staker.address,
      stakingContractVals[0],
      stakingContractVals[1],
      stakingContractVals[2]
    );
    expect(rewardsEarned.toString()).to.be.equal("2000"); // Each block reward is 10gd so total reward 40gd but since multiplier is 0.5 for first month should get 20gd
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
  });

  it("it should get rewards with 1x multiplier for after threshold pass", async () => {
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const simpleStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good DAI",
      "gDAI",
      "50",
      daiUsdOracle.address,
      "100000"
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking.address,
        currentBlockNumber,
        currentBlockNumber + 100,
        false
      ] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);

    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai.connect(staker).approve(simpleStaking.address, stakingAmount);
    let gdBalanceStakerBeforeWithdraw = await goodDollar.balanceOf(
      staker.address
    );
    await simpleStaking.connect(staker).stake(stakingAmount, 0, false);

    await advanceBlocks(54);
    await simpleStaking.connect(staker).withdrawStake(stakingAmount, false);
    let gdBalanceStakerAfterWithdraw = await goodDollar.balanceOf(
      staker.address
    );

    expect(
      gdBalanceStakerAfterWithdraw.sub(gdBalanceStakerBeforeWithdraw).toString()
    ).to.be.equal("30000"); // 50 blocks reward worth 500gd but since it's with the 0.5x multiplier so 250gd then there is 5 blocks which gets full reward so total reward is 300gd
    encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking.address,
        currentBlockNumber,
        currentBlockNumber + 100,
        true
      ] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
  });

  it("Should transfer somebody's staking token's when they approve", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);
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
    await goodCompoundStaking.withdrawStake(stakingAmount, false);
  });

  it("Should be able to withdraw rewards without withdraw stake", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);
    await advanceBlocks(5);
    const stakingContractVals = await goodFundManager.rewardsForStakingContract(
      goodCompoundStaking.address
    );
    const earnedRewardBeforeWithdrawReward = await goodCompoundStaking.getUserPendingReward(
      staker.address,
      stakingContractVals[0],
      stakingContractVals[1],
      stakingContractVals[2]
    );
    await goodCompoundStaking.connect(staker).withdrawRewards();
    const earnedRewardAfterWithdrawReward = await goodCompoundStaking.getUserPendingReward(
      staker.address,
      stakingContractVals[0],
      stakingContractVals[1],
      stakingContractVals[2]
    );

    expect(earnedRewardAfterWithdrawReward.lt(earnedRewardBeforeWithdrawReward))
      .to.be.true;
    expect(earnedRewardAfterWithdrawReward.toString()).to.be.equal("0");
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
  });
  it("it should not mint reward when staking contract is not registered", async () => {
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
      "50",
      daiUsdOracle.address,
      "100000"
    );
    const tx = await simpleStaking.withdrawRewards().catch(e => e);
    expect(tx.message).to.have.string("Staking contract not registered");
  });
  it("it should be able to distribute rewards when blockEnd passed but last Reward block was before blockend", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        goodCompoundStaking.address,
        currentBlockNumber - 10,
        currentBlockNumber + 50,
        false
      ] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData);
    const stakingAmount = ethers.utils.parseEther("100");
    const initialGdBalance = await goodDollar.balanceOf(staker.address);
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 0, false);
    await advanceBlocks(5);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount.div(2), false);
    const gdBalanceAfterFirstWithdraw = await goodDollar.balanceOf(
      staker.address
    );
    const firstWithdrawBlockNumber = await ethers.provider.getBlockNumber();
    await advanceBlocks(60);

    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount.div(2), false);
    const gdBalanceAfterSecondWithdraw = await goodDollar.balanceOf(
      staker.address
    );
    expect(gdBalanceAfterFirstWithdraw).to.be.gt(initialGdBalance);
    expect(gdBalanceAfterFirstWithdraw.sub(initialGdBalance)).to.be.equal(
      BN.from("1000")
        .mul(firstWithdrawBlockNumber - stakeBlockNumber)
        .div(2)
    );
    expect(gdBalanceAfterSecondWithdraw).to.be.gt(gdBalanceAfterFirstWithdraw);
    expect(
      gdBalanceAfterSecondWithdraw.sub(gdBalanceAfterFirstWithdraw)
    ).to.be.equal(
      BN.from("1000")
        .mul(currentBlockNumber + 50 - firstWithdrawBlockNumber)
        .div(2)
        .sub(1)
    ); // sub 1 due to precision loss
  });
  it("it should not earn rewards when currentBlock < blockStart", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        goodCompoundStaking.address,
        currentBlockNumber + 100,
        currentBlockNumber + 500,
        false
      ] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData);
    const stakingAmount = ethers.utils.parseEther("100");
    const initialGdBalance = await goodDollar.balanceOf(staker.address);
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 0, false);
    await advanceBlocks(50);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    const gdBalanceAfterWithdraw = await goodDollar.balanceOf(staker.address);

    expect(initialGdBalance).to.be.gt(0);
    expect(gdBalanceAfterWithdraw).to.be.equal(initialGdBalance);
  });

  it("it should earn rewards when they stake before blockStart but keep their stake until after blockStart", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        goodCompoundStaking.address,
        currentBlockNumber + 30,
        currentBlockNumber + 500,
        false
      ] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData);
    const stakingAmount = ethers.utils.parseEther("100");
    const initialGdBalance = await goodDollar.balanceOf(staker.address);
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 0, false);
    await advanceBlocks(50);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const gdBalanceAfterWithdraw = await goodDollar.balanceOf(staker.address);
    expect(initialGdBalance).to.be.gt(0);
    expect(gdBalanceAfterWithdraw).to.be.gt(initialGdBalance);
    expect(gdBalanceAfterWithdraw.sub(initialGdBalance)).to.be.equal(
      BN.from("1000")
        .mul(withdrawBlockNumber - (currentBlockNumber + 30))
        .div(2)
        .sub(1)
    );
  });
  it("should be able earn to 50% of rewards when owns 50% of total productivity", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        goodCompoundStaking.address,
        currentBlockNumber - 10,
        currentBlockNumber + 100,
        false
      ] // set 10 gd per block
    );

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

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);
    await goodCompoundStaking
      .connect(signers[0])
      .stake(stakingAmount, 100, false);
    await advanceBlocks(5);

    const ubiAmount = await goodCompoundStaking.currentUBIInterest();

    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    await goodCompoundStaking
      .connect(signers[0])
      .withdrawStake(stakingAmount, false);
    let stakerTwoGDAmountAfterStake = await goodDollar.balanceOf(
      signers[0].address
    );
    let stakerGDAmountAfterStake = await goodDollar.balanceOf(staker.address);
    expect(
      stakerTwoGDAmountAfterStake.sub(stakerTwoGDAmountBeforeStake).toString()
    ).to.be.equal(
      stakerGDAmountAfterStake.sub(stakerGDAmountBeforeStake).toString()
    );
  });
  it("Accumulated per share has enough precision when reward << totalproductivity", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );

    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        goodCompoundStaking.address,
        currentBlockNumber - 10,
        currentBlockNumber + 100,
        false
      ] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    const stakingAmount = ethers.utils.parseEther("1000000000");
    await dai["mint(address,uint256)"](founder.address, stakingAmount); // 1 billion dai to stake
    await dai.approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.stake(stakingAmount, 0, false);
    await advanceBlocks(4);
    const gdBalanceBeforeWithdraw = await goodDollar.balanceOf(founder.address);
    await goodCompoundStaking.withdrawStake(stakingAmount, false);
    const gdBalanceAfterWithdraw = await goodDollar.balanceOf(founder.address);
    expect(
      gdBalanceAfterWithdraw.sub(gdBalanceBeforeWithdraw).toString()
    ).to.be.equal("2500");
  });

  it("it should not get any reward when donationPer set to 100", async () => {
    const stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    let stakerGDAmountBeforeStake = await goodDollar.balanceOf(staker.address);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);
    await advanceBlocks(4);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    let stakerGDAmountAfterStake = await goodDollar.balanceOf(staker.address);
    expect(stakerGDAmountAfterStake).to.be.equal(stakerGDAmountBeforeStake);
  });
  it("it should be reverted when donation per set to different than 0 or 100", async () => {
    const stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    const tx = await goodCompoundStaking
      .connect(staker)
      .stake(stakingAmount, 55, false)
      .catch(e => e);
    expect(tx.message).to.have.string("Donation percentage should be 0 or 100");
  });

  it("should be able to sort staking contracts and collect interests from highest to lowest and only one staking contract's interest should be collected due to gas amount [ @skip-on-coverage ]", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);

    await cDAI.increasePriceWithMultiplier("6000"); // increase interest by calling exchangeRateCurrent

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
      "50",
      daiUsdOracle.address,
      "100000"
    );
    const simpleStaking1 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good DAI",
      "gDAI",
      "50",
      daiUsdOracle.address,
      "100000"
    );
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking.address, 0, 10, false]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai.connect(staker).approve(simpleStaking.address, stakingAmount);
    await simpleStaking.connect(staker).stake(stakingAmount, 100, false);
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai.connect(staker).approve(simpleStaking1.address, stakingAmount);
    await simpleStaking1.connect(staker).stake(stakingAmount, 100, false);

    await cDAI.increasePriceWithMultiplier("200"); // increase interest by calling increasePriceWithMultiplier
    const simpleStakingCurrentInterestBeforeCollect = await simpleStaking.currentUBIInterest();
    const contractsToBeCollected = await goodFundManager.calcSortedContracts(
      "960000"
    );
    await goodFundManager.collectInterest(contractsToBeCollected, {
      gasLimit: 960000
    });
    const simpleStakingCurrentInterest = await simpleStaking.currentUBIInterest();
    const goodCompoundStakingCurrentInterest = await goodCompoundStaking.currentUBIInterest();

    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking.address, 0, 10, true]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    expect(goodCompoundStakingCurrentInterest[0].toString()).to.be.equal("0"); // Goodcompound staking's interest should be collected so currentinterest should be 0
    expect(simpleStakingCurrentInterestBeforeCollect[0]).to.be.equal(
      simpleStakingCurrentInterest[0]
    ); // simple staking's interest shouldn't be collected so currentinterest should be equal to before collectinterest
  });

  it("It should not collect interest when interest is lower than gas cost [ @skip-on-coverage ]", async () => {
    const stakingAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);
    const contractsToInterestCollected = await goodFundManager.calcSortedContracts(
      "800000"
    );
    const transaction = await goodFundManager
      .collectInterest([goodCompoundStaking.address], {
        gasLimit: 770000
      })
      .catch(e => e);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    expect(transaction.message).to.have.string(
      "Collected interest value should be interestMultiplier x gas costs"
    );
    expect(contractsToInterestCollected.length).to.be.equal(0);
  });

  it("It should sort array from lowest to highest ", async () => {
    const goodFundManagerTestFactory = await ethers.getContractFactory(
      "GoodFundManagerTest"
    );
    const goodFundManagerTest = await goodFundManagerTestFactory.deploy(
      nameService.address,
      cDAI.address,
      founder.address,
      founder.address,
      "30"
    );
    const addresses = [
      founder.address,
      staker.address,
      cDAI.address,
      cDAI1.address
    ];
    const balances = [
      ethers.utils.parseEther("100"),
      ethers.utils.parseEther("85"),
      ethers.utils.parseEther("90"),
      ethers.utils.parseEther("30")
    ];
    const sortedArrays = await goodFundManagerTest.testSorting(
      balances,
      addresses
    );
    expect(sortedArrays[0][0]).to.be.equal(ethers.utils.parseEther("30"));
    expect(sortedArrays[0][3]).to.be.equal(ethers.utils.parseEther("100"));
    expect(sortedArrays[1][3]).to.be.equal(founder.address);
    expect(sortedArrays[1][0]).to.be.equal(cDAI1.address);
  });

  it("It should not be able to calc and sort array when there is no active staking contract", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", goodCompoundStaking.address, 0, 10, true]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    const contractsToInterestCollected = await goodFundManager.calcSortedContracts(
      "800000"
    );
    expect(contractsToInterestCollected.length).to.be.equal(0);
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", goodCompoundStaking.address, 100, 1000, false]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
  });

  it("it should return empty array with calcSortedContracts when requirements does not meet", async () => {
    const contractsToInterestCollected = await goodFundManager.calcSortedContracts(
      "800000"
    );
    expect(contractsToInterestCollected.length).to.be.equal(0);
  });

  it("collected interest should be greater than gas cost when 2 months passed", async () => {
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const currentBlock = await ethers.provider.getBlock(currentBlockNumber);

    await ethers.provider.send("evm_setNextBlockTimestamp", [
      currentBlock.timestamp + 5184020
    ]);
    await ethers.provider.send("evm_mine", []);
    const collectableContracts = await goodFundManager
      .calcSortedContracts("700000")
      .catch(e => e);
    const tx = await goodFundManager
      .collectInterest([goodCompoundStaking.address])
      .catch(e => e);
    expect(tx.message).to.have.string(
      "Collected interest value should be larger than spent gas costs"
    );
  });

  it("Avatar should be able to set gd minting gas amount", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setGasCost",
      ["140000"]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
  });
  it("Avatar should be able to set collectInterestTimeThreshold", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setCollectInterestTimeThreshold",
      ["5184000"]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
  });
  it("Avatar should be able set interestMultiplier", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setInterestMultiplier",
      ["4"]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
  });
  it("Avatar should be able set gasCostExceptInterestCollect", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setGasCostExceptInterestCollect",
      ["650000"]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
  });

  it("It should be able to collect Interest from non DAI or cDAI staking contract [ @skip-on-coverage ]", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const simpleStaking = await goodCompoundStakingFactory.deploy(
      bat.address,
      cBat.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good BaT",
      "gBAT",
      "50",
      batUsdOracle.address,
      "100000"
    );
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking.address, 10, 10000, false]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    encodedData = goodCompoundStakingFactory.interface.encodeFunctionData(
      "setcollectInterestGasCost",
      ["300000"]
    );
    await genericCall(simpleStaking.address, encodedData, avatar, 0);
    await bat["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("1001000")
    );
    await bat.transfer(cBat.address, ethers.utils.parseEther("1000000")); // We should put extra BAT to mock cBAT contract in order to provide interest
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("1000000")
    );
    await dai.approve(
      goodCompoundStaking.address,
      ethers.utils.parseEther("100")
    );
    await goodCompoundStaking.stake(ethers.utils.parseEther("100"), 100, false);
    await bat.approve(simpleStaking.address, ethers.utils.parseEther("100"));
    await simpleStaking.stake(ethers.utils.parseEther("100"), 100, false);

    await cDAI.increasePriceWithMultiplier("2000");
    await cBat.increasePriceWithMultiplier("500");

    const collectableContracts = await goodFundManager.calcSortedContracts(
      "1500000"
    );
    await goodFundManager.collectInterest(collectableContracts, {
      gasLimit: 1500000
    });
    await simpleStaking.withdrawStake(ethers.utils.parseEther("100"), false);
    await goodCompoundStaking.withdrawStake(
      ethers.utils.parseEther("100"),
      false
    );
  });
  it("It should redeem underlying token to DAI", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const goodCompoundStakingTestFactory = await ethers.getContractFactory(
      "GoodCompoundStakingTest"
    );
    const simpleStaking = await goodCompoundStakingTestFactory.deploy(
      bat.address,
      cBat.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good BaT",
      "gBAT",
      "50",
      batUsdOracle.address,
      "100000"
    );
    await bat["mint(address,uint256)"](
      cBat.address,
      ethers.utils.parseEther("1000")
    );
    await cBat["mint(address,uint256)"](
      simpleStaking.address,
      ethers.utils.parseUnits("1000", 8)
    );
    const balanceBeforeRedeem = await dai.balanceOf(simpleStaking.address);
    await simpleStaking.redeemUnderlyingToDAITest(
      ethers.utils.parseUnits("10", 8)
    );
    const balanceAfterRedeem = await dai.balanceOf(simpleStaking.address);
    const accAmountPerShare = await simpleStaking.interestsPerBlock();
    expect(accAmountPerShare.toString()).to.be.equal("0");
    expect(balanceAfterRedeem.gt(balanceBeforeRedeem)).to.be.true;
  });
  it("it should reverted when someone trying to call rewardsMinted function beside fundmanager", async () => {
    const tx = await goodCompoundStaking
      .rewardsMinted(founder.address, "1000", 50, 100)
      .catch(e => e);
    expect(tx.message).to.have.string("Only FundManager can call this method");
  });

  it("it should not decrease proudctivity when there is no enough amount of stake", async () => {
    const goodCompoundStakingTestFactory = await ethers.getContractFactory(
      "GoodCompoundStakingTest"
    );
    const simpleStaking = await goodCompoundStakingTestFactory.deploy(
      bat.address,
      cBat.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good BaT",
      "gBAT",
      "50",
      batUsdOracle.address,
      "100000"
    );
    const tx = await simpleStaking
      .decreaseProductivityTest(founder.address, ethers.utils.parseEther("100"))
      .catch(e => e);
    expect(tx.message).to.have.string("INSUFFICIENT_PRODUCTIVITY");
  });

  it("User pending reward should be zero when there is no stake of user", async () => {
    const goodCompoundStakingTestFactory = await ethers.getContractFactory(
      "GoodCompoundStakingTest"
    );
    const simpleStaking = await goodCompoundStakingTestFactory.deploy(
      bat.address,
      cBat.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good BaT",
      "gBAT",
      "50",
      batUsdOracle.address,
      "100000"
    );
    let encodedData = goodCompoundStakingTestFactory.interface.encodeFunctionData(
      "setcollectInterestGasCost",
      ["100000"]
    );
    await genericCall(simpleStaking.address, encodedData, avatar, 0);
    const stakingContractVals = await goodFundManager.rewardsForStakingContract(
      goodCompoundStaking.address
    );
    const pendingReward = await simpleStaking.getUserPendingReward(
      founder.address,
      stakingContractVals[0],
      stakingContractVals[1],
      stakingContractVals[2]
    );
    expect(pendingReward.toString()).to.be.equal("0");
  });
  it("It should not transfer staking token where there is no enough balance", async () => {
    const goodCompoundStakingTestFactory = await ethers.getContractFactory(
      "GoodCompoundStakingTest"
    );
    const simpleStaking = await goodCompoundStakingTestFactory.deploy(
      bat.address,
      cBat.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good BaT",
      "gBAT",
      "50",
      batUsdOracle.address,
      "100000"
    );
    const tx = await simpleStaking
      .transfer(staker.address, "10000")
      .catch(e => e);
    expect(tx.message).to.have.string("ERC20: transfer amount exceeds balance");
  });

  async function addLiquidity(
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await bat.transfer(pair.address, token0Amount);
    await dai.transfer(pair.address, token1Amount);
    await pair.mint(founder.address);
  }

  it("should not undo staking contract blacklisting", async () => {
    let encodedData = goodFundManager.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", signers[0].address, 10, 1000, true] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData);
    let data = await goodFundManager.rewardsForStakingContract(
      signers[0].address
    );
    expect(data.isBlackListed).to.equal(true);

    encodedData = goodFundManager.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", signers[0].address, 10, 1000, false] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData);
    data = await goodFundManager.rewardsForStakingContract(signers[0].address);
    expect(data.isBlackListed).to.equal(true);
  });

  it("it should remove staking contract from active staking contracts when it's reward set to zero", async () => {
    const goodCompoundStakingTestFactory = await ethers.getContractFactory(
      "GoodCompoundStakingTest"
    );
    const simpleStaking1 = await goodCompoundStakingTestFactory.deploy(
      bat.address,
      cBat.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good BaT",
      "gBAT",
      "50",
      batUsdOracle.address,
      "100000"
    );
    let encodedData = goodFundManager.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", simpleStaking1.address, 10, 1000, false] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    const activeContractsCount = await goodFundManager.getActiveContractsCount();
    const lastActiveContractBeforeAdd = await goodFundManager.activeContracts(
      activeContractsCount.sub(1)
    );

    const simpleStaking = await goodCompoundStakingTestFactory.deploy(
      bat.address,
      cBat.address,
      BLOCK_INTERVAL,
      nameService.address,
      "Good BaT",
      "gBAT",
      "50",
      batUsdOracle.address,
      "100000"
    );
    encodedData = goodFundManager.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", simpleStaking.address, 10, 1000, false] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    const activeContractsCountAfterAdded = await goodFundManager.getActiveContractsCount();
    const lastActiveContractAfterAdd = await goodFundManager.activeContracts(
      activeContractsCountAfterAdded.sub(1)
    );
    encodedData = goodFundManager.interface.encodeFunctionData(
      "setStakingReward",
      ["0", simpleStaking.address, 10, 1000, false] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);

    const activeContractsCountAfterRemoved = await goodFundManager.getActiveContractsCount();
    const lastActiveContractAfterRemove = await goodFundManager.activeContracts(
      activeContractsCountAfterRemoved.sub(1)
    );
    expect(lastActiveContractBeforeAdd).to.be.equal(
      lastActiveContractAfterRemove
    );
    expect(lastActiveContractAfterAdd).to.be.equal(simpleStaking.address);
    expect(activeContractsCountAfterAdded).to.be.gt(activeContractsCount);
    expect(activeContractsCountAfterAdded).to.be.gt(
      activeContractsCountAfterRemoved
    );
    expect(activeContractsCount).to.be.equal(activeContractsCountAfterRemoved);
  });

  it("it should calculate price of spent gas in DAI properly", async () => {
    const gasAmount = BN.from("1100000"); // 1.1M
    const gasPrice = await gasFeeOracle.latestAnswer(); // returns 25 gwei
    const daiToEthRate = await daiEthOracle.latestAnswer(); // returns  0.000341481428801721 and we accept 1$ = 1DAI
    const calculatedResult = gasPrice
      .mul(BN.from("10").pow(18))
      .div(daiToEthRate)
      .mul(gasAmount); // Result should be around 80.53$
    const onChainResult = await goodFundManager.getGasPriceIncDAIorDAI(
      gasAmount,
      true
    );
    expect(calculatedResult).to.be.gt(0);
    expect(onChainResult).to.be.equal(calculatedResult);
  });
  it("it should calculate price of spent gas in cDAI properly", async () => {
    const gasAmount = BN.from("1100000"); // 1.1M
    const gasPrice = await gasFeeOracle.latestAnswer(); // returns 25 gwei
    const daiToEthRate = await daiEthOracle.latestAnswer(); // returns  0.000341481428801721 and we accept 1$ = 1DAI
    const gasPriceInDAI = gasPrice.mul(BN.from("10").pow(18)).div(daiToEthRate);
    const gasPriceInCdai = gasPriceInDAI
      .div(BN.from("10").pow(10))
      .mul(BN.from("10").pow(28))
      .div(await cDAI.exchangeRateStored());
    const calculatedResult = gasPriceInCdai.mul(gasAmount);
    const onChainResult = await goodFundManager.getGasPriceIncDAIorDAI(
      gasAmount,
      false
    );
    expect(calculatedResult).to.be.gt(0);
    expect(onChainResult).to.be.equal(calculatedResult);
  });
});
