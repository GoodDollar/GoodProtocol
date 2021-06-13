import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  SimpleStaking,
} from "../../types";

import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  createDAO,
  increaseTime,
  advanceBlocks,
  deployUniswap,
} from "../helpers";
import { experimentalAddHardhatNetworkMessageTraceHook } from "hardhat/config";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("UsdcAaveStaking - staking with USDC mocks to AAVE interface", () => {
  let dai: Contract;
  let usdc: Contract;
  let pair: Contract, uniswapRouter: Contract;
  let cDAI, cUsdc: Contract, comp: Contract, aave: Contract;
  let gasFeeOracle,
    daiEthOracle: Contract,
    daiUsdOracle: Contract,
    usdcUsdOracle: Contract,
    ethUsdOracle: Contract,
    compUsdOracle: Contract,
    aaveUsdOracle: Contract;
  let goodReserve: GoodReserveCDai;
  let goodAaveStaking: Contract;
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
    incentiveController,
    lendingPool,
    setDAOAddress,
    genericCall;
  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const daiFactory = await ethers.getContractFactory("DAIMock");
    const cUsdcFactory = await ethers.getContractFactory("cUSDCMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const goodAaveStakingFactory = await ethers.getContractFactory(
      "GoodAaveStaking"
    );

    const lendingPoolFactory = await ethers.getContractFactory(
      "LendingPoolMock"
    );
    const uniswap = await deployUniswap();
    uniswapRouter = uniswap.router;
    const { factory, weth } = uniswap;
    const usdcFactory = await ethers.getContractFactory("USDCMock");
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
      genericCall: gc,
      cdaiAddress,
      reserve,
      setReserveToken,
    } = await createDAO();
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    genericCall = gc;
    initializeToken = setReserveToken;
    goodReserve = reserve as GoodReserveCDai;
    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar,
    });
    goodFundManager = await upgrades.deployProxy(
      goodFundManagerFactory,
      [nameService.address],
      { kind: "uups" }
    );
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address,
    });
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

    marketMaker = mm;
    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address,
    });
    compUsdOracle = await (
      await ethers.getContractFactory("CompUSDMockOracle")
    ).deploy();
    console.log("setting permissions...");
    const tokenUsdOracleFactory = await ethers.getContractFactory(
      "BatUSDMockOracle"
    );
    daiUsdOracle = await tokenUsdOracleFactory.deploy();

    console.log("initializing marketmaker...");

    usdc = await usdcFactory.deploy(); // Another erc20 token for uniswap router test
    cUsdc = await cUsdcFactory.deploy(usdc.address);

    setDAOAddress("UNISWAP_ROUTER", uniswapRouter.address);
    await factory.createPair(usdc.address, dai.address); // Create tokenA and dai pair
    const pairAddress = factory.getPair(usdc.address, dai.address);
    pair = new Contract(
      pairAddress,
      JSON.stringify(IUniswapV2Pair.abi),
      staker
    ).connect(founder);
    aave = await (await ethers.getContractFactory("AaveMock")).deploy();
    await factory.createPair(aave.address, dai.address);
    const aavePairAddress = factory.getPair(aave.address, dai.address);
    const aavePair = new Contract(
      aavePairAddress,
      JSON.stringify(IUniswapV2Pair.abi),
      staker
    ).connect(founder);
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("20000000")
    );
    await aave["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("20000")
    );
    await dai.transfer(aavePair.address, ethers.utils.parseEther("2000000"));
    await aave.transfer(aavePair.address, ethers.utils.parseEther("2000"));
    await aavePair.mint(founder.address);
    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);
    comp = await daiFactory.deploy();
    await setDAOAddress("COMP", comp.address);
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

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

    usdcUsdOracle = await tokenUsdOracleFactory.deploy();
    ethUsdOracle = await ethUsdOracleFactory.deploy();
    lendingPool = await lendingPoolFactory.deploy(usdc.address);
    incentiveController = await (
      await ethers.getContractFactory("IncentiveControllerMock")
    ).deploy(aave.address);
    aaveUsdOracle = await (
      await ethers.getContractFactory("AaveUSDMockOracle")
    ).deploy();
    await setDAOAddress("AAVE", aave.address);
    goodAaveStaking = await goodAaveStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          usdc.address,
          lendingPool.address,
          nameService.address,
          "Good USDC",
          "gUSDC",
          "172800",
          daiUsdOracle.address,
          incentiveController.address,
          aaveUsdOracle.address
        );
        return contract;
      });
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("2000000")
    );
    await usdc["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("2000000", 6)
    );

    await addLiquidity(
      ethers.utils.parseUnits("2000000", 6),
      ethers.utils.parseEther("2000000")
    );
    await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
  });

  it("should not be initializable twice", async () => {
    await expect(
      goodAaveStaking.init(
        dai.address,
        lendingPool.address,
        nameService.address,
        "Good DAI",
        "gDAI",
        "172800",
        daiUsdOracle.address,
        incentiveController.address,
        aaveUsdOracle.address
      )
    ).to.revertedWith("Initializable: contract is already initialized");
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
        goodAaveStaking.address,
        currentBlockNumber - 5,
        currentBlockNumber + 500,
        false,
      ] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    let rewardPerBlock = await goodFundManager.rewardsForStakingContract(
      goodAaveStaking.address
    );
    expect(rewardPerBlock[0].toString()).to.be.equal("1000");
    expect(rewardPerBlock[1].toString()).to.be.equal(
      (currentBlockNumber - 5).toString()
    );
    expect(rewardPerBlock[2].toString()).to.be.equal(
      (currentBlockNumber + 500).toString()
    );
    expect(rewardPerBlock[3]).to.be.equal(false);
  });
  it("it should stake usdc to lendingPool and withdraw", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);
    await usdc["mint(address,uint256)"](founder.address, stakingAmount);
    await usdc.approve(goodAaveStaking.address, stakingAmount);
    await goodAaveStaking.stake(stakingAmount, 0, false);
    const aTokenBalanceAfterStake = await lendingPool.balanceOf(
      goodAaveStaking.address
    );
    expect(aTokenBalanceAfterStake).to.be.gt(0);
    expect(aTokenBalanceAfterStake).to.be.equal(stakingAmount);
    await goodAaveStaking.withdrawStake(stakingAmount, false);
    const aTokenBalanceAfterWithdraw = await lendingPool.balanceOf(
      goodAaveStaking.address
    );
    expect(aTokenBalanceAfterWithdraw).to.be.equal(0);
    const founderProductivity = await goodAaveStaking.getProductivity(
      founder.address
    );
  });

  it("should be able to earn rewards after some block passed", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);
    await usdc["mint(address,uint256)"](staker.address, stakingAmount);
    await usdc.connect(staker).approve(goodAaveStaking.address, stakingAmount);
    await goodAaveStaking.connect(staker).stake(stakingAmount, 0, false);
    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    await advanceBlocks(4);
    await goodAaveStaking.connect(staker).withdrawStake(stakingAmount, false);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);
    expect(gdBalancerAfterWithdraw.toString()).to.be.equal("2500");
  });
  it("stake should generate some interest and shoul be used to generate UBI", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);
    await usdc["mint(address,uint256)"](staker.address, stakingAmount);
    await usdc.connect(staker).approve(goodAaveStaking.address, stakingAmount);
    await goodAaveStaking.connect(staker).stake(stakingAmount, 0, false);

    await usdc["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100000000")
    );
    await usdc
      .connect(staker)
      .transfer(lendingPool.address, ethers.utils.parseEther("100000000")); // We should put extra USDC to LendingPool/Atoken contract in order to provide interest
    await lendingPool.giveInterestToUser("1500", goodAaveStaking.address); // increase interest by calling giveInterestToUser

    const currentUBIInterestBeforeWithdraw = await goodAaveStaking.currentGains(
      false,
      true
    );
    await goodAaveStaking.connect(staker).withdrawStake(stakingAmount, false);
    const gdBalanceBeforeCollectInterest = await goodDollar.balanceOf(
      staker.address
    );
    const contractAddressesToBeCollected =
      await goodFundManager.calcSortedContracts("1100000");
    console.log(contractAddressesToBeCollected.toString());
    await goodFundManager
      .connect(staker)
      .collectInterest(contractAddressesToBeCollected);
    const gdBalanceAfterCollectInterest = await goodDollar.balanceOf(
      staker.address
    );
    const currentUBIInterestAfterWithdraw = await goodAaveStaking.currentGains(
      false,
      true
    );
    expect(currentUBIInterestBeforeWithdraw[0].toString()).to.not.be.equal("0");
    expect(currentUBIInterestAfterWithdraw[0].toString()).to.be.equal("0");
    expect(gdBalanceAfterCollectInterest.gt(gdBalanceBeforeCollectInterest));
  });
  it("should be able to sort staking contracts and collect interests from highest to lowest and only one staking contract's interest should be collected due to gas amount [ @skip-on-coverage ]", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);
    await usdc["mint(address,uint256)"](staker.address, stakingAmount);
    await usdc.connect(staker).approve(goodAaveStaking.address, stakingAmount);
    await goodAaveStaking.connect(staker).stake(stakingAmount, 0, false);

    await lendingPool.giveInterestToUser("6000", goodAaveStaking.address); // increase interest by calling giveInterestToUser

    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const simpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "50",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });

    const simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "50",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });

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

    const simpleStakingCurrentInterestBeforeCollect =
      await simpleStaking.currentGains(false, true);
    const contractsToBeCollected = await goodFundManager.calcSortedContracts(
      "1100000"
    );
    await goodFundManager.collectInterest(contractsToBeCollected, {
      gasLimit: 1100000,
    });
    const simpleStakingCurrentInterest = await simpleStaking.currentGains(
      false,
      true
    );
    const goodAaveStakingCurrentInterest = await goodAaveStaking.currentGains(
      false,
      true
    );

    await goodAaveStaking.connect(staker).withdrawStake(stakingAmount, false);
    encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking.address, 0, 10, true]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    expect(goodAaveStakingCurrentInterest[0].toString()).to.be.equal("0"); // Goodcompound staking's interest should be collected so currentinterest should be 0
    expect(simpleStakingCurrentInterestBeforeCollect[0]).to.be.equal(
      simpleStakingCurrentInterest[0]
    ); // simple staking's interest shouldn't be collected so currentinterest should be equal to before collectinterest
  });

  it("it should collectInterest when there is aave rewards but there is no interest from aToken", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);
    await usdc["mint(address,uint256)"](founder.address, stakingAmount);
    await usdc.approve(goodAaveStaking.address, stakingAmount);
    await goodAaveStaking.stake(stakingAmount, "0", false);
    console.log("after stake");
    let currentGains = await goodAaveStaking.currentGains(false, true);
    expect(currentGains[4]).to.be.equal("0");

    await incentiveController.increaseRewardsBalance(
      goodAaveStaking.address,
      ethers.utils.parseEther("10")
    );
    currentGains = await goodAaveStaking.currentGains(false, true);
    const aavePriceInDollar = await aaveUsdOracle.latestAnswer();
    expect(currentGains[4]).to.be.equal(
      BigNumber.from("10").mul(aavePriceInDollar)
    );
    const contractAddressesToBeCollected = await goodFundManager
      .connect(staker)
      .calcSortedContracts("1100000");
    console.log(
      `contractAddressesToBeCollected ${contractAddressesToBeCollected}`
    );
    await goodFundManager.collectInterest(contractAddressesToBeCollected, {
      gasLimit: 1100000,
    });
    currentGains = await goodAaveStaking.currentGains(false, true);
    expect(currentGains[4]).to.be.equal("0");
    await goodAaveStaking.withdrawStake(stakingAmount, false);
  });
  async function addLiquidity(
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await usdc.transfer(pair.address, token0Amount);
    await dai.transfer(pair.address, token1Amount);
    await pair.mint(founder.address);
  }
});
