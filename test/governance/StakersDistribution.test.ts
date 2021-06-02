import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
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

describe("StakersDistribution - staking with GD  and get Rewards in GDAO", () => {
  let dai: Contract;
  let cDAI: Contract;
  let goodReserve: GoodReserveCDai;
  let stakersDistribution: Contract;
  let goodFundManager: Contract;
  let simpleStaking: Contract;
  let simpleUsdcStaking: Contract;
  let usdcUsdOracle: Contract;
  let usdc: Contract;
  let cUsdc: Contract;
  let grep: GReputation;
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
    genericCall,
    setDAOAddress,
    daiEthOracle,
    ethUsdOracle,
    gasFeeOracle,
    daiUsdOracle;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cUsdcFactory = await ethers.getContractFactory("cUSDCMock");
    const usdcFactory = await ethers.getContractFactory("USDCMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const stakersDistributiongFactory = await ethers.getContractFactory(
      "StakersDistribution"
    );
    const simpleStakingFactory = await ethers.getContractFactory(
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
      reputation,
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
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    const tokenUsdOracleFactory = await ethers.getContractFactory(
      "BatUSDMockOracle"
    );
    daiUsdOracle = await tokenUsdOracleFactory.deploy();
    usdc = await usdcFactory.deploy();
    cUsdc = await cUsdcFactory.deploy(usdc.address);
    usdcUsdOracle = await tokenUsdOracleFactory.deploy();
    simpleUsdcStaking = await simpleStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          usdc.address,
          cUsdc.address,
          nameService.address,
          "Good USDC",
          "gUSDC",
          "172800",
          usdcUsdOracle.address,
          "200000"
        );
        return contract;
      });

    simpleStaking = await simpleStakingFactory.deploy().then(async contract => {
      await contract.init(
        dai.address,
        cDAI.address,
        nameService.address,
        "Good DAI",
        "gDAI",
        "200",
        daiUsdOracle.address,
        "100000"
      );
      return contract;
    });
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
        simpleStaking.address,
        currentBlockNumber,
        currentBlockNumber + 1000,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    stakersDistribution = await upgrades.deployProxy(
      stakersDistributiongFactory,
      [nameService.address],
      { kind: "uups" }
    );

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

    const ethUsdOracleFactory = await ethers.getContractFactory(
      "EthUSDMockOracle"
    );
    daiEthOracle = await daiEthPriceMockFactory.deploy();
    ethUsdOracle = await ethUsdOracleFactory.deploy();
    await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
    await setDAOAddress("GDAO_STAKERS", stakersDistribution.address);
  });

  it("it should have 2M monthly Reputation distribution", async () => {
    const monthlyReputationDistribution = await stakersDistribution.monthlyReputationDistribution();
    expect(monthlyReputationDistribution).to.be.equal(
      ethers.utils.parseEther("2000000")
    );
  });

  it("it should have 0 monthly rewards since staking amount was zero while initializing stakersDistribution", async () => {
    const rewardsPerBlock = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );
    expect(rewardsPerBlock).to.be.equal(0);
  });

  it("It should update monthly rewards according to staking amount of staking contract after one month passed from initialized", async () => {
    const stakingAmount = ethers.utils.parseEther("1000");
    const rewardsPerBlockBeforeStake = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );

    await dai["mint(address,uint256)"](staker.address, stakingAmount.mul(2));
    await dai
      .connect(staker)
      .approve(simpleStaking.address, stakingAmount.mul(2));
    await simpleStaking.connect(staker).stake(stakingAmount, 0, false);
    await increaseTime(86700 * 30);
    await simpleStaking.connect(staker).stake(stakingAmount, 0, false);
    const rewardsPerBlockAfterStake = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );
    await simpleStaking
      .connect(staker)
      .withdrawStake(stakingAmount.mul(2), false);
    const rewardsPerBlockAfterWithdraw = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );
    const chainBlockPerMonth = await stakersDistribution.getChainBlocksPerMonth();
    expect(rewardsPerBlockBeforeStake).to.be.equal(BN.from("0"));
    expect(rewardsPerBlockAfterStake).to.be.equal(
      ethers.utils.parseEther("2000000").div(chainBlockPerMonth)
    );
    expect(rewardsPerBlockAfterStake).to.be.equal(rewardsPerBlockAfterWithdraw);
  });

  it("it should not be set monthly reputation when not Avatar", async () => {
    const transaction = await stakersDistribution
      .setMonthlyReputationDistribution("1000000")
      .catch(e => e);
    expect(transaction.message).to.have.string(
      "only avatar can call this method"
    );
  });

  it("it should set monthly reputation when Avatar", async () => {
    let encoded = stakersDistribution.interface.encodeFunctionData(
      "setMonthlyReputationDistribution",
      [ethers.utils.parseEther("1000000")]
    );
    await genericCall(stakersDistribution.address, encoded);
    const monthlyReputationDistribution = await stakersDistribution.monthlyReputationDistribution();
    expect(monthlyReputationDistribution).to.be.equal(
      ethers.utils.parseEther("1000000")
    );
    encoded = stakersDistribution.interface.encodeFunctionData(
      "setMonthlyReputationDistribution",
      [ethers.utils.parseEther("2000000")]
    );
    await genericCall(stakersDistribution.address, encoded);
  });

  it("it should distribute monthly rewards according to staking amount of contracts so in this particular case simpleStaking contract should get %75 of the monthly rewards ", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const simpleStaking1 = await simpleStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "200",
          daiUsdOracle.address,
          "100000"
        );
        return contract;
      });

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking1.address,
        currentBlockNumber,
        currentBlockNumber + 1000,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    const stakingAmount = ethers.utils.parseEther("1000");
    const rewardsPerBlockBeforeStakeContractOne = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );
    const rewardsPerBlockBeforeStakeContractTwo = await stakersDistribution.rewardsPerBlock(
      simpleStaking1.address
    );

    await dai["mint(address,uint256)"](staker.address, stakingAmount.mul(100));
    await dai
      .connect(staker)
      .approve(simpleStaking.address, stakingAmount.mul(75));
    await simpleStaking.connect(staker).stake(stakingAmount.mul(50), 0, false);
    await dai
      .connect(staker)
      .approve(simpleStaking1.address, stakingAmount.mul(25));
    await simpleStaking1.connect(staker).stake(stakingAmount.mul(25), 0, false);
    await increaseTime(86700 * 30); // Increase one month
    await simpleStaking.connect(staker).stake(stakingAmount.mul(25), 0, false);

    const rewardsPerBlockAfterStakeContractOne = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );
    const rewardsPerBlockAftereStakeContractTwo = await stakersDistribution.rewardsPerBlock(
      simpleStaking1.address
    );
    await simpleStaking
      .connect(staker)
      .withdrawStake(stakingAmount.mul(75), false);
    expect(rewardsPerBlockAfterStakeContractOne).to.be.equal(
      rewardsPerBlockAftereStakeContractTwo.mul(3).add(2314817)
    ); // added 2,314,817 cause of precision loss
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking1.address,
        currentBlockNumber,
        currentBlockNumber + 1000,
        true
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
  });

  it("It should not update monthly rewards if staking contract's blockEnd Passed", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking.address,
        currentBlockNumber - 5,
        currentBlockNumber + 20,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    const stakingAmount = ethers.utils.parseEther("1000");
    await dai["mint(address,uint256)"](staker.address, stakingAmount.mul(2));
    await dai
      .connect(staker)
      .approve(simpleStaking.address, stakingAmount.mul(2));
    const rewardsPerBlockBeforeStake = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );
    await simpleStaking.connect(staker).stake(stakingAmount, 0, false);
    await advanceBlocks(40);
    await increaseTime(86700 * 30); // Increase one month
    const stakerGDAOBalanceBeforeStake = await grep.balanceOf(staker.address);
    await simpleStaking.connect(staker).stake(stakingAmount, 0, false);
    const stakerGDAOBalanceAfterStake = await grep.balanceOf(staker.address);
    await simpleStaking.connect(staker).withdrawRewards();

    const rewardsPerBlockAfterStake = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(staker.address);
    await advanceBlocks(10);
    await simpleStaking.connect(staker).withdrawStake(stakingAmount, false);
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(staker.address);
    expect(rewardsPerBlockAfterStake).to.be.equal(rewardsPerBlockBeforeStake); // Should not update rewards per block since simplestaking blockend passed
    expect(GDAOBalanceBeforeWithdraw).to.be.equal(GDAOBalanceAfterWithdraw); // Should not earn any GDAO since simplestaking blockend passed
    expect(stakerGDAOBalanceAfterStake.gt(stakerGDAOBalanceBeforeStake)).to.be
      .true;
  });

  it("it should give distribute if blockend passed but some of the rewards during reward period was not distributed", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking.address,
        currentBlockNumber - 5,
        currentBlockNumber + 20,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    const stakingAmount = ethers.utils.parseEther("1000");
    await simpleStaking.connect(staker).withdrawStake(stakingAmount, false);

    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai.connect(staker).approve(simpleStaking.address, stakingAmount);
    const rewardsPerBlock = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );
    const blockNumberOfStake = (await ethers.provider.getBlockNumber()) + 1;
    await simpleStaking.connect(staker).stake(stakingAmount, 0, false);
    await advanceBlocks(30);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(staker.address);
    await simpleStaking.connect(staker).withdrawStake(stakingAmount, false);

    const GDAOBalanceAfterWithdraw = await grep.balanceOf(staker.address);
    expect(GDAOBalanceAfterWithdraw).to.be.gt(GDAOBalanceBeforeWithdraw);

    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(
        rewardsPerBlock.mul(currentBlockNumber + 20 - blockNumberOfStake)
      )
    );
  });

  it("it should not increaseProductivity of staking contract which is blacklisted", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const simpleStaking1 = await simpleStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "200",
          daiUsdOracle.address,
          "100000"
        );
        return contract;
      });

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking1.address,
        currentBlockNumber - 5,
        currentBlockNumber + 20,
        true
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    const stakingAmount = ethers.utils.parseEther("1000");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai.connect(staker).approve(simpleStaking1.address, stakingAmount);
    await simpleStaking1.connect(staker).stake(stakingAmount, 0, false);
    const productivityOfStaker = await stakersDistribution.getProductivity(
      simpleStaking1.address,
      staker.address
    );
    expect(productivityOfStaker[0]).to.be.equal(0);
  });

  it("it should not decreaseProductivity of staking contract which is blacklisted", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const simpleStaking1 = await simpleStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "200",
          daiUsdOracle.address,
          "100000"
        );
        return contract;
      });

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "100000",
        simpleStaking1.address,
        currentBlockNumber - 5,
        currentBlockNumber + 20,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    await increaseTime(86700 * 30); // Increase one month
    const stakingAmount = ethers.utils.parseEther("1000");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai.connect(staker).approve(simpleStaking1.address, stakingAmount);
    await simpleStaking1.connect(staker).stake(stakingAmount, 0, false);
    await advanceBlocks(5); //should accumulate some gdao rewards

    let pendingGDAO = await stakersDistribution.getUserPendingRewards(
      [simpleStaking1.address],
      staker.address
    );

    expect(pendingGDAO).gt(0);

    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking1.address,
        currentBlockNumber - 5,
        currentBlockNumber + 20,
        true
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    await simpleStaking1.connect(staker).withdrawStake(stakingAmount, false);
    const productivityOfStaker = await stakersDistribution.getProductivity(
      simpleStaking1.address,
      staker.address
    );
    expect(productivityOfStaker[0]).to.be.equal(stakingAmount);

    const repBefore = await grep["balanceOf(address)"](staker.address);
    await stakersDistribution.claimReputation(staker.address, [
      simpleStaking1.address
    ]);
    const repAfter = await grep["balanceOf(address)"](staker.address);

    expect(repBefore).to.equal(repAfter); //should not have been awarded rep accumulated before blacklisting contract

    pendingGDAO = await stakersDistribution.getUserPendingRewards(
      [simpleStaking1.address],
      staker.address
    );
    expect(pendingGDAO).equal(0); //should have 0 pending after contract was blacklisted
  });

  it("it should not earn rewards when current block < startBlock", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const simpleStaking1 = await simpleStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "200",
          daiUsdOracle.address,
          "100000"
        );
        return contract;
      });

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking1.address,
        currentBlockNumber + 500,
        currentBlockNumber + 1000,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    const stakingAmount = ethers.utils.parseEther("1000");
    const userProductivityBeforeStaking = await stakersDistribution.getProductivity(
      simpleStaking1.address,
      staker.address
    );
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai.connect(staker).approve(simpleStaking1.address, stakingAmount);
    await simpleStaking1.connect(staker).stake(stakingAmount, 0, false);
    const userProductivityAfterStaking = await stakersDistribution.getProductivity(
      simpleStaking1.address,
      staker.address
    );
    await advanceBlocks(10);
    const userPendingRewards = await stakersDistribution.getUserPendingReward(
      simpleStaking1.address,
      currentBlockNumber + 500,
      currentBlockNumber + 1000,
      staker.address
    );

    expect(userProductivityAfterStaking[0]).to.be.equal(stakingAmount);
    expect(userProductivityAfterStaking[0]).to.be.gt(
      userProductivityBeforeStaking[0]
    );
    expect(userPendingRewards).to.be.equal(0);
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking1.address,
        currentBlockNumber + 500,
        currentBlockNumber + 1000,
        true
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
  });

  it("Accumulated per share has enough precision when reward << totalproductivity", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const simpleStaking1 = await simpleStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "200",
          daiUsdOracle.address,
          "100000"
        );
        return contract;
      });
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking1.address,
        currentBlockNumber - 10,
        currentBlockNumber + 100,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    const stakingAmount = ethers.utils.parseEther("10000000000");
    await dai["mint(address,uint256)"](staker.address, stakingAmount); // 10 billion dai to stake
    await dai.connect(staker).approve(simpleStaking1.address, stakingAmount);
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await simpleStaking1.connect(staker).stake(stakingAmount, 0, false);
    const rewardsPerBlock = await stakersDistribution.rewardsPerBlock(
      simpleStaking1.address
    );
    await advanceBlocks(4);
    const gdaoBalanceBeforeWithdraw = await goodDollar.balanceOf(
      staker.address
    );
    await simpleStaking1.connect(staker).withdrawStake(stakingAmount, false);
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const gdaoBalanceAfterWithdraw = await goodDollar.balanceOf(staker.address);
    const calculatedNewBalance = gdaoBalanceBeforeWithdraw.add(
      rewardsPerBlock.mul(withdrawBlockNumber - stakeBlockNumber)
    );
    expect(gdaoBalanceAfterWithdraw).to.be.gt(gdaoBalanceBeforeWithdraw);

    expect(gdaoBalanceBeforeWithdraw).to.be.equal(calculatedNewBalance);
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking1.address,
        currentBlockNumber + 500,
        currentBlockNumber + 1000,
        true
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
  });

  it("it should distribute rewards properly when staking contract's token is different decimals than 18", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking.address,
        currentBlockNumber - 5,
        currentBlockNumber + 200,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleUsdcStaking.address,
        currentBlockNumber - 5,
        currentBlockNumber + 200,
        false
      ] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    const stakingAmountDai = ethers.utils.parseEther("10000");
    const stakingAmountUsdc = ethers.utils.parseUnits("10000", 6);
    await dai["mint(address,uint256)"](staker.address, stakingAmountDai);
    await dai.connect(staker).approve(simpleStaking.address, stakingAmountDai);
    await usdc["mint(address,uint256)"](staker.address, stakingAmountUsdc);
    await usdc
      .connect(staker)
      .approve(simpleUsdcStaking.address, stakingAmountUsdc);
    await simpleStaking.connect(staker).stake(stakingAmountDai, 0, false);
    await increaseTime(86700 * 30); // Increase one month
    await simpleUsdcStaking.connect(staker).stake(stakingAmountUsdc, 0, false);
    const usdcStakingProductivity = await stakersDistribution.getProductivity(
      simpleUsdcStaking.address,
      staker.address
    );
    const daiStakingProductivity = await stakersDistribution.getProductivity(
      simpleStaking.address,
      staker.address
    );
    await advanceBlocks(10);
    const UserPendingGdaos = await stakersDistribution.getUserPendingRewards(
      [simpleStaking.address, simpleUsdcStaking.address],
      staker.address
    );
    expect(UserPendingGdaos).to.be.gt(0);
    const usdcStakingPendingGdaos = await stakersDistribution.getUserPendingReward(
      simpleUsdcStaking.address,
      currentBlockNumber - 5,
      currentBlockNumber + 200,
      staker.address
    );
    expect(usdcStakingPendingGdaos).to.be.gt(0);
    const daiStakingPendingGdaos = await stakersDistribution.getUserPendingReward(
      simpleStaking.address,
      currentBlockNumber - 5,
      currentBlockNumber + 200,
      staker.address
    );
    expect(daiStakingPendingGdaos).to.be.gt(0);
    const usdcStakingRewardsPerBlock = await stakersDistribution.rewardsPerBlock(
      simpleUsdcStaking.address
    );
    const daiStakingRewardsPerBlock = await stakersDistribution.rewardsPerBlock(
      simpleStaking.address
    );
    const gdaoBalanceBeforeWithdraw = await grep.balanceOf(staker.address);
    await simpleUsdcStaking
      .connect(staker)
      .withdrawStake(stakingAmountUsdc, false);
    await simpleStaking.connect(staker).withdrawStake(stakingAmountDai, false);
    const gdaoBalanceAfterWithdraw = await grep.balanceOf(staker.address);
    expect(gdaoBalanceAfterWithdraw.sub(gdaoBalanceBeforeWithdraw)).to.be.equal(
      UserPendingGdaos.add(usdcStakingRewardsPerBlock).add(
        daiStakingRewardsPerBlock.mul(2)
      )
    );
    expect(UserPendingGdaos).to.be.equal(
      usdcStakingPendingGdaos.add(daiStakingPendingGdaos)
    );
    expect(usdcStakingProductivity[0]).to.be.equal(stakingAmountUsdc.mul(1e12)); // mul with 1e12 since usdc in 6 decimals but we keep productivity in 18 decimals
    expect(daiStakingProductivity[0]).to.be.equal(stakingAmountDai);
    expect(usdcStakingProductivity[0]).to.be.equal(daiStakingProductivity[0]);
    expect(usdcStakingProductivity[1]).to.be.equal(daiStakingProductivity[1]);
    expect(usdcStakingRewardsPerBlock).to.be.equal(
      daiStakingRewardsPerBlock.add(5787037)
    ); // sub 5,787,037 cause of precision loss. Precision loss happens due to cToken has less decimals than Staking Token
  });
});
