import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  SimpleStaking,
  GoodFundManager,
  DonationsStaking
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, deployUniswap } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
const BN = ethers.BigNumber;
const MaxUint256 = ethers.constants.MaxUint256;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("DonationsStaking - DonationStaking contract that receives funds in ETH/StakingToken and stake them in the SimpleStaking contract", () => {
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
  let donationsStaking: DonationsStaking;
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

    const uniswap = await deployUniswap();
    uniswapRouter = uniswap.router;

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

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });
    bat = await daiFactory.deploy(); // Another erc20 token for uniswap router test
    cBat = await cBatFactory.deploy(bat.address);
    console.log("setting permissions...");
    const tokenUsdOracleFactory = await ethers.getContractFactory(
      "BatUSDMockOracle"
    );
    daiUsdOracle = await tokenUsdOracleFactory.deploy();
    goodCompoundStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          "100000"
        );
        return contract;
      });

    console.log("initializing marketmaker...");

    setDAOAddress("UNISWAP_ROUTER", uniswapRouter.address);

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

    let mintAmount = ethers.utils.parseEther("1000");
    const ETHAmount = ethers.utils.parseEther("50");

    await dai["mint(uint256)"](mintAmount);

    await addETHLiquidity(mintAmount, ETHAmount);
    await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    const donationsStakingFactory = await ethers.getContractFactory(
      "DonationsStaking"
    );
    donationsStaking = (await upgrades.deployProxy(
      donationsStakingFactory,
      [nameService.address, goodCompoundStaking.address],
      {
        kind: "uups"
      }
    )) as DonationsStaking;
  });
  it("it should stake donations with ETH", async () => {
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
        currentBlockNumber + 500,
        false
      ] // set 10 gd per block
    );
    await genericCall(goodFundManager.address, encodedData);
    let stakeAmount = ethers.utils.parseEther("10");
    const totalStakedBeforeStake = await donationsStaking.totalStaked();
    let transaction = await (
      await donationsStaking.stakeDonations(0, { value: stakeAmount })
    ).wait();
    const totalStakedAfterStake = await donationsStaking.totalStaked();
    expect(totalStakedBeforeStake).to.be.equal(0);
    expect(totalStakedAfterStake).to.be.gt(totalStakedBeforeStake);
  });
  it("it should stake donations with DAI", async () => {
    let stakeAmount = ethers.utils.parseEther("10");
    await dai["mint(address,uint256)"](donationsStaking.address, stakeAmount);
    const totalStakedBeforeStake = await donationsStaking.totalStaked();
    let transaction = await (await donationsStaking.stakeDonations(0)).wait();
    const totalStakedAfterStake = await donationsStaking.totalStaked();
    expect(totalStakedAfterStake.sub(totalStakedBeforeStake)).to.be.equal(
      stakeAmount
    );
  });
  it("withdraw should reverted if caller not avatar", async () => {
    const tx = await donationsStaking
      .connect(staker)
      ["withdraw()"]()
      .catch(e => e);
    expect(tx.message).to.have.string("only avatar can call this method");
  });
  it("it should withdraw donationStaking when caller is avatar and return funds to avatar", async () => {
    const totalStakedBeforeEnd = await donationsStaking.totalStaked();
    const avatarDaiBalanceBeforeEnd = await dai.balanceOf(avatar);
    let isActive = await donationsStaking.active();
    expect(isActive).to.be.equal(true);
    const encoded = donationsStaking.interface.encodeFunctionData("withdraw");
    await genericCall(donationsStaking.address, encoded);

    isActive = await donationsStaking.active();
    const totalStakedAfterEnd = await donationsStaking.totalStaked();
    const avatarDaiBalanceAfterEnd = await dai.balanceOf(avatar);
    expect(avatarDaiBalanceAfterEnd).to.be.gt(avatarDaiBalanceBeforeEnd);
    expect(avatarDaiBalanceAfterEnd).to.be.equal(totalStakedBeforeEnd);
    expect(totalStakedAfterEnd).to.be.equal(0);
  });
  it("it should set stakingContract when avatar call it ", async () => {
    const donationsStakingFactory = await ethers.getContractFactory(
      "DonationsStaking"
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    const stakingContractBeforeSet = await donationsStaking.stakingContract();
    const stakingTokenBeforeSet = await donationsStaking.stakingToken();
    const simpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          bat.address,
          cDAI.address,
          nameService.address,
          "Good BAT",
          "gBAT",
          "172800",
          daiUsdOracle.address,
          "100000"
        );
        return contract;
      });
    let encodedData = donationsStakingFactory.interface.encodeFunctionData(
      "setStakingContract",
      [simpleStaking.address]
    );
    await genericCall(donationsStaking.address, encodedData);
    const stakingContractAfterSet = await donationsStaking.stakingContract();
    const stakingTokenAfterSet = await donationsStaking.stakingToken();
    expect(stakingContractBeforeSet).to.be.equal(goodCompoundStaking.address);
    expect(stakingTokenBeforeSet).to.be.equal(dai.address);
    expect(stakingContractAfterSet).to.be.equal(simpleStaking.address);
    expect(stakingTokenAfterSet).to.be.equal(bat.address);
  });
  async function addETHLiquidity(
    token0Amount: BigNumber,
    WETHAmount: BigNumber
  ) {
    await dai.approve(uniswapRouter.address, MaxUint256);
    await uniswapRouter.addLiquidityETH(
      dai.address,
      token0Amount,
      token0Amount,
      WETHAmount,
      founder.address,
      MaxUint256,
      {
        value: WETHAmount
      }
    );
  }
});
