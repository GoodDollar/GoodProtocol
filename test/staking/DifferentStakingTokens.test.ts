import { ethers, upgrades } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { expect } from "chai";
import {
  createDAO,
  deployUniswap,
  advanceBlocks,
  getStakingFactory
} from "../helpers";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("Different decimals staking token", () => {
  let dai: Contract;
  let pair: Contract, uniswapRouter: Contract;
  let cDAI;
  let gasFeeOracle,
    daiEthOracle: Contract,
    ethUsdOracle: Contract,
    compUsdOracle: Contract;
  let goodFundManager: Contract;
  let avatar,
    goodDollar,
    controller,
    founder,
    staker,
    schemeMock,
    signers,
    nameService,
    setDAOAddress,
    genericCall,
    tokenFactory,
    cTokenFactory,
    tokenUsdOracleFactory,
    goodCompoundStakingFactory,
    uniswap,
    comp;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );

    let {
      controller: ctrl,
      avatar: av,
      gd,
      nameService: ns,
      setDAOAddress: sda,
      daiAddress,
      cdaiAddress,
      genericCall: gc,
      setDAOAddress,
      COMP
    } = await createDAO();

    comp = COMP;
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    uniswap = await deployUniswap(comp, dai);
    uniswapRouter = uniswap.router;
    setDAOAddress("UNISWAP_ROUTER", uniswapRouter.address);
    avatar = av;
    controller = ctrl;
    genericCall = gc;
    setDAOAddress = sda;
    nameService = ns;
    console.log("deployed dao", {
      founder: founder.address,
      gd,
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

    tokenUsdOracleFactory = await ethers.getContractFactory("BatUSDMockOracle");
    goodCompoundStakingFactory = await getStakingFactory("GoodCompoundStaking");

    tokenFactory = await ethers.getContractFactory("DecimalsMock");
    cTokenFactory = await ethers.getContractFactory("cDecimalsMock");

    const compUsdOracleFactory = await ethers.getContractFactory(
      "CompUSDMockOracle"
    );
    compUsdOracle = await compUsdOracleFactory.deploy();
  });

  [6, 8, 16].map(decimals => {
    it(`token decimals ${decimals}: stake should generate some interest and should be used to generate UBI`, async () => {
      const stakingAmount = ethers.utils.parseUnits("100", decimals);
      const deployedContracts = await deployStakingAndTokens(
        decimals,
        stakingAmount,
        true,
        true
      );
      const goodCompoundStaking = deployedContracts.goodCompoundStaking;
      const currentUBIInterestBeforeWithdraw =
        await goodCompoundStaking.currentGains(false, true);
      await goodCompoundStaking
        .connect(staker)
        .withdrawStake(stakingAmount, false);
      const gdBalanceBeforeCollectInterest = await goodDollar.balanceOf(
        staker.address
      );
      const contractAddressesToBeCollected =
        await goodFundManager.calcSortedContracts();
      const addressesToCollect = contractAddressesToBeCollected.map(x => x[0]);
      await goodFundManager
        .connect(staker)
        .collectInterest(addressesToCollect, {
          gasLimit: 1300000
        });
      const gdBalanceAfterCollectInterest = await goodDollar.balanceOf(
        staker.address
      );
      const currentUBIInterestAfterWithdraw =
        await goodCompoundStaking.currentGains(false, true);
      expect(currentUBIInterestBeforeWithdraw[0].toString()).to.not.be.equal(
        "0"
      );
      expect(currentUBIInterestAfterWithdraw[0].toString()).to.be.equal("0");
      expect(gdBalanceAfterCollectInterest.gt(gdBalanceBeforeCollectInterest));
    });

    it(`token decimals ${decimals}:  it should get rewards with updated values`, async () => {
      const stakingAmount = ethers.utils.parseUnits("100", decimals);
      const deployedContracts = await deployStakingAndTokens(
        decimals,
        stakingAmount
      );
      const goodCompoundStaking = deployedContracts.goodCompoundStaking;
      await advanceBlocks(4);
      const stakingContractVals =
        await goodFundManager.rewardsForStakingContract(
          goodCompoundStaking.address
        );
      let rewardsEarned = await goodCompoundStaking.getUserPendingReward(
        staker.address,
        stakingContractVals[0],
        stakingContractVals[1],
        stakingContractVals[2]
      );
      //baseshare rewards are in 18 decimals
      expect(rewardsEarned.toString()).to.be.equal(
        ethers.utils.parseUnits("20", 18)
      ); // Each block reward is 10gd so total reward 40gd but since multiplier is 0.5 for first month should get 20gd
      await goodCompoundStaking
        .connect(staker)
        .withdrawStake(stakingAmount, false);
    });
    it(`token decimals ${decimals}: it should get rewards with 1x multiplier for after threshold pass`, async () => {
      const stakingAmount = ethers.utils.parseUnits("100", decimals);
      let gdBalanceStakerBeforeWithdraw = await goodDollar.balanceOf(
        staker.address
      );
      const deployedContracts = await deployStakingAndTokens(
        decimals,
        stakingAmount
      );
      const goodCompoundStaking = deployedContracts.goodCompoundStaking;
      await advanceBlocks(54);
      await goodCompoundStaking
        .connect(staker)
        .withdrawStake(stakingAmount, false);
      let gdBalanceStakerAfterWithdraw = await goodDollar.balanceOf(
        staker.address
      );

      expect(
        gdBalanceStakerAfterWithdraw
          .sub(gdBalanceStakerBeforeWithdraw)
          .toString()
      ).to.be.equal("30000"); // 50 blocks reward worth 500gd but since it's with the 0.5x multiplier so 250gd then there is 5 blocks which gets full reward so total reward is 300gd
    });
    it(`token decimals ${decimals}: should be able earn to 50% of rewards when owns 50% of total productivity`, async () => {
      const stakingAmount = ethers.utils.parseUnits("100", decimals);
      let stakerGDAmountBeforeStake = await goodDollar.balanceOf(
        staker.address
      );
      let stakerTwoGDAmountBeforeStake = await goodDollar.balanceOf(
        signers[0].address
      );
      const deployedContracts = await deployStakingAndTokens(
        decimals,
        stakingAmount,
        false,
        false,
        true
      );
      const goodCompoundStaking = deployedContracts.goodCompoundStaking;

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
    it(`token decimals ${decimals}: Accumulated per share has enough precision when reward << totalproductivity`, async () => {
      const stakingAmount = ethers.utils.parseUnits("100", decimals);

      const deployedContracts = await deployStakingAndTokens(
        decimals,
        stakingAmount
      );
      const goodCompoundStaking = deployedContracts.goodCompoundStaking;
      await advanceBlocks(4);
      const gdBalanceBeforeWithdraw = await goodDollar.balanceOf(
        staker.address
      );
      await goodCompoundStaking
        .connect(staker)
        .withdrawStake(stakingAmount, false);
      const gdBalanceAfterWithdraw = await goodDollar.balanceOf(staker.address);
      expect(
        gdBalanceAfterWithdraw.sub(gdBalanceBeforeWithdraw).toString()
      ).to.be.equal("2500");
    });
  });

  async function deployStaking(
    token,
    itoken,
    blocksThreashold = "50",
    tokenUsdOracle,
    swapPath = null
  ) {
    const stakingContract = await goodCompoundStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          token,
          itoken,
          nameService.address,
          "Good Decimals",
          "gcDecimals",
          blocksThreashold,
          tokenUsdOracle,
          compUsdOracle.address,
          swapPath || [token, dai.address]
        );
        return contract;
      });
    const currentBlockNumber = await ethers.provider.getBlockNumber();

    let encodedDataTwo = goodFundManager.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        stakingContract.address,
        currentBlockNumber,
        currentBlockNumber + 5000,
        false
      ] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedDataTwo);
    return stakingContract;
  }

  async function addLiquidity(
    factory,
    tokenA,
    tokenB,
    tokenAAmount: BigNumber,
    tokenBAmount: BigNumber
  ) {
    await factory.createPair(tokenA.address, tokenB.address); // Create tokenA and dai pair
    const pairAddress = factory.getPair(tokenA.address, tokenB.address);
    pair = new Contract(
      pairAddress,
      JSON.stringify(IUniswapV2Pair.abi),
      staker
    ).connect(founder);
    await tokenA["mint(address,uint256)"](pair.address, tokenAAmount);
    await tokenB["mint(address,uint256)"](pair.address, tokenBAmount);
    await pair.mint(founder.address);
  }
  async function deployStakingAndTokens(
    decimals,
    stakingAmount,
    shouldAddLiquidity = false,
    shouldAddInterest = false,
    useSecondStaker = false
  ) {
    const token = await tokenFactory.deploy(decimals);
    const iToken = await cTokenFactory.deploy(token.address);
    const tokenUsdOracle = await tokenUsdOracleFactory.deploy();
    const goodCompoundStaking = await deployStaking(
      token.address,
      iToken.address,
      "50",
      tokenUsdOracle.address
    );
    if (shouldAddLiquidity) {
      await addLiquidity(
        uniswap.factory,
        token,
        dai,
        ethers.utils.parseUnits("100000000", decimals),
        ethers.utils.parseEther("100000000")
      );
    }

    await token["mint(address,uint256)"](staker.address, stakingAmount);
    await token
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    if (useSecondStaker) {
      await token["mint(address,uint256)"](signers[0].address, stakingAmount); // We use some different signer than founder since founder also UBI INTEREST collector
      await token
        .connect(signers[0])
        .approve(goodCompoundStaking.address, stakingAmount);
    }
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 0, false);
    if (useSecondStaker) {
      await goodCompoundStaking
        .connect(signers[0])
        .stake(stakingAmount, 0, false);
    }
    if (shouldAddInterest) {
      const fakeInterest = ethers.utils.parseUnits("1000000000", decimals);
      await token["mint(address,uint256)"](iToken.address, fakeInterest);

      await iToken.increasePriceWithMultiplier("2500");
    }
    return { goodCompoundStaking, token };
  }
});
