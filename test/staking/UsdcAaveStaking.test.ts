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
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import { experimentalAddHardhatNetworkMessageTraceHook } from "hardhat/config";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("UsdcAaveStaking - staking with USDC mocks to AAVE interface", () => {
  let dai: Contract;
  let usdc: Contract;
  let pair: Contract, uniswapRouter: Contract;
  let cDAI, cUsdc: Contract;
  let gasFeeOracle,
    daiEthOracle: Contract,
    daiUsdOracle: Contract,
    usdcUsdOracle: Contract,
    ethUsdOracle: Contract;
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
    lendingPool,
    setDAOAddress;
  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cUsdcFactory = await ethers.getContractFactory("cUSDCMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const goodAaveStakingFactory = await ethers.getContractFactory(
      "GoodAaveStaking"
    );
    const routerFactory = new ethers.ContractFactory(
      UniswapV2Router02.abi,
      UniswapV2Router02.bytecode,
      founder
    );
    const lendingPoolFactory = await ethers.getContractFactory(
      "LendingPoolMock"
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
    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

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
    goodAaveStaking = await goodAaveStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          usdc.address,
          lendingPool.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          "100000"
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
        "100000"
      )
    ).to.revertedWith("Initializable: contract is already initialized");
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
