import { ethers, upgrades } from "hardhat";
import { BigNumber, constants, Contract } from "ethers";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  SimpleStaking,
  GoodFundManager,
  DonationsStaking
} from "../../types";
import { createDAO, deployUniswap, getStakingFactory } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
const BN = ethers.BigNumber;
const MaxUint256 = ethers.constants.MaxUint256;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe.only("DonationsStaking - DonationStaking contract that receives funds in ETH/StakingToken and stake them in the SimpleStaking contract", () => {
  let dai: Contract;
  let bat: Contract;
  let pair: Contract, uniswapRouter: Contract, uniswapFactory: Contract;
  let cDAI, cDAI1, cDAI2, cDAI3, cBat, weth: Contract, comp: Contract;
  let gasFeeOracle,
    daiEthOracle: Contract,
    daiUsdOracle: Contract,
    batUsdOracle: Contract,
    ethUsdOracle: Contract,
    swapHelper,
    swapHelperTest,
    compUsdOracle: Contract;
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
    genericCall,
    goodCompoundStakingFactory;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cBatFactory = await ethers.getContractFactory("cBATMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    goodCompoundStakingFactory = await getStakingFactory(
      "GoodCompoundStakingV2"
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

    comp = await daiFactory.deploy();
    genericCall = gc;
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    const swapHelperTestFactory = await ethers.getContractFactory(
      "SwapHelperTest"
    );
    swapHelperTest = await swapHelperTestFactory.deploy();
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
    const uniswap = await deployUniswap(comp, dai);
    uniswapFactory = uniswap.factory;
    await setDAOAddress("UNISWAP_ROUTER", uniswap.router.address);
    uniswapRouter = uniswap.router;
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
    weth = uniswap.weth;
    console.log("setting permissions...");
    const tokenUsdOracleFactory = await ethers.getContractFactory(
      "BatUSDMockOracle"
    );
    compUsdOracle = await (
      await ethers.getContractFactory("CompUSDMockOracle")
    ).deploy();

    daiUsdOracle = await tokenUsdOracleFactory.deploy();
    const compUsdOracleFactory = await ethers.getContractFactory(
      "CompUSDMockOracle"
    );
    compUsdOracle = await compUsdOracleFactory.deploy();
    await setDAOAddress("UNISWAP_ROUTER", uniswapRouter.address);
    await setDAOAddress("COMP", comp.address);
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
          compUsdOracle.address,
          []
        );
        return contract;
      });
    console.log("staking contract initialized");

    batUsdOracle = await tokenUsdOracleFactory.deploy();

    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    swapHelper = await ethers
      .getContractFactory("UniswapV2SwapHelper")
      .then(_ => _.deploy());
    const donationsStakingFactory = await ethers.getContractFactory(
      "DonationsStaking",
      {
        libraries: {
          UniswapV2SwapHelper: swapHelper.address
        }
      }
    );
    donationsStaking = (await upgrades.deployProxy(
      donationsStakingFactory,
      [
        nameService.address,
        goodCompoundStaking.address,
        [NULL_ADDRESS, dai.address],
        [dai.address, NULL_ADDRESS]
      ],
      {
        kind: "uups",
        unsafeAllowLinkedLibraries: true
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
    let stakeAmount = ethers.utils.parseEther("5");
    const totalStakedBeforeStake = await donationsStaking.totalStaked();
    let transaction = await (
      await donationsStaking.stakeDonations({
        value: stakeAmount
      })
    ).wait();
    const totalStakedAfterStake = await donationsStaking.totalStaked();
    expect(totalStakedBeforeStake).to.be.equal(0);
    expect(totalStakedAfterStake).to.be.gt(totalStakedBeforeStake);
  });

  it("it should stake donations with DAI", async () => {
    let stakeAmount = ethers.utils.parseEther("10");
    await dai["mint(address,uint256)"](donationsStaking.address, stakeAmount);
    const totalStakedBeforeStake = await donationsStaking.totalStaked();
    let transaction = await (await donationsStaking.stakeDonations()).wait();
    const totalStakedAfterStake = await donationsStaking.totalStaked();
    expect(totalStakedAfterStake.sub(totalStakedBeforeStake)).to.be.equal(
      stakeAmount
    );
  });

  it("it should reverted when there is no token to stake", async () => {
    await expect(donationsStaking.stakeDonations()).to.be.revertedWith(
      "no stakingToken to stake"
    );
  });

  it("it should stake donations with ETH according to 0.3% of pool", async () => {
    let stakeAmount = ethers.utils.parseEther("20");
    const pairContract = await ethers.getContractAt(
      "UniswapPair",
      await uniswapFactory.getPair(await uniswapRouter.WETH(), dai.address)
    );
    const beforeDonationReserves = await pairContract.getReserves();

    let beforeDonationReserve = beforeDonationReserves[0];
    if ((await pairContract.token1()) === (await uniswapRouter.WETH())) {
      beforeDonationReserve = beforeDonationReserves[1];
    }
    const maxAmount = beforeDonationReserve
      .mul(await donationsStaking.maxLiquidityPercentageSwap())
      .div(100000);
    let transaction = await (
      await donationsStaking.stakeDonations({
        value: stakeAmount
      })
    ).wait();
    const afterDonationReserves = await pairContract.getReserves();
    let afterDonationReserve = afterDonationReserves[0];
    const ethBalanceAfterStake = await donationsStaking.provider.getBalance(
      donationsStaking.address
    );
    if ((await pairContract.token1()) === (await uniswapRouter.WETH())) {
      afterDonationReserve = afterDonationReserves[1];
    }
    expect(afterDonationReserve).to.be.equal(
      beforeDonationReserve.add(maxAmount)
    );
    expect(maxAmount).to.be.gt(0);
    expect(stakeAmount).to.be.gt(maxAmount);
    expect(stakeAmount.sub(maxAmount)).to.be.equal(ethBalanceAfterStake); // check leftover ETH in contract
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
    const avatarETHBalanceBeforeWithdraw =
      await donationsStaking.provider.getBalance(avatar);
    const balance = await goodCompoundStaking.balanceOf(
      donationsStaking.address
    );
    const ethBalanceBeforeWithdraw = await donationsStaking.provider.getBalance(
      donationsStaking.address
    );
    const encoded = donationsStaking.interface.encodeFunctionData("withdraw");
    await genericCall(donationsStaking.address, encoded);
    const ethBalanceAfterWithdraw = await donationsStaking.provider.getBalance(
      donationsStaking.address
    );
    isActive = await donationsStaking.active();
    const avatarETHBalanceAfterWithdraw =
      await donationsStaking.provider.getBalance(avatar);
    const totalStakedAfterEnd = await donationsStaking.totalStaked();
    const avatarDaiBalanceAfterEnd = await dai.balanceOf(avatar);
    expect(avatarDaiBalanceAfterEnd).to.be.gt(avatarDaiBalanceBeforeEnd);
    expect(avatarDaiBalanceAfterEnd).to.be.equal(totalStakedBeforeEnd);
    expect(ethBalanceAfterWithdraw).to.be.equal(0);
    expect(avatarETHBalanceAfterWithdraw).to.be.equal(
      ethBalanceBeforeWithdraw.add(avatarETHBalanceBeforeWithdraw)
    );
    expect(avatarDaiBalanceAfterEnd).to.be.equal(
      avatarDaiBalanceBeforeEnd.add(balance)
    );

    expect(totalStakedAfterEnd).to.be.equal(0);
  });

  it("it should set stakingContract when avatar call it ", async () => {
    let stakeAmount = ethers.utils.parseEther("6000"); // Max swap amount is around 5964 with current liquidity level so we should set it to higher number in order to test functionality

    await dai["mint(address,uint256)"](donationsStaking.address, stakeAmount);
    await donationsStaking.stakeDonations();
    const stakingAmountBeforeSet = await goodCompoundStaking.balanceOf(
      donationsStaking.address
    );
    const donationsStakingETHBalanceBeforeSet =
      await donationsStaking.provider.getBalance(donationsStaking.address);
    const stakingContractBeforeSet = await donationsStaking.stakingContract();
    const stakingTokenBeforeSet = await donationsStaking.stakingToken();
    const avatarDaiBalanceBeforeSet = await dai.balanceOf(avatar);
    const reserve = await swapHelperTest.getReserves(
      uniswapFactory.address,
      dai.address,
      weth.address
    );

    const safeSwappableAmount = reserve[0]
      .mul(BN.from(300))
      .div(BN.from(100000));
    const safeAmount =
      safeSwappableAmount > stakeAmount ? stakeAmount : safeSwappableAmount;
    const simpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async contract => {
        await contract.init(
          bat.address,
          cBat.address,
          nameService.address,
          "Good BAT",
          "gBAT",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address,
          [bat.address, dai.address]
        );
        return contract;
      });

    //not avatar
    await expect(
      donationsStaking.setStakingContract(simpleStaking.address, [
        NULL_ADDRESS,
        bat.address
      ])
    ).to.be.reverted;

    let encodedData = donationsStaking.interface.encodeFunctionData(
      "setStakingContract",
      [simpleStaking.address, [NULL_ADDRESS, bat.address]]
    );
    await genericCall(donationsStaking.address, encodedData);

    const avatarDaiBalanceAfterSet = await dai.balanceOf(avatar);
    const stakingAmountAfterSet = await goodCompoundStaking.balanceOf(
      donationsStaking.address
    );
    const stakingContractAfterSet = await donationsStaking.stakingContract();
    const stakingTokenAfterSet = await donationsStaking.stakingToken();
    const donationsStakingETHBalanceAfterSet =
      await donationsStaking.provider.getBalance(donationsStaking.address);
    const daiBalanceOfDonationsStaking = await dai.balanceOf(
      donationsStaking.address
    );
    expect(stakingAmountBeforeSet).to.be.gt(0);
    expect(stakingAmountAfterSet).to.be.equal(0);
    expect(stakingContractBeforeSet).to.be.equal(goodCompoundStaking.address);
    expect(stakingTokenBeforeSet).to.be.equal(dai.address);
    expect(stakingContractAfterSet).to.be.equal(simpleStaking.address);
    expect(stakingTokenAfterSet).to.be.equal(bat.address);
    expect(daiBalanceOfDonationsStaking).to.be.equal(0); // make sure there is no old staking tokens left in the donations staking
    expect(donationsStakingETHBalanceAfterSet).to.be.gt(
      // make sure that we sold possible amount of staking tokens that we can sell for ETH
      donationsStakingETHBalanceBeforeSet
    );
    expect(avatarDaiBalanceAfterSet).to.be.equal(
      avatarDaiBalanceBeforeSet.add(stakingAmountBeforeSet.sub(safeAmount))
    ); // It should send leftover stakingToken to avatar after swap to ETH in safeAmount
    expect(stakingAmountBeforeSet).to.be.gt(safeAmount); // maxSafeAmount must be smaller than actualstaking amount so we can verify that we hit the limit for transaction amount at once
  });

  it("it should return version of DonationsStaking properly", async () => {
    const version = await donationsStaking.getVersion();
    expect(version).to.be.equal("2.0.0");
  });

  it.only("it should not allow to stake donations when not active", async () => {
    let isActive = await donationsStaking.active();
    expect(isActive).to.be.equal(true);
    let stakeAmount = ethers.utils.parseEther("10");
    await dai["mint(address,uint256)"](donationsStaking.address, stakeAmount);
    await expect(donationsStaking.stakeDonations()).to.not.be.reverted;
    
    let encodedData = donationsStaking.interface.encodeFunctionData(
      "setActive",
      [false]
    );
    await genericCall(donationsStaking.address, encodedData);

    isActive = await donationsStaking.active();
    expect(isActive).to.be.equal(false);
    await dai["mint(address,uint256)"](donationsStaking.address, stakeAmount);
    await expect(donationsStaking.stakeDonations()).to.be.revertedWith("Contract is inactive");
  });
});
