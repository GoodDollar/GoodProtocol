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
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("SimpleDAISTAking - staking with cDAI mocks", () => {
  let dai: Contract;
  let cDAI, cDAI1, cDAI2, cDAI3: Contract;
  let comp: Contract;
  let gasFeeOracle,
    daiEthOracle: Contract,
    ethUsdOracle: Contract,
    daiUsdOracle: Contract,
    compUsdOracle: Contract;
  let goodReserve: GoodReserveCDai;
  let goodCompoundStaking;
  let goodFundManager: Contract;
  let avatar,
    identity,
    marketMaker: GoodMarketMaker,
    controller,
    founder,
    staker,
    schemeMock,
    signers,
    nameService,
    setDAOAddress,
    initializeToken;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

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
      avatar,
    });
    goodFundManager = await upgrades.deployProxy(
      goodFundManagerFactory,
      [nameService.address],
      { kind: "uups" }
    );
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address,
    });

    marketMaker = mm;

    console.log("setting permissions...");
    const tokenUsdOracleFactory = await ethers.getContractFactory(
      "BatUSDMockOracle"
    );
    daiUsdOracle = await tokenUsdOracleFactory.deploy();
    const daiFactory = await ethers.getContractFactory("DAIMock");

    setDAOAddress("UNISWAP_ROUTER", signers[0].address); // need this address for initialize simplestaking
    const compUsdOracleFactory = await ethers.getContractFactory(
      "CompUSDMockOracle"
    );
    compUsdOracle = await compUsdOracleFactory.deploy();
    //give reserve generic call permission
    goodCompoundStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    console.log("initializing marketmaker...");

    cDAI1 = await cdaiFactory.deploy(dai.address);
    const cdaiLowWorthFactory = await ethers.getContractFactory(
      "cDAILowWorthMock"
    );
    cDAI2 = await cdaiLowWorthFactory.deploy(dai.address);
    const cdaiNonMintableFactory = await ethers.getContractFactory(
      "cDAINonMintableMock"
    );
    cDAI3 = await cdaiNonMintableFactory.deploy(dai.address);
    await initializeToken(
      cDAI1.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    await initializeToken(
      cDAI2.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    await initializeToken(
      cDAI3.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    const encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", goodCompoundStaking.address, "1", "44", false] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);

    const gasFeeMockFactory = await ethers.getContractFactory(
      "GasPriceMockOracle"
    );
    gasFeeOracle = await gasFeeMockFactory.deploy();
    const daiEthPriceMockFactory = await ethers.getContractFactory(
      "DaiEthPriceMockOracle"
    );

    const ethUsdOracleFactory = await ethers.getContractFactory(
      "EthUSDMockOracle"
    );
    daiEthOracle = await daiEthPriceMockFactory.deploy();
    ethUsdOracle = await ethUsdOracleFactory.deploy();

    await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
  });

  it("should not be initializable twice", async () => {
    let tx = await goodCompoundStaking
      .init(
        dai.address,
        cDAI.address,
        nameService.address,
        "Good DAI",
        "gDAI",
        "172800",
        daiUsdOracle.address
      )
      .catch((e) => e);
    expect(tx.message).to.be.not.empty;
  });

  it("should mock cdai exchange rate 1e28 precision", async () => {
    let rate = await cDAI.exchangeRateStored();
    expect(rate.toString()).to.be.equal("10101010101010101010101010101");
  });

  it("should mint new dai", async () => {
    let balance = await dai.balanceOf(founder.address);
    expect(balance.toString()).to.be.equal("0");
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.transfer(staker.address, ethers.utils.parseEther("100"));
    balance = await dai.balanceOf(staker.address);
    expect(balance.toString()).to.be.at.equal("100000000000000000000");
  });

  it("should mint new cdai", async () => {
    let balance = await dai.balanceOf(staker.address);
    expect(balance.toString()).to.be.at.equal("100000000000000000000");
    await dai.connect(staker).approve(cDAI.address, "100000000000000000000");
    await cDAI.connect(staker)["mint(uint256)"](ethers.utils.parseEther("100"));

    balance = await dai.balanceOf(staker.address);
    expect(balance.toString()).to.be.equal("0");
    let cdaiBalance = await cDAI.balanceOf(staker.address);
    expect(cdaiBalance.toString()).to.be.equal("9900000000");
  });

  it("should redeem cdai", async () => {
    let cdaiBalance = await cDAI.balanceOf(staker.address);
    await cDAI.connect(staker)["redeem(uint256)"](cdaiBalance.toString());
    let balance = await dai.balanceOf(staker.address);
    let er = await cDAI.exchangeRateStored();
    expect(balance).to.be.equal(cdaiBalance.mul(er).div(BN.from(10).pow(18)));
    await dai.connect(staker).transfer(dai.address, balance.toString());
  });

  it("should return an error if non avatar account is trying to execute recover", async () => {
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cdai1 = await cdaiFactory.deploy(dai.address);
    await expect(goodCompoundStaking.recover(cdai1.address)).to.be.reverted;
  });

  it("should not transfer any funds if trying to execute recover of token without balance", async () => {
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cdai1 = await cdaiFactory.deploy(dai.address);
    await dai["mint(address,uint256)"](
      cdai1.address,
      ethers.utils.parseEther("100")
    );
    let balanceBefore = await cdai1.balanceOf(avatar);
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "recover",
      [cdai1.address]
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(
      goodCompoundStaking.address,
      encodedCall,
      avatar,
      0
    );
    let balanceAfter = await cdai1.balanceOf(avatar);
    expect(balanceAfter.toString()).to.be.equal(balanceBefore.toString());
  });
  it("should transfer funds when execute recover of token which the contract has some balance", async () => {
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cdai1 = await cdaiFactory.deploy(dai.address);
    await dai["mint(address,uint256)"](
      cdai1.address,
      ethers.utils.parseEther("100")
    );
    const cdai1BalanceFounder = await cdai1.balanceOf(founder.address);
    await cdai1.transfer(goodCompoundStaking.address, cdai1BalanceFounder);
    let balanceBefore = await cdai1.balanceOf(avatar);
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "recover",
      [cdai1.address]
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(
      goodCompoundStaking.address,
      encodedCall,
      avatar,
      0
    );
    let balanceAfter = await cdai1.balanceOf(avatar);
    expect(balanceAfter.sub(balanceBefore).toString()).to.be.equal(
      cdai1BalanceFounder.toString()
    );
  });

  it("should returns the exact amount of staked dai without any effect of having excessive dai tokens in the contract", async () => {
    expect(await nameService.getAddress("RESERVE")).to.be.equal(
      goodReserve.address
    );
    //we should change cDAI address to cDAI1's address in nameservice so it can work properly for this test case
    await setDAOAddress("CDAI", cDAI1.address);
    //update reserve addresses
    await goodReserve.setAddresses();
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI1.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    let encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", simpleStaking1.address, "1", "44", false] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    const weiAmount = ethers.utils.parseEther("1000");

    // staking dai
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    let stakerBalanceBefore = await dai.balanceOf(staker.address);

    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    await simpleStaking1.connect(staker).stake(weiAmount, 100, false);

    // transfer excessive dai to the contract
    await dai["mint(address,uint256)"](founder.address, weiAmount);
    await dai.transfer(simpleStaking1.address, weiAmount);
    let balanceBefore = await dai.balanceOf(avatar);

    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "recover",
      [dai.address]
    );

    await ictrl.genericCall(simpleStaking1.address, encodedCall, avatar, 0);
    await simpleStaking1.connect(staker).withdrawStake(weiAmount, false);
    let balanceAfter = await dai.balanceOf(avatar);
    let stakerBalanceAfter = await dai.balanceOf(staker.address);

    // checks that the excessive dai tokens have recovered and that all of the staked
    // tokens have returned to the staker
    expect(balanceAfter.sub(balanceBefore).toString()).to.be.equal(
      weiAmount.toString()
    );
    expect(stakerBalanceAfter.toString()).to.be.equal(
      stakerBalanceBefore.toString()
    );
    //should revert cdai address back in nameservice
    await setDAOAddress("CDAI", cDAI.address);
    //update reserve addresses
    await goodReserve.setAddresses();
    encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", simpleStaking1.address, "1", "44", true] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
  });

  it("should not transfer user's funds when execute recover", async () => {
    let depositAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, depositAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, depositAmount);
    let balanceBefore = await dai.balanceOf(avatar);
    let stakerBalanceBefore = await dai.balanceOf(staker.address);
    await goodCompoundStaking.connect(staker).stake(depositAmount, 100, false);

    let encodedCall = goodCompoundStaking.interface.encodeFunctionData(
      "recover",
      [dai.address]
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(
      goodCompoundStaking.address,
      encodedCall,
      avatar,
      0
    );
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(depositAmount, false);
    let balanceAfter = await dai.balanceOf(avatar);
    let stakerBalanceAfter = await dai.balanceOf(staker.address);
    expect(balanceAfter.toString()).to.be.equal(balanceBefore.toString());
    expect(stakerBalanceAfter.toString()).to.be.equal(
      stakerBalanceBefore.toString()
    );
  });

  it("should not transfer excessive cdai funds when total staked is more than 0 and not paused and execute recover", async () => {
    //should set CDAI in nameservice to cDAI1's address
    await setDAOAddress("CDAI", cDAI1.address);
    //update reserve addresses
    await goodReserve.setAddresses();
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI1.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    const weiAmount = ethers.utils.parseEther("1000");
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    let encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", simpleStaking1.address, "1", "44", false] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("100")
    );
    await dai.approve(cDAI1.address, ethers.utils.parseEther("100"));
    await cDAI1["mint(uint256)"](ethers.utils.parseEther("100"));
    const cdaiBalanceFM = await cDAI1.balanceOf(goodFundManager.address);
    await cDAI1.transfer(simpleStaking1.address, cdaiBalanceFM);
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    let balanceBefore = await cDAI1.balanceOf(avatar);
    let stakerBalanceBefore = await dai.balanceOf(staker.address);
    await simpleStaking1.connect(staker).stake(weiAmount, 100, false);
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "recover",
      [cDAI1.address]
    );

    await ictrl.genericCall(simpleStaking1.address, encodedCall, avatar, 0);
    await simpleStaking1.connect(staker).withdrawStake(weiAmount, false);
    let balanceAfter = await cDAI1.balanceOf(avatar);
    let stakerBalanceAfter = await dai.balanceOf(staker.address);
    expect(balanceAfter.sub(balanceBefore).toString()).to.be.equal("0");
    expect(stakerBalanceAfter.toString()).to.be.equal(
      stakerBalanceBefore.toString()
    );
    //should revert cdai address back in nameservice
    await setDAOAddress("CDAI", cDAI.address);
    //update reserve addresses
    await goodReserve.setAddresses();
    encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", simpleStaking1.address, "1", "44", true] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
  });

  it("should transfer excessive dai funds when execute recover", async () => {
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, ethers.utils.parseEther("100"));
    let totalStaked0 = await goodCompoundStaking.getProductivity(
      founder.address
    );
    totalStaked0 = totalStaked0[1];
    await goodCompoundStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"), 100, false);
    let totalStaked1 = await goodCompoundStaking.getProductivity(
      founder.address
    );
    totalStaked1 = totalStaked1[1];
    await dai["mint(address,uint256)"](
      goodCompoundStaking.address,
      ethers.utils.parseEther("100")
    );
    let stakerBalanceBefore = await dai.balanceOf(staker.address);
    let avatarBalanceBefore = await dai.balanceOf(avatar);
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "recover",
      [dai.address]
    );

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(
      goodCompoundStaking.address,
      encodedCall,
      avatar,
      0
    );
    let avatarBalanceAfter = await dai.balanceOf(avatar);

    // checks that after recover stake balance is still available
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(ethers.utils.parseEther("100"), false);
    let stakerBalanceAfter = await dai.balanceOf(staker.address);
    expect(totalStaked1.sub(totalStaked0).toString()).to.be.equal(
      ethers.utils.parseEther("100")
    );
    expect(stakerBalanceAfter.sub(stakerBalanceBefore).toString()).to.be.equal(
      totalStaked1.sub(totalStaked0).toString()
    );
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.be.equal(
      ethers.utils.parseEther("100")
    );
  });

  it("should be able to stake dai", async () => {
    let totalStakedBefore = await goodCompoundStaking.getProductivity(
      founder.address
    );
    totalStakedBefore = totalStakedBefore[1];
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, ethers.utils.parseEther("100"));
    await goodCompoundStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"), 100, false)
      .catch((e) => e);
    let totalStakedAfter = await goodCompoundStaking.getProductivity(
      founder.address
    );
    totalStakedAfter = totalStakedAfter[1];
    let balance = await goodCompoundStaking.getStakerData(staker.address);
    expect(balance[0].toString()).to.be.equal(
      ethers.utils.parseEther("100") //100 dai
    );
    expect(totalStakedAfter.sub(totalStakedBefore).toString()).to.be.equal(
      ethers.utils.parseEther("100")
    );
    let stakedcDaiBalance = await cDAI.balanceOf(goodCompoundStaking.address);
    expect(stakedcDaiBalance.toString()).to.be.equal(
      "9900000000" //8 decimals precision (99 cdai because of the exchange rate dai <> cdai)
    );
  });

  it("should be able to withdraw stake by staker", async () => {
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(
      goodCompoundStaking.address
    ); // simpleStaking cDAI balance
    let stakerDaiBalanceBefore = await dai.balanceOf(staker.address); // staker DAI balance
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
    let stakedcDaiBalanceAfter = await cDAI.balanceOf(
      goodCompoundStaking.address
    ); // simpleStaking cDAI balance
    let stakerDaiBalanceAfter = await dai.balanceOf(staker.address); // staker DAI balance
    let balanceAfter = await goodCompoundStaking.getStakerData(staker.address); // user staked balance in GoodStaking
    let totalStakedAfter = await goodCompoundStaking.getProductivity(
      founder.address
    ); // total staked in GoodStaking
    totalStakedAfter = totalStakedAfter[1];
    expect(stakedcDaiBalanceAfter.lt(stakedcDaiBalanceBefore)).to.be.true;
    expect(stakerDaiBalanceAfter.gt(stakerDaiBalanceBefore)).to.be.true;
    expect(balanceBefore[0].toString()).to.be.equal(
      (stakerDaiBalanceAfter - stakerDaiBalanceBefore).toString()
    );
    expect((totalStakedBefore - totalStakedAfter).toString()).to.be.equal(
      balanceBefore[0].toString()
    );
    expect(balanceAfter[0].toString()).to.be.equal("0");
    expect(stakedcDaiBalanceAfter.toString()).to.be.equal("0");
    expect(transaction.events.find((_) => _.event === "StakeWithdraw")).to.be
      .not.empty;
    expect(
      transaction.events.find((_) => _.event === "StakeWithdraw").args.staker
    ).to.be.equal(staker.address);
    expect(
      transaction.events
        .find((_) => _.event === "StakeWithdraw")
        .args.value.toString()
    ).to.be.equal((stakerDaiBalanceAfter - stakerDaiBalanceBefore).toString());
  });

  it("should be able to withdraw stake by staker when the worth is lower than the actual staked", async () => {
    //should set cdai in nameservice
    await setDAOAddress("CDAI", cDAI2.address);
    //update reserve addresses
    await goodReserve.setAddresses();
    dai["mint(address,uint256)"](
      cDAI2.address,
      ethers.utils.parseEther("100000000")
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI2.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    let encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", simpleStaking1.address, "1", "44", false] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    const weiAmount = ethers.utils.parseEther("1000");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    await simpleStaking1.connect(staker).stake(weiAmount, 100, false);
    let balanceBefore = await simpleStaking1.getStakerData(staker.address); // user staked balance in GoodStaking
    let stakerDaiBalanceBefore = await dai.balanceOf(staker.address); // staker DAI balance
    await simpleStaking1.connect(staker).withdrawStake(weiAmount, false);
    let balanceAfter = await simpleStaking1.getStakerData(staker.address); // user staked balance in GoodStaking
    let stakerDaiBalanceAfter = await dai.balanceOf(staker.address); // staker DAI balance
    expect(balanceAfter[0].toString()).to.be.equal("0");
    expect(balanceBefore[0].div(BN.from("2")).toString()).to.be.equal(
      stakerDaiBalanceAfter.sub(stakerDaiBalanceBefore).toString()
    );
    //should revert cdai address back in nameservice
    await setDAOAddress("CDAI", cDAI.address);
    //update reserve addresses
    await goodReserve.setAddresses();
    encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", simpleStaking1.address, "1", "44", true] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
  });
  it("should return 0s for gains when the current cdai worth is lower than the inital worth", async () => {
    //should set CDAI in nameService to cDAI1 address
    await setDAOAddress("CDAI", cDAI1.address);
    //update reserve addresses
    await goodReserve.setAddresses();
    await dai["mint(address,uint256)"](
      cDAI1.address,
      ethers.utils.parseEther("100000000")
    );

    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI1.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });

    const weiAmount = ethers.utils.parseEther("1000");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    await simpleStaking1.connect(staker).stake(weiAmount, 100, false);
    let gains = await simpleStaking1.currentGains(false, true);
    expect(gains["0"].toString()).to.be.equal("0"); // cdaiGains
    expect(gains["1"].toString()).to.be.equal("0"); // daiGains
    //should revert cdai address back in nameservice
    await setDAOAddress("CDAI", cDAI.address);
    //update reserve addresses
    await goodReserve.setAddresses();
  });

  it("should convert user staked DAI to the equal value of cDAI owned by the staking contract", async () => {
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, ethers.utils.parseEther("100"));
    await goodCompoundStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"), 100, false)
      .catch((e) => e);
    let stakedcDaiBalance = await cDAI.balanceOf(goodCompoundStaking.address);
    let stakercDaiBalance = await cDAI.balanceOf(staker.address);
    expect(stakedcDaiBalance.toString()).to.be.equal(
      "9900000000" //8 decimals precision
    );
    let stakedDaiBalance = await dai.balanceOf(goodCompoundStaking.address);
    expect(stakedDaiBalance.isZero()).to.be.true;
    expect(stakercDaiBalance.isZero()).to.be.true;
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(ethers.utils.parseEther("100"), false);
  });

  it("should not change the staker DAI balance if the conversion failed", async () => {
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const daiFactory = await ethers.getContractFactory("DAIMock");
    let fakeDai = await daiFactory.deploy();
    let fakecDAI = await cdaiFactory.deploy(fakeDai.address);
    await fakeDai["mint(address,uint256)"](
      fakecDAI.address,
      ethers.utils.parseEther("100000000")
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let fakeSimpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          fakecDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(fakeSimpleStaking.address, ethers.utils.parseEther("100"));
    let stakerDaiBalanceBefore = await dai.balanceOf(staker.address);
    const error = await fakeSimpleStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"), false)
      .catch((e) => e);
    expect(error.message).not.to.be.empty;
    let stakerDaiBalanceAfter = await dai.balanceOf(staker.address);
    expect(stakerDaiBalanceAfter.toString()).to.be.equal(
      stakerDaiBalanceBefore.toString()
    );
  });

  it("should not change the totalStaked if the conversion failed", async () => {
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const daiFactory = await ethers.getContractFactory("DAIMock");
    let fakeDai = await daiFactory.deploy();
    let fakecDAI = await cdaiFactory.deploy(fakeDai.address);
    await fakeDai["mint(address,uint256)"](
      fakecDAI.address,
      ethers.utils.parseEther("100000000")
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let fakeSimpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          fakecDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(fakeSimpleStaking.address, ethers.utils.parseEther("100"));
    let totalStakedBefore = await fakeSimpleStaking.getProductivity(
      founder.address
    );
    const error = await fakeSimpleStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"), false)
      .catch((e) => e);
    expect(error.message).not.to.be.empty;
    let totalStakedAfter = await fakeSimpleStaking.getProductivity(
      founder.address
    );
    expect(totalStakedAfter[1].toString()).to.be.equal(
      totalStakedBefore[1].toString()
    );
  });

  it("should not update the staker list if the conversion failed", async () => {
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const daiFactory = await ethers.getContractFactory("DAIMock");
    let fakeDai = await daiFactory.deploy();
    let fakecDAI = await cdaiFactory.deploy(fakeDai.address);
    await fakeDai["mint(address,uint256)"](
      fakecDAI.address,
      ethers.utils.parseEther("100000000")
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let fakeSimpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          fakecDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(fakeSimpleStaking.address, ethers.utils.parseEther("100"));
    const error = await fakeSimpleStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"), false)
      .catch((e) => e);
    expect(error.message).not.to.be.empty;
    let balance = await fakeSimpleStaking.getStakerData(staker.address);
    expect(balance[0].toString()).to.be.equal("0");
  });

  it("should be able to stake dai when the allowed dai amount is higher than the staked amount", async () => {
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, ethers.utils.parseEther("200"));

    let balanceBefore = await goodCompoundStaking.getStakerData(staker.address);
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(
      goodCompoundStaking.address
    );

    await goodCompoundStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"), 100, false)
      .catch((e) => e);

    let balanceAfter = await goodCompoundStaking.getStakerData(staker.address);
    expect((balanceAfter[0] - balanceBefore[0]).toString()).to.be.equal(
      "100000000000000000000" //100 dai
    );

    let stakedcDaiBalanceAfter = await cDAI.balanceOf(
      goodCompoundStaking.address
    );
    expect(
      (stakedcDaiBalanceAfter - stakedcDaiBalanceBefore).toString()
    ).to.be.equal(
      "9900000000" //8 decimals precision (99 cdai)
    );

    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(ethers.utils.parseEther("100"), false);
  });

  it("should not be able to stake 0 dai", async () => {
    const error = await goodCompoundStaking
      .connect(staker)
      .stake("0", 100, false)
      .catch((e) => e);
    expect(error.message).to.be.not.empty;
  });

  it("should not be able to stake when approved dai amount is lower than staking amount", async () => {
    let lowWeiAmount = ethers.utils.parseEther("99");
    let weiAmount = ethers.utils.parseEther("100");

    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, lowWeiAmount);

    const error = await goodCompoundStaking
      .connect(staker)
      .stake(weiAmount, 100, false)
      .catch((e) => e);
    expect(error);
    expect(error.message).not.to.be.empty;
  });

  it("should not be able to stake when staker dai balance is too low", async () => {
    let currentBalance = await dai.balanceOf(staker.address);
    let weiAmount = ethers.utils.parseEther("100");
    let approvedAmount = currentBalance.valueOf() + weiAmount;

    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, approvedAmount);

    const error = await goodCompoundStaking
      .connect(staker)
      .stake(approvedAmount, 100, false)
      .catch((e) => e);

    expect(error.message).not.to.be.empty;
  });

  it("should emit a DAIStaked event", async () => {
    let weiAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.approve(goodCompoundStaking.address, weiAmount);

    const transaction = await (
      await goodCompoundStaking.connect(staker).stake(weiAmount, 100, false)
    ).wait();

    expect(transaction.events.find((_) => _.event === "Staked")).not.to.be
      .empty;
    expect(
      transaction.events.find((_) => _.event === "Staked").args.value.toString()
    ).to.be.equal(weiAmount.toString());

    await goodCompoundStaking.connect(staker).withdrawStake(weiAmount, false);
  });

  it("should not withdraw interest to owner if cDAI value is lower than the staked", async () => {
    const weiAmount = ethers.utils.parseEther("1000");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(goodCompoundStaking.address, weiAmount);
    await goodCompoundStaking
      .connect(staker)
      .stake(weiAmount, 100, false)
      .catch((e) => e);
    const gains = await goodCompoundStaking.currentGains(false, true);
    const cdaiGains = gains["0"];
    const fundBalanceBefore = await cDAI.balanceOf(founder.address);
    await advanceBlocks(BLOCK_INTERVAL);
    await setDAOAddress("FUND_MANAGER", founder.address);
    const res = await goodCompoundStaking.collectUBIInterest(founder.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    const fundBalanceAfter = await cDAI.balanceOf(founder.address);
    expect(cdaiGains.toString()).to.be.equal("0");
    expect(fundBalanceAfter.toString()).to.be.equal(
      fundBalanceBefore.toString()
    );
    await goodCompoundStaking.connect(staker).withdrawStake(weiAmount, false);
  });

  it("should not be able to stake if the getting an error while minting new cdai", async () => {
    //should set CDAI in nameService to cDAI1 address
    await setDAOAddress("CDAI", cDAI3.address);
    //update reserve addresses
    await goodReserve.setAddresses();
    await dai["mint(address,uint256)"](
      cDAI3.address,
      ethers.utils.parseEther("100000000")
    );

    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI3.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });

    const weiAmount = ethers.utils.parseUnits("1000", "ether");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    const error = await simpleStaking1
      .connect(staker)
      .stake(weiAmount, 100, false)
      .catch((e) => e);
    expect(error.message).to.be.not.empty;
    //should revert cdai address back in nameservice
    await setDAOAddress("CDAI", cDAI.address);
    //update reserve addresses
    await goodReserve.setAddresses();
  });

  it("should mock cdai updated exchange rate", async () => {
    await cDAI.exchangeRateCurrent();
    let rate = await cDAI.exchangeRateStored();
    expect(rate.toString()).to.be.equal("10201010101010101010101010101");
  });

  it("should report interest gains", async () => {
    let stakingAmount = ethers.utils.parseEther("400");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking
      .connect(staker)
      .stake(stakingAmount, 100, false)
      .catch((e) => e);
    await cDAI.exchangeRateCurrent();
    const gains = await goodCompoundStaking.currentGains(false, true);

    const cdaiGains = gains["0"];

    expect(cdaiGains.toString()).to.be.equal("380659785"); //8 decimals precision
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("1000000")
    );
    await dai
      .connect(staker)
      .transfer(cDAI.address, ethers.utils.parseEther("1000000")); // We should put extra DAI to mock cDAI contract in order to provide interest
  });

  it("should withdraw interest to owner", async () => {
    const stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking
      .connect(staker)
      .stake(stakingAmount, 100, false)
      .catch((e) => e);

    await cDAI.increasePriceWithMultiplier("1500"); // increase interest by calling exchangeRateCurrent

    const gains = await goodCompoundStaking.currentGains(false, true);
    const cdaiGains = gains["0"];
    const fundBalance0 = await cDAI.balanceOf(goodReserve.address);
    const contractAddressesToBeCollected =
      await goodFundManager.calcSortedContracts("1100000");
    const res = await goodFundManager.collectInterest(
      contractAddressesToBeCollected,
      {
        gasLimit: 1100000,
      }
    );
    const fundBalance1 = await cDAI.balanceOf(goodReserve.address);
    const fundDaiWorth = await goodCompoundStaking.currentGains(false, true);
    expect(cdaiGains.toString()).to.be.equal(
      fundBalance1.sub(fundBalance0).toString()
    );
    expect(fundDaiWorth[2].toString()).to.be.equal(
      //it should be equal 100000000000000000000 but since there is some precision loss due to iToken decimal < token decimal it returns 100000000124064646464
      "100000000124064646464"
    );
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, false);
  });

  it("should withdraw only by fundmanager", async () => {
    const error = await goodCompoundStaking
      .connect(staker)
      .collectUBIInterest(founder.address)
      .catch((e) => e);
    expect(error.message).to.be.not.empty;
  });

  it("should not be able to double withdraw stake", async () => {
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);

    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);
    let balance = await goodCompoundStaking.getStakerData(staker.address);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(balance[0], false)
      .catch((e) => e);

    //make sure staking contract has the required balance to test double withdraw
    await cDAI["mint(address,uint256)"](
      goodCompoundStaking.address,
      stakingAmount.mul(1000)
    );

    await expect(
      goodCompoundStaking.connect(staker).withdrawStake(stakingAmount, false)
    ).to.be.reverted;
  });

  it("should not be able to withdraw if not a staker", async () => {
    await expect(
      goodCompoundStaking.withdrawStake(ethers.utils.parseEther("100"), false)
    ).to.be.reverted;
  });

  it("should not be able to change the reserve cDAI balance in case of an error", async () => {
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(goodReserve.address);
    await goodCompoundStaking
      .withdrawStake(ethers.utils.parseEther("100"), false)
      .catch((e) => e);
    let stakedcDaiBalanceAfter = await cDAI.balanceOf(goodReserve.address);
    expect(stakedcDaiBalanceAfter.toString()).to.be.equal(
      stakedcDaiBalanceBefore.toString()
    );
  });

  it("should be able to withdraw stake by staker and precision loss should not be equal to 0", async () => {
    const weiAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(goodCompoundStaking.address, weiAmount);
    await goodCompoundStaking
      .connect(staker)
      .stake(weiAmount, 100, false)
      .catch((e) => e);
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(
      goodCompoundStaking.address
    ); // simpleStaking cDAI balance
    const transaction = await goodCompoundStaking
      .connect(staker)
      .withdrawStake(weiAmount, false);
    let stakedcDaiBalanceAfter = await cDAI.balanceOf(
      goodCompoundStaking.address
    ); // simpleStaking cDAI balance
    expect(stakedcDaiBalanceAfter.lt(stakedcDaiBalanceBefore)).to.be.true;
    expect(stakedcDaiBalanceAfter.toString()).to.not.be.equal("0"); //precision loss, so it wont be exactly 0
  });

  it("should withdraw interest to recipient specified by the owner", async () => {
    const weiAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(goodCompoundStaking.address, weiAmount);
    await goodCompoundStaking
      .connect(staker)
      .stake(weiAmount, 100, false)
      .catch((e) => e);

    const gains = await goodCompoundStaking.currentGains(false, true);
    const cdaiGains = gains["0"];
    await advanceBlocks(BLOCK_INTERVAL);
    await setDAOAddress("FUND_MANAGER", founder.address);
    const res = await goodCompoundStaking.collectUBIInterest(staker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    const stakerBalance = await cDAI.balanceOf(staker.address);
    const fundDaiWorth = await goodCompoundStaking.currentGains(false, true);
    expect(cdaiGains.toString()).to.be.equal(stakerBalance.toString());
    // expect(fundDaiWorth.toString()).to.be.equal(
    //   // 10 gwei = 10 decimals + precisionLoss = 20 decimals = 100 ether of DAI
    //   web3.utils.toWei("10", "gwei") + precisionLossDai
    // );
  });
  it("it should be reverted when approved iToken amount is less than stake amount", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 8);
    await cDAI["mint(address,uint256)"](staker.address, stakingAmount);
    await cDAI
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount.div(2));
    const transaction = await goodCompoundStaking
      .connect(staker)
      .stake(stakingAmount, 100, true)
      .catch((e) => e);
    expect(transaction.message).to.have.string(
      "ERC20: transfer amount exceeds allowance"
    );
  });
  it("it should be able stake and withdraw their stake in iToken", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 8);

    await cDAI["mint(address,uint256)"](staker.address, stakingAmount);
    const stakercDAIBalanceBeforeStake = await cDAI.balanceOf(staker.address);
    await cDAI
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    const productivityBeforeStake = await goodCompoundStaking.getProductivity(
      staker.address
    );
    const stakingContractCdaiBalanceBeforeStake = await cDAI.balanceOf(
      goodCompoundStaking.address
    );
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, true);
    const stakingContractCdaiBalanceAfterStake = await cDAI.balanceOf(
      goodCompoundStaking.address
    );
    const stakercDAIBalanceAfterStake = await cDAI.balanceOf(staker.address);
    const productivityAfterStake = await goodCompoundStaking.getProductivity(
      staker.address
    );
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount, true);
    const stakingContractCdaiBalanceAfterWithdraw = await cDAI.balanceOf(
      goodCompoundStaking.address
    );
    const stakerCdaiBalanceAfterWithdraw = await cDAI.balanceOf(staker.address);
    const productivityAfterWithdraw = await goodCompoundStaking.getProductivity(
      staker.address
    );
    expect(productivityAfterStake[0].gt(productivityBeforeStake[0])).to.be.true;
    expect(productivityBeforeStake[0]).to.be.equal(
      productivityAfterWithdraw[0]
    );
    expect(stakercDAIBalanceBeforeStake.sub(stakingAmount)).to.be.equal(
      stakercDAIBalanceAfterStake
    );
    expect(stakerCdaiBalanceAfterWithdraw).to.be.equal(
      stakercDAIBalanceBeforeStake
    );
    expect(stakingContractCdaiBalanceAfterStake.sub(stakingAmount)).to.be.equal(
      stakingContractCdaiBalanceBeforeStake
    );
    expect(
      stakingContractCdaiBalanceAfterWithdraw.add(stakingAmount)
    ).to.be.equal(stakingContractCdaiBalanceAfterStake);
  });
  it("it should be able to stake in iToken and withdraw in Token", async () => {
    const stakingAmount = ethers.utils.parseUnits("100", 8);
    const daiMintAmount = ethers.utils.parseEther("100000");
    await dai["mint(address,uint256)"](cDAI.address, daiMintAmount);
    await cDAI["mint(address,uint256)"](staker.address, stakingAmount);
    await cDAI
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    const productivityBeforeStake = await goodCompoundStaking.getProductivity(
      staker.address
    );
    const stakerCdaiBalanceBeforeStake = await cDAI.balanceOf(staker.address);
    const stakingContractCdaiBalanceBeforeStake = await cDAI.balanceOf(
      goodCompoundStaking.address
    );
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, true);
    const stakingContractCdaiBalanceAfterStake = await cDAI.balanceOf(
      goodCompoundStaking.address
    );
    const stakerCdaiBalanceAfterStake = await cDAI.balanceOf(staker.address);
    const productivityAfterStaker = await goodCompoundStaking.getProductivity(
      staker.address
    );
    const stakerDaiBalanceBeforeWithdraw = await dai.balanceOf(staker.address);
    const exchangeRateStored = await cDAI.exchangeRateStored();
    const withdrawAmount = stakingAmount
      .mul(BN.from("10").pow(10))
      .mul(exchangeRateStored)
      .div(BN.from("10").pow(28));
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(withdrawAmount, false); // 1603010101010101010101 is equaliavent of 100cDAI in DAI with currentexchange rate
    const stakingContractCdaiBalanceAfterWithdraw = await cDAI.balanceOf(
      goodCompoundStaking.address
    );
    const stakerDaiBalanceAfterWithdraw = await dai.balanceOf(staker.address);
    const productivityAfterWithdraw = await goodCompoundStaking.getProductivity(
      staker.address
    );
    expect(productivityBeforeStake[0]).to.be.equal(
      productivityAfterWithdraw[0]
    );
    expect(stakerDaiBalanceAfterWithdraw.gt(stakerDaiBalanceBeforeWithdraw));
    expect(productivityAfterStaker[0].gt(productivityBeforeStake[0])).to.be
      .true;
    expect(stakerCdaiBalanceBeforeStake.sub(stakingAmount)).to.be.equal(
      stakerCdaiBalanceAfterStake
    );
    expect(stakingContractCdaiBalanceAfterStake.sub(stakingAmount)).to.be.equal(
      stakingContractCdaiBalanceBeforeStake
    );
    expect(
      stakingContractCdaiBalanceAfterWithdraw.lt(
        stakingContractCdaiBalanceAfterStake
      )
    ).to.be.true;
  });

  it("it should be able to stake in Token and withdraw in iToken", async () => {
    const stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    const stakerDaiBalanceBeforeStake = await dai.balanceOf(staker.address);
    const productivityBeforeStake = await goodCompoundStaking.getProductivity(
      staker.address
    );
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100, false);
    const stakerDaiBalanceAfterStake = await dai.balanceOf(staker.address);
    const productivityAfterStake = await goodCompoundStaking.getProductivity(
      staker.address
    );
    const stakerCdaiBalanceBeforeWithdraw = await cDAI.balanceOf(
      staker.address
    );
    const exchangeRateStored = await cDAI.exchangeRateStored();
    const withdrawAmount = stakingAmount
      .div(BN.from("10").pow(10))
      .mul(BN.from("10").pow(28))
      .div(exchangeRateStored);
    console.log("exchangeratestored %s", exchangeRateStored);
    console.log("withdrawAmount %s", withdrawAmount);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(withdrawAmount, true);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake("000000000036236363637", false); // 000000000036236363637 is precision loss due to itoken decimals < token decimals
    const stakerCdaiBalanceAfterWithdraw = await cDAI.balanceOf(staker.address);
    const productivityAfterWithdraw = await goodCompoundStaking.getProductivity(
      staker.address
    );

    expect(productivityBeforeStake[0]).to.be.equal(
      productivityAfterWithdraw[0]
    );
    expect(productivityAfterStake[0].gt(productivityBeforeStake[0])).to.be.true;
    expect(stakerDaiBalanceAfterStake.add(stakingAmount)).to.be.equal(
      stakerDaiBalanceBeforeStake
    );
    expect(stakerCdaiBalanceBeforeWithdraw.add("623826387")).to.be.equal(
      stakerCdaiBalanceAfterWithdraw
    );
  });

  it("should not withdraw interest if the recipient specified by the owner is the staking contract", async () => {
    await advanceBlocks(BLOCK_INTERVAL);
    await setDAOAddress("FUND_MANAGER", founder.address);
    const error = await goodCompoundStaking
      .collectUBIInterest(goodCompoundStaking.address)
      .catch((e) => e);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    expect(error.message).to.be.not.empty;
  });

  it("should pause the contract", async () => {
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "pause",
      [true]
    );

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(
      goodCompoundStaking.address,
      encodedCall,
      avatar,
      0
    );
    const isPaused = await goodCompoundStaking.isPaused();
    expect(isPaused).to.be.true;
  });

  it("should not transfer excessive cdai funds when the contract is paused and the total staked is not 0", async () => {
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    const weiAmount = ethers.utils.parseEther("100");

    // staking dai
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    await simpleStaking1.connect(staker).stake(weiAmount, 100, false);

    // transfer excessive cdai to the contract
    await dai["mint(address,uint256)"](founder.address, weiAmount);
    await dai.approve(cDAI.address, weiAmount);
    await cDAI["mint(uint256)"](weiAmount);
    const cdaiBalanceFounder = await cDAI.balanceOf(founder.address);
    await cDAI.transfer(simpleStaking1.address, cdaiBalanceFounder);
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "pause",
      [true]
    );

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(simpleStaking1.address, encodedCall, avatar, 0);
    let avatarBalanceBefore = await cDAI.balanceOf(avatar);
    encodedCall = simpleStakingFactory.interface.encodeFunctionData("recover", [
      cDAI.address,
    ]);
    await ictrl.genericCall(simpleStaking1.address, encodedCall, avatar, 0);
    let avatarBalanceAfter = await cDAI.balanceOf(avatar);
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.be.equal(
      "0"
    );
  });

  it("should not transfer excessive cdai funds when the contract is not paused and the total staked is 0", async () => {
    // totalStaked is equal to 0
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    let avatarBalanceBefore = await cDAI.balanceOf(avatar);
    let encodedCall = goodCompoundStakingFactory.interface.encodeFunctionData(
      "recover",
      [cDAI.address]
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(simpleStaking1.address, encodedCall, avatar, 0);
    let avatarBalanceAfter = await cDAI.balanceOf(avatar);
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.be.equal(
      "0"
    );
  });

  it("should transfer excessive cdai funds when execute recover", async () => {
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("100")
    );
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    const cdaiBalanceFounder1 = await cDAI.balanceOf(founder.address);
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    const cdaiBalanceFounder2 = await cDAI.balanceOf(founder.address);
    await cDAI.transfer(
      goodCompoundStaking.address,
      cdaiBalanceFounder2.sub(cdaiBalanceFounder1).toString()
    );
    let avatarBalanceBefore = await cDAI.balanceOf(avatar);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(ethers.utils.parseEther("100"), false);

    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "recover",
      [cDAI.address]
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(
      goodCompoundStaking.address,
      encodedCall,
      avatar,
      0
    );
    let avatarBalanceAfter = await cDAI.balanceOf(avatar);
    let stakingBalance = await cDAI.balanceOf(goodCompoundStaking.address);
    // checks that something was recovered
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.not.equal(
      "0"
    );
    expect(stakingBalance.toString()).to.be.equal("0");
  });

  it("should not transfer any funds if trying to execute recover of a token without balance", async () => {
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cdai1 = await cdaiFactory.deploy(dai.address);
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cdai1.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      });
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("100")
    );
    await dai.approve(cdai1.address, ethers.utils.parseEther("100"));
    await cdai1.balanceOf(founder.address);
    await cdai1["mint(uint256)"](ethers.utils.parseEther("100"));
    await cdai1.transfer(simpleStaking1.address, "0");
    let balanceBefore = await cdai1.balanceOf(avatar);

    let encodedCall = goodCompoundStakingFactory.interface.encodeFunctionData(
      "recover",
      [cdai1.address]
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(simpleStaking1.address, encodedCall, avatar, 0);
    let balanceAfter = await cdai1.balanceOf(avatar);
    expect(balanceAfter.toString()).to.be.equal(balanceBefore.toString());
  });

  it("it should be reverted when staking contract initialised with token that larger than 18 decimals", async () => {
    const twentyDecimalTokenFactory = await ethers.getContractFactory(
      "TwentyDecimalsTokenMock"
    );
    const twentyDecimalsToken = await twentyDecimalTokenFactory.deploy();
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          twentyDecimalsToken.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address
        );
        return contract;
      })

      .catch((e) => e);
    expect(simpleStaking.message).to.be.not.empty;
  });
});
