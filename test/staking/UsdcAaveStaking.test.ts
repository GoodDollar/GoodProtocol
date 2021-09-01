import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { expect } from "chai";
import { GoodMarketMaker } from "../../types";

import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import { createDAO, deployUniswap, getStakingFactory } from "../helpers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("UsdcAaveStaking - staking with USDC mocks to AAVE interface", () => {
  let dai: Contract;
  let usdc: Contract;
  let pair: Contract, uniswapRouter: Contract;
  let cDAI, cUsdc: Contract, comp: Contract, aave: Contract;
  let gasFeeOracle,
    daiUsdOracle: Contract,
    compUsdOracle: Contract,
    aaveUsdOracle: Contract;
  let goodReserve: Contract;
  let goodAaveStaking: Contract;
  let goodFundManager: Contract;
  let avatar,
    goodDollar,
    marketMaker: GoodMarketMaker,
    controller,
    founder,
    staker,
    schemeMock,
    signers,
    nameService,
    incentiveController,
    lendingPool,
    setDAOAddress,
    genericCall,
    goodAaveStakingFactory;
  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const daiFactory = await ethers.getContractFactory("DAIMock");
    const cUsdcFactory = await ethers.getContractFactory("cUSDCMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    goodAaveStakingFactory = await getStakingFactory("GoodAaveStaking");

    const lendingPoolFactory = await ethers.getContractFactory(
      "LendingPoolMock"
    );

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
      COMP,
    } = await createDAO();
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    genericCall = gc;
    goodReserve = reserve;
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
    comp = COMP;
    usdc = await usdcFactory.deploy(); // Another erc20 token for uniswap router test
    cUsdc = await cUsdcFactory.deploy(usdc.address);
    const uniswap = await deployUniswap(comp, dai);
    uniswapRouter = uniswap.router;
    const { factory, weth } = uniswap;
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

    await setDAOAddress("COMP", comp.address);

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
          aaveUsdOracle.address,
          [usdc.address, dai.address]
        );
        return contract;
      });
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("200000000000000")
    );
    await usdc["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("500000000000000", 6)
    );
    await usdc["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseUnits("10000", 6)
    );
    await usdc["mint(address,uint256)"](
      lendingPool.address,
      ethers.utils.parseEther("100000000")
    ); // We should put extra USDC to LendingPool/Atoken contract in order to provide interest
    await addLiquidity(
      ethers.utils.parseUnits("200000000000000", 6),
      ethers.utils.parseEther("200000000000000")
    );
    await usdc.approve(goodAaveStaking.address, ethers.constants.MaxUint256);
    await usdc
      .connect(staker)
      .approve(goodAaveStaking.address, ethers.constants.MaxUint256);
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
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
  });

  it("it should stake usdc to lendingPool and withdraw", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);
    await goodAaveStaking.stake(stakingAmount, 0, false);
    const aTokenBalanceAfterStake = await lendingPool.balanceOf(
      goodAaveStaking.address
    );
    await goodAaveStaking.withdrawStake(stakingAmount, false);
    const aTokenBalanceAfterWithdraw = await lendingPool.balanceOf(
      goodAaveStaking.address
    );
    expect(aTokenBalanceAfterWithdraw).to.be.equal(0);
    expect(aTokenBalanceAfterStake).to.be.gt(0);
    expect(aTokenBalanceAfterStake).to.be.equal(stakingAmount);
  });

  it("stake should generate some interest and should be used to generate UBI", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);

    await goodAaveStaking.connect(staker).stake(stakingAmount, 0, false);

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

  it("it should collectRewards while collecting interest from aToken if there some earned reward as stkAAVE", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);
    await goodAaveStaking.stake(stakingAmount, "0", false);
    const currentGainsAfterStake = await goodAaveStaking.currentGains(
      false,
      true
    );
    await incentiveController.increaseRewardsBalance(
      goodAaveStaking.address,
      ethers.utils.parseEther("10")
    );
    const currentGainsAfterEarnRewards = await goodAaveStaking.currentGains(
      false,
      true
    );
    await lendingPool.giveInterestToUser(2000, goodAaveStaking.address);
    const currentGainsAfterGetInterest = await goodAaveStaking.currentGains(
      false,
      true
    );
    const contractAddressesToBeCollected = await goodFundManager
      .connect(staker)
      .calcSortedContracts("1200000");
    await goodFundManager.collectInterest(contractAddressesToBeCollected, {
      gasLimit: 1200000,
    });
    const currentGainsAfterCollectInterest = await goodAaveStaking.currentGains(
      false,
      true
    );
    await goodAaveStaking.withdrawStake(stakingAmount, false);
    expect(currentGainsAfterStake[4]).to.be.equal("0");
    expect(currentGainsAfterGetInterest[4]).to.be.gt(
      currentGainsAfterEarnRewards[4]
    );
    expect(currentGainsAfterEarnRewards[4]).to.be.equal(0); // stkAAVE rewards shouldnt count as gain
    expect(currentGainsAfterCollectInterest[4]).to.be.equal("0");
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
