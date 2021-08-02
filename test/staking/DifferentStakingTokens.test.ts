import { ethers, upgrades } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { expect } from "chai";
import {
  createDAO,
  deployUniswap,
  advanceBlocks,
  getStakingFactory,
} from "../helpers";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("Different decimals staking token", () => {
  let dai: Contract;
  let eightDecimalsToken: Contract;
  let pair: Contract, uniswapRouter: Contract;
  let cDAI, cEDT: Contract; // cEDT is for c Eight decimal token
  let gasFeeOracle,
    daiEthOracle: Contract,
    eightDecimalsUsdOracle: Contract,
    ethUsdOracle: Contract,
    compUsdOracle: Contract;
  let goodCompoundStaking;
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
    uniswap;

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
    } = await createDAO();

    uniswap = await deployUniswap();
    uniswapRouter = uniswap.router;
    setDAOAddress("UNISWAP_ROUTER", uniswapRouter.address);

    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);

    avatar = av;
    controller = ctrl;
    genericCall = gc;
    setDAOAddress = sda;
    nameService = ns;
    console.log("deployed dao", {
      founder: founder.address,
      gd,
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

    tokenUsdOracleFactory = await ethers.getContractFactory("BatUSDMockOracle");
    goodCompoundStakingFactory = await getStakingFactory("GoodCompoundStaking");

    tokenFactory = await ethers.getContractFactory("DecimalsMock");
    cTokenFactory = await ethers.getContractFactory("cDecimalsMock");

    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

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

    ethUsdOracle = await ethUsdOracleFactory.deploy();

    const compUsdOracleFactory = await ethers.getContractFactory(
      "CompUSDMockOracle"
    );
    compUsdOracle = await compUsdOracleFactory.deploy();

    await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
  });

  [6, 8, 18].map((decimals) => {
    it(`token decimals ${decimals}: stake should generate some interest and should be used to generate UBI`, async () => {
      const stakingAmount = ethers.utils.parseUnits("100", decimals);
      const token = await tokenFactory.deploy(decimals);
      const iToken = await cTokenFactory.deploy(token.address);
      const tokenUsdOracle = await tokenUsdOracleFactory.deploy();
      const goodCompoundStaking = await deployStaking(
        token.address,
        iToken.address,
        "50",
        tokenUsdOracle.address
      );
      await addLiquidity(
        uniswap.factory,
        token,
        dai,
        ethers.utils.parseEther("100000000"),
        ethers.utils.parseEther("100000000")
      );
      const currentBlockNumber = await ethers.provider.getBlockNumber();

      let encodedDataTwo = goodFundManager.interface.encodeFunctionData(
        "setStakingReward",
        [
          "1000",
          goodCompoundStaking.address,
          currentBlockNumber,
          currentBlockNumber + 5000,
          false,
        ] // set 10 gd per block
      );
      await genericCall(goodFundManager.address, encodedDataTwo);

      await token["mint(address,uint256)"](staker.address, stakingAmount);
      await token
        .connect(staker)
        .approve(goodCompoundStaking.address, stakingAmount);
      await goodCompoundStaking
        .connect(staker)
        .stake(stakingAmount, 100, false);

      const fakeInterest = ethers.utils.parseUnits("1000000000", decimals);
      await token["mint(address,uint256)"](staker.address, fakeInterest);

      await token["mint(address,uint256)"](staker.address, fakeInterest).then(
        (_) => _.wait()
      );
      await token.connect(staker).approve(iToken.address, fakeInterest);
      await iToken
        .connect(staker)
        ["mint(uint256)"](fakeInterest)
        .then((_) => _.wait());
      const iTokenInterest = await iToken.balanceOf(staker.address);
      await iToken
        .connect(staker)
        .transfer(goodCompoundStaking.address, iTokenInterest); // transfer fake interest to staking contract

      const currentUBIInterestBeforeWithdraw =
        await goodCompoundStaking.currentGains(false, true);
      await goodCompoundStaking
        .connect(staker)
        .withdrawStake(stakingAmount, false);
      const gdBalanceBeforeCollectInterest = await goodDollar.balanceOf(
        staker.address
      );
      const contractAddressesToBeCollected =
        await goodFundManager.calcSortedContracts("1300000");
      await goodFundManager
        .connect(staker)
        .collectInterest(contractAddressesToBeCollected);
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
  });

  async function deployStaking(
    token,
    itoken,
    blocksThreashold = "50",
    tokenUsdOracle,
    swapPath = null
  ) {
    return goodCompoundStakingFactory.deploy().then(async (contract) => {
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
});
