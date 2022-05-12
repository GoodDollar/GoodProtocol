import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { expect } from "chai";
import { GoodMarketMaker } from "../../types";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import { createDAO, deployUniswap, getStakingFactory } from "../helpers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;

describe("UsdcAaveStakingV2 - staking with USDC mocks to AAVE interface", () => {
  let dai: Contract;
  let usdc: Contract;
  let pair: Contract, uniswapRouter: Contract;
  let comp: Contract, aave: Contract;
  let daiUsdOracle: Contract, aaveUsdOracle: Contract;
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
    goodAaveStakingFactory,
    runAsAvatarOnly,
    deployStaking;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();

    const cUsdcFactory = await ethers.getContractFactory("cUSDCMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    goodAaveStakingFactory = await getStakingFactory("GoodAaveStakingV2");

    const lendingPoolFactory = await ethers.getContractFactory(
      "LendingPoolMock"
    );

    const usdcFactory = await ethers.getContractFactory("USDCMock");
    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      nameService: ns,
      setDAOAddress: sda,
      marketMaker: mm,
      daiAddress,
      genericCall: gc,
      COMP,
      runAsAvatarOnly: raao
    } = await createDAO();
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    genericCall = gc;
    runAsAvatarOnly = raao;
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

    marketMaker = mm;
    const tokenUsdOracleFactory = await ethers.getContractFactory(
      "BatUSDMockOracle"
    );
    daiUsdOracle = await tokenUsdOracleFactory.deploy();
    comp = COMP;
    usdc = await usdcFactory.deploy(); // Another erc20 token for uniswap router test
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
      ethers.utils.parseEther("500000000000000")
    );
    await aave["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("20000")
    );
    await addLiquidity(
      dai,
      aave,
      aavePair,
      ethers.utils.parseEther("2000000"),
      ethers.utils.parseEther("2000")
    );

    await setDAOAddress("COMP", comp.address);

    lendingPool = await lendingPoolFactory.deploy(usdc.address);
    incentiveController = await (
      await ethers.getContractFactory("IncentiveControllerMock")
    ).deploy(aave.address);
    aaveUsdOracle = await (
      await ethers.getContractFactory("AaveUSDMockOracle")
    ).deploy();
    await setDAOAddress("AAVE", aave.address);
    deployStaking = async () => {
      return await goodAaveStakingFactory
        .deploy()
        .then(async contract => {
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
    };
    goodAaveStaking = await deployStaking();
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
      usdc,
      dai,
      pair,
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
        false
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
      await goodFundManager.calcSortedContracts();
    console.log(contractAddressesToBeCollected.toString());
    const addressesToCollect = contractAddressesToBeCollected.map(x => x[0]);
    await goodFundManager
      .connect(staker)
      .collectInterest(addressesToCollect, false);
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

  it("it should collect stkAAVE to Avatar when collecting interest", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);
    const avatarBalance = await aave.balanceOf(avatar);
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
      .calcSortedContracts();
    const addressesToCollect = contractAddressesToBeCollected.map(x => x[0]);
    await goodFundManager.collectInterest(addressesToCollect, false, {
      gasLimit: 1200000
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
    expect(await aave.balanceOf(avatar)).gt(avatarBalance);
  });

  it("should be able to transfer staked tokens", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 6);

    await goodAaveStaking.connect(staker).stake(stakingAmount, 0, false);

    await lendingPool.giveInterestToUser("1500", goodAaveStaking.address); // increase interest by calling giveInterestToUser

    await expect(
      goodAaveStaking
        .connect(staker)
        .transfer(signers[0].address, stakingAmount)
    ).not.reverted;
    expect(await goodAaveStaking.balanceOf(signers[0].address)).to.eq(
      stakingAmount
    );
  });
  async function addLiquidity(
    token0: Contract,
    token1: Contract,
    pair: Contract,
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await token0.transfer(pair.address, token0Amount);
    await token1.transfer(pair.address, token1Amount);
    await pair.mint(founder.address);
  }

  it("should set gas cost to interest collection parameters", async () => {
    const stakingContract = await deployStaking();
    const collectGasCostBefore = await stakingContract.collectInterestGasCost();
    const claimStakeGasCostBefore = await stakingContract.collectInterestGasCost();
    await runAsAvatarOnly(
      stakingContract,
      "setcollectInterestGasCostParams(uint32,uint32)",
      999,
      999
    )
    const collectGasCostAfter = await stakingContract.collectInterestGasCost();
    const claimStakeGasCostAfter = await stakingContract.collectInterestGasCost();
    expect(collectGasCostAfter).to.not.equal(collectGasCostBefore);
    expect(collectGasCostAfter).to.equal(999);
    expect(claimStakeGasCostAfter).to.not.equal(claimStakeGasCostBefore);
    expect(claimStakeGasCostAfter).to.equal(999);
  });
});
