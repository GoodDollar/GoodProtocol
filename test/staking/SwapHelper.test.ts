import { ethers, upgrades } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { expect } from "chai";
import { GoodMarketMaker } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  createDAO,
  increaseTime,
  advanceBlocks,
  deployUniswap,
  getStakingFactory,
} from "../helpers";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("SwapHelper - Helper library for swap on the Uniswap", () => {
  let dai: Contract;
  let bat: Contract;
  let comp: Contract;
  let pair: Contract, uniswapRouter: Contract, usdcPair, compPair;
  let cDAI, cUsdc, usdc, cBat: Contract;
  let gasFeeOracle,
    daiEthOracle: Contract,
    daiUsdOracle: Contract,
    batUsdOracle: Contract,
    ethUsdOracle: Contract,
    compUsdOracle: Contract;
  let goodReserve: Contract;
  let goodCompoundStaking;
  let goodFundManager: Contract;
  let avatar,
    controller,
    founder,
    staker,
    schemeMock,
    signers,
    nameService,
    initializeToken,
    setDAOAddress,
    genericCall,
    goodCompoundStakingFactory,
    goodCompoundStakingTestFactory;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cBatFactory = await ethers.getContractFactory("cDecimalsMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    goodCompoundStakingFactory = await getStakingFactory("GoodCompoundStaking");
    goodCompoundStakingTestFactory = await getStakingFactory(
      "GoodCompoundStakingTest"
    );

    const uniswap = await deployUniswap();
    uniswapRouter = uniswap.router;
    const { factory, weth } = uniswap;

    const daiFactory = await ethers.getContractFactory("DAIMock");
    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      nameService: ns,
      setDAOAddress: sda,
      setSchemes,
      marketMaker: mm,
      daiAddress,
      cdaiAddress,
      reserve,
      setReserveToken,
      genericCall: gc,
      COMP,
    } = await createDAO();

    genericCall = gc;
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    comp = COMP;
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    initializeToken = setReserveToken;
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
      {
        kind: "uups",
      }
    );
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address,
    });

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address,
    });

    console.log("setting permissions...");
    const tokenUsdOracleFactory = await ethers.getContractFactory(
      "BatUSDMockOracle"
    );
    setDAOAddress("UNISWAP_ROUTER", uniswapRouter.address);

    daiUsdOracle = await tokenUsdOracleFactory.deploy();
    const compUsdOracleFactory = await ethers.getContractFactory(
      "CompUSDMockOracle"
    );
    compUsdOracle = await compUsdOracleFactory.deploy();
    goodCompoundStaking = await deployStaking(
      dai.address,
      cDAI.address,
      "50",
      daiUsdOracle.address,
      []
    );

    bat = await daiFactory.deploy(); // Another erc20 token for uniswap router test
    cBat = await cBatFactory.deploy(bat.address);
    usdc = await (await ethers.getContractFactory("USDCMock")).deploy();
    cUsdc = await (
      await ethers.getContractFactory("cUSDCMock")
    ).deploy(usdc.address);

    await factory.createPair(bat.address, dai.address); // Create tokenA and dai pair
    const pairAddress = factory.getPair(bat.address, dai.address);
    await factory.createPair(bat.address, usdc.address);
    usdcPair = new Contract(
      await factory.getPair(bat.address, usdc.address),
      JSON.stringify(IUniswapV2Pair.abi),
      staker
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

    batUsdOracle = await tokenUsdOracleFactory.deploy();
    ethUsdOracle = await ethUsdOracleFactory.deploy();
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("10000000")
    );
    await bat["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("5001000")
    );
    await usdc["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("10000000", 6)
    );
    await bat.transfer(cBat.address, ethers.utils.parseEther("1000000")); // We should put extra BAT to mock cBAT contract in order to provide interest
    await bat.transfer(usdcPair.address, ethers.utils.parseEther("2000000"));
    await usdc.transfer(
      usdcPair.address,
      ethers.utils.parseUnits("2000000", 6)
    );
    await usdcPair.mint(founder.address);
    await addLiquidity(
      ethers.utils.parseEther("200000"),
      ethers.utils.parseEther("200000")
    );

    await factory.createPair(comp.address, weth.address); // Create comp and weth pair
    const compPairAddress = factory.getPair(comp.address, weth.address);

    await factory.createPair(dai.address, weth.address); // Create comp and dai pair
    const daiPairAddress = factory.getPair(dai.address, weth.address);

    compPair = new Contract(
      compPairAddress,
      JSON.stringify(IUniswapV2Pair.abi),
      staker
    ).connect(founder);
    const daiPair = new Contract(
      daiPairAddress,
      JSON.stringify(IUniswapV2Pair.abi),
      staker
    ).connect(founder);

    await dai["mint(address,uint256)"](
      daiPair.address,
      ethers.utils.parseEther("2000000")
    );
    await comp["mint(address,uint256)"](
      compPair.address,
      ethers.utils.parseEther("200000")
    );
    console.log("depositing eth to liquidity pools");
    await weth.deposit({ value: ethers.utils.parseEther("4000") });
    console.log(
      await weth.balanceOf(founder.address).then((_) => _.toString())
    );
    await weth.transfer(compPair.address, ethers.utils.parseEther("2000"));
    await weth.transfer(daiPair.address, ethers.utils.parseEther("2000"));
    console.log("minting liquidity pools");

    await compPair.mint(founder.address);
    await daiPair.mint(founder.address);
    await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
  });

  it("it should swap only safe amount when gains larger than safe amount", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const simpleStaking = await deployStaking(
      bat.address,
      cBat.address,
      "50",
      batUsdOracle.address,
      [bat.address, dai.address]
    );

    const reserve = await pair.getReserves();
    await dai.approve(
      goodCompoundStaking.address,
      ethers.utils.parseEther("100")
    );

    await bat.approve(simpleStaking.address, ethers.utils.parseEther("100"));
    await simpleStaking.stake(ethers.utils.parseEther("100"), 100, false);

    await cBat.increasePriceWithMultiplier("1500");

    const collectableContracts = await goodFundManager.calcSortedContracts(
      "1500000"
    );
    const safeAmount = reserve[1].mul(BN.from(3)).div(BN.from(1000));
    const safeAmountInIToken = await simpleStaking.tokenWorthIniToken(
      safeAmount
    );
    const er = await cBat.exchangeRateStored();
    const redeemedAmount = safeAmountInIToken
      .mul(er)
      .mul(BN.from(10).pow(10))
      .div(BN.from(10).pow(28));
    const currentGains = await simpleStaking.currentGains(true, true);
    await goodFundManager.collectInterest(collectableContracts, {
      gasLimit: 1500000,
    });
    const currentReserve = await pair.getReserves();

    await simpleStaking.withdrawStake(ethers.utils.parseEther("100"), false);

    const encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking.address, 0, 10000, true]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    expect(reserve[0].sub(currentReserve[0])).to.be.lt(currentGains[1]);
    expect(currentReserve[1].sub(reserve[1])).to.be.equal(redeemedAmount);
  });

  it("it should swap with multiple hops", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );

    const simpleStaking = await deployStaking(
      usdc.address,
      cUsdc.address,
      "50",
      batUsdOracle.address,
      [usdc.address, bat.address, dai.address]
    );

    const reserve = await pair.getReserves();
    const usdcPairReserve = await usdcPair.getReserves();

    await usdc.transfer(cUsdc.address, ethers.utils.parseUnits("1000000", 6)); // We should put extra usdc to mock cUSDC contract in order to provide interest

    await usdc.approve(
      simpleStaking.address,
      ethers.utils.parseUnits("100", 6)
    );
    await simpleStaking.stake(ethers.utils.parseUnits("100", 6), 100, false);

    await cUsdc.increasePriceWithMultiplier("1500");

    const collectableContracts = await goodFundManager.calcSortedContracts(
      "1500000"
    );
    const currentGains = await simpleStaking.currentGains(true, true);

    await goodFundManager.collectInterest(collectableContracts, {
      gasLimit: 1500000,
    });
    const currentReserve = await pair.getReserves();
    const currentUsdcPairReserve = await usdcPair.getReserves();

    await simpleStaking.withdrawStake(ethers.utils.parseUnits("100", 6), false);
    expect(usdcPairReserve[1]).to.be.gt(currentUsdcPairReserve[1]); // Since we use multiple hops to swap initial reserves should be greater than after reserve for bat
    expect(reserve[0]).to.be.gt(currentReserve[0]); // bat reserve should be greater than initial reserve since we swap bat to dai
  });
  it("it should swap comp to dai", async () => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );

    const simpleStaking = await deployStaking(
      usdc.address,
      cUsdc.address,
      "50",
      batUsdOracle.address,
      [usdc.address, bat.address, dai.address]
    );

    comp["mint(address,uint256)"](
      simpleStaking.address,
      ethers.utils.parseEther("10000")
    );
    const collectableContracts = await goodFundManager.calcSortedContracts(
      "1500000"
    );
    const reserveBeforeSwap = await compPair.getReserves();
    await goodFundManager.collectInterest(collectableContracts, {
      gasLimit: 1500000,
    });
    const reserveAfterSwap = await compPair.getReserves();
    const safeAmount = reserveBeforeSwap[0].mul(BN.from(3)).div(BN.from(1000));
    expect(safeAmount).to.be.equal(
      reserveAfterSwap[0].sub(reserveBeforeSwap[0])
    );
  });
  async function addLiquidity(
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await bat.transfer(pair.address, token0Amount);
    await dai.transfer(pair.address, token1Amount);
    await pair.mint(founder.address);
  }
  async function deployStaking(
    token,
    itoken,
    blocksThreshold = "50",
    tokenUsdOracle,
    swapPath = null
  ) {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const currentBlock = await ethers.provider.getBlockNumber();
    const simpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          token,
          itoken,
          nameService.address,
          "Good Decimals",
          "gcDecimals",
          blocksThreshold,
          tokenUsdOracle,
          compUsdOracle.address,
          swapPath || [token, dai.address]
        );
        return contract;
      });
    let encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["100", simpleStaking.address, currentBlock, currentBlock + 10000, false]
    );
    await genericCall(goodFundManager.address, encodedData, avatar, 0);
    encodedData = goodCompoundStakingFactory.interface.encodeFunctionData(
      "setcollectInterestGasCostParams",
      ["250000", "150000"]
    );
    await genericCall(simpleStaking.address, encodedData, avatar, 0);
    return simpleStaking;
  }
});
