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
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("SimpleEightDecimalsSTAking - staking with cEDT mocks", () => {
  let dai: Contract;
  let eightDecimalsToken: Contract;
  let comp: Contract;
  let pair: Contract, uniswapRouter: Contract;
  let cDAI, cEDT: Contract; // cEDT is for c Eight decimal token
  let gasFeeOracle,
    daiEthOracle: Contract,
    daiUsdOracle: Contract,
    eightDecimalsUsdOracle: Contract,
    ethUsdOracle: Contract,
    compUsdOracle: Contract;
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
    setDAOAddress,
    genericCall;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cEDTFactory = await ethers.getContractFactory("cEDTMock");
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
    const edtFactory = await ethers.getContractFactory("EightDecimalsMock");
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
      genericCall: gc,
      setReserveToken
    } = await createDAO();
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    avatar = av;
    controller = ctrl;
    genericCall = gc;
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

    console.log("initializing marketmaker...");

    eightDecimalsToken = await edtFactory.deploy(); // Another erc20 token for uniswap router test
    cEDT = await cEDTFactory.deploy(eightDecimalsToken.address);

    setDAOAddress("UNISWAP_ROUTER", uniswapRouter.address);
    await factory.createPair(eightDecimalsToken.address, dai.address); // Create tokenA and dai pair
    const pairAddress = factory.getPair(
      eightDecimalsToken.address,
      dai.address
    );
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

    eightDecimalsUsdOracle = await tokenUsdOracleFactory.deploy();
    ethUsdOracle = await ethUsdOracleFactory.deploy();
    const daiFactory = await ethers.getContractFactory("DAIMock");
    comp = await daiFactory.deploy();
    await setDAOAddress("COMP", comp.address);
    const compUsdOracleFactory = await ethers.getContractFactory(
      "CompUSDMockOracle"
    );
    compUsdOracle = await compUsdOracleFactory.deploy();
    goodCompoundStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          eightDecimalsToken.address,
          cEDT.address,
          nameService.address,
          "Good EDT",
          "gEDT",
          "172800",
          eightDecimalsUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    const encodedData = goodCompoundStaking.interface.encodeFunctionData(
      "setcollectInterestGasCost",
      ["200000"]
    );
    await genericCall(goodCompoundStaking.address, encodedData);
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("2000000")
    );
    await eightDecimalsToken["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("2000000", 8)
    );

    await addLiquidity(
      ethers.utils.parseUnits("2000000", 8),
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
        currentBlockNumber + 100,
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
      (currentBlockNumber + 100).toString()
    );
    expect(rewardPerBlock[3]).to.be.equal(false);
  });

  it("should be able to earn rewards after some block passed", async () => {
    let stakingAmount = ethers.utils.parseUnits("100", 8);
    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      stakingAmount
    );
    await eightDecimalsToken
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

  it("should be able to stake edt", async () => {
    let totalStakedBefore = await goodCompoundStaking.getProductivity(
      founder.address
    );
    totalStakedBefore = totalStakedBefore[1];
    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseUnits("100", 8)
    );
    await eightDecimalsToken
      .connect(staker)
      .approve(goodCompoundStaking.address, ethers.utils.parseUnits("100", 8));
    await goodCompoundStaking
      .connect(staker)
      .stake(ethers.utils.parseUnits("100", 8), 0, false);
    let totalStakedAfter = await goodCompoundStaking.getProductivity(
      founder.address
    );
    totalStakedAfter = totalStakedAfter[1];
    let balance = await goodCompoundStaking.getStakerData(staker.address);
    expect(balance[0].toString()).to.be.equal(
      ethers.utils.parseUnits("100", 8) //100 edt
    );
    expect(totalStakedAfter.sub(totalStakedBefore).toString()).to.be.equal(
      ethers.utils.parseUnits("100", 8)
    );
    let stakedcEDTBalance = await cEDT.balanceOf(goodCompoundStaking.address);
    expect(stakedcEDTBalance.toString()).to.be.equal(
      "500000000000" //8 decimals precision (99 cedt because of the exchange rate edt <> cedt)
    );
  });

  it("should be able to withdraw stake by staker", async () => {
    let stakedcEDTBalanceBefore = await cEDT.balanceOf(
      goodCompoundStaking.address
    ); // simpleStaking cEDT balance
    let stakerEDTBalanceBefore = await eightDecimalsToken.balanceOf(
      staker.address
    ); // staker EDT balance
    let balanceBefore = await goodCompoundStaking.getStakerData(staker.address); // user staked balance in GoodStaking
    let totalStakedBefore = await goodCompoundStaking.getProductivity(
      founder.address
    ); // total staked in GoodStaking
    totalStakedBefore = totalStakedBefore[1];
    const transaction = await (
      await goodCompoundStaking
        .connect(staker)
        .withdrawStake(balanceBefore[0], false)
    ).wait();
    let stakedcEDTBalanceAfter = await cEDT.balanceOf(
      goodCompoundStaking.address
    ); // simpleStaking cEDT balance
    let stakerEDTBalanceAfter = await eightDecimalsToken.balanceOf(
      staker.address
    ); // staker EDT balance
    let balanceAfter = await goodCompoundStaking.getStakerData(staker.address); // user staked balance in GoodStaking
    let totalStakedAfter = await goodCompoundStaking.getProductivity(
      founder.address
    ); // total staked in GoodStaking
    totalStakedAfter = totalStakedAfter[1];
    expect(stakedcEDTBalanceAfter.lt(stakedcEDTBalanceBefore)).to.be.true;
    expect(stakerEDTBalanceAfter.gt(stakerEDTBalanceBefore)).to.be.true;
    expect(balanceBefore[0].toString()).to.be.equal(
      (stakerEDTBalanceAfter - stakerEDTBalanceBefore).toString()
    );
    expect((totalStakedBefore - totalStakedAfter).toString()).to.be.equal(
      balanceBefore[0].toString()
    );
    expect(balanceAfter[0].toString()).to.be.equal("0");
    expect(stakedcEDTBalanceAfter.toString()).to.be.equal("0");
    expect(transaction.events.find(_ => _.event === "StakeWithdraw")).to.be.not
      .empty;
    expect(
      transaction.events.find(_ => _.event === "StakeWithdraw").args.staker
    ).to.be.equal(staker.address);
    expect(
      transaction.events
        .find(_ => _.event === "StakeWithdraw")
        .args.value.toString()
    ).to.be.equal((stakerEDTBalanceAfter - stakerEDTBalanceBefore).toString());
  });

  it("stake should generate some interest and shoul be used to generate UBI", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 8);

    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      stakingAmount
    );
    await eightDecimalsToken
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);

    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseUnits("1000000", 8)
    );
    await eightDecimalsToken
      .connect(staker)
      .transfer(cEDT.address, ethers.utils.parseUnits("1000000", 8)); // We should put extra EDT to mock cEDT contract in order to provide interest
    await cEDT.increasePriceWithMultiplier("3500"); // increase interest by calling exchangeRateCurrent

    const currentUBIInterestBeforeWithdraw = await goodCompoundStaking.currentGains(
      false,
      true
    );
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    const gdBalanceBeforeCollectInterest = await goodDollar.balanceOf(
      staker.address
    );
    const contractAddressesToBeCollected = await goodFundManager.calcSortedContracts(
      "1300000"
    );
    await goodFundManager
      .connect(staker)
      .collectInterest(contractAddressesToBeCollected);
    const gdBalanceAfterCollectInterest = await goodDollar.balanceOf(
      staker.address
    );
    const currentUBIInterestAfterWithdraw = await goodCompoundStaking.currentGains(
      false,
      true
    );
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

    const stakingAmount = ethers.utils.parseUnits("100", 8);

    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      stakingAmount
    );
    await eightDecimalsToken
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
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const simpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          eightDecimalsToken.address,
          cEDT.address,
          nameService.address,
          "Good EDT",
          "gEDT",
          "50",
          eightDecimalsUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
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
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);

    const stakingAmount = ethers.utils.parseUnits("100", 8);

    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      stakingAmount
    );
    await eightDecimalsToken
      .connect(staker)
      .approve(simpleStaking.address, stakingAmount);
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
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
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

    const stakingAmount = ethers.utils.parseUnits("100", 8);

    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      stakingAmount
    );
    await eightDecimalsToken["mint(address,uint256)"](
      signers[0].address,
      stakingAmount
    ); // We use some different signer than founder since founder also UBI INTEREST collector
    await eightDecimalsToken
      .connect(signers[0])
      .approve(goodCompoundStaking.address, stakingAmount);
    await eightDecimalsToken
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    let stakerTwoGDAmountBeforeStake = await goodDollar.balanceOf(
      signers[0].address
    );
    let stakerGDAmountBeforeStake = await goodDollar.balanceOf(staker.address);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 0, false);
    await goodCompoundStaking
      .connect(signers[0])
      .stake(stakingAmount, 0, false);
    await advanceBlocks(4);
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
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    const stakingAmount = ethers.utils.parseUnits("1000000000", 8);
    await eightDecimalsToken["mint(address,uint256)"](
      founder.address,
      stakingAmount
    ); // 1 billion EDT to stake
    await eightDecimalsToken.approve(
      goodCompoundStaking.address,
      stakingAmount
    );
    await goodCompoundStaking.stake(stakingAmount, 0, false);
    await advanceBlocks(4);
    const gdBalanceBeforeWithdraw = await goodDollar.balanceOf(founder.address);
    await goodCompoundStaking.withdrawStake(stakingAmount, false);
    const gdBalanceAfterWithdraw = await goodDollar.balanceOf(founder.address);
    expect(
      gdBalanceAfterWithdraw.sub(gdBalanceBeforeWithdraw).toString()
    ).to.be.equal("2500");
  });

  it("should be able to sort staking contracts and collect interests from highest to lowest and only one staking contract's interest should be collected due to gas amount [ @skip-on-coverage ]", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 8);

    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      stakingAmount
    );
    await eightDecimalsToken
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);

    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);

    await cEDT.increasePriceWithMultiplier("20000"); // increase interest by calling exchangeRateCurrent

    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    const simpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          eightDecimalsToken.address,
          cEDT.address,
          nameService.address,
          "Good EDT",
          "gEDT",
          "50",
          eightDecimalsUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    const simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          eightDecimalsToken.address,
          cEDT.address,
          nameService.address,
          "Good EDT",
          "gEDT",
          "50",
          eightDecimalsUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    let encodedData = goodCompoundStaking.interface.encodeFunctionData(
      "setcollectInterestGasCost",
      ["200000"]
    );
    await genericCall(simpleStaking.address, encodedData);

    encodedData = goodCompoundStaking.interface.encodeFunctionData(
      "setcollectInterestGasCost",
      ["200000"]
    );
    await genericCall(simpleStaking1.address, encodedData);
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking.address, 0, 10, false]
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking1.address, 0, 10, false]
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);

    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      stakingAmount
    );
    await eightDecimalsToken
      .connect(staker)
      .approve(simpleStaking.address, stakingAmount);
    await simpleStaking.connect(staker).stake(stakingAmount, 100, false);
    await eightDecimalsToken["mint(address,uint256)"](
      staker.address,
      stakingAmount
    );
    await eightDecimalsToken
      .connect(staker)
      .approve(simpleStaking1.address, stakingAmount);
    await simpleStaking1.connect(staker).stake(stakingAmount, 100, false);

    await cEDT.increasePriceWithMultiplier("200"); // increase interest by calling increasePriceWithMultiplier

    const simpleStakingCurrentInterestBeforeCollect = await simpleStaking.currentGains(
      false,
      true
    );
    const contractsToBeCollected = await goodFundManager.calcSortedContracts(
      "1100000"
    );
    await goodFundManager.collectInterest(contractsToBeCollected, {
      gasLimit: 1100000
    });
    const simpleStakingCurrentInterest = await simpleStaking.currentGains(
      false,
      true
    );
    const goodCompoundStakingCurrentInterest = await goodCompoundStaking.currentGains(
      false,
      true
    );

    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking.address, 0, 10, true]
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking1.address, 0, 10, true]
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    expect(goodCompoundStakingCurrentInterest[0].toString()).to.be.equal("0"); // Goodcompound staking's interest should be collected so currentinterest should be 0
    expect(simpleStakingCurrentInterestBeforeCollect[0]).to.be.equal(
      simpleStakingCurrentInterest[0]
    ); // simple staking's interest shouldn't be collected so currentinterest should be equal to before collectinterest
  });

  async function addLiquidity(
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await eightDecimalsToken.transfer(pair.address, token0Amount);
    await dai.transfer(pair.address, token1Amount);
    await pair.mint(founder.address);
  }
});
