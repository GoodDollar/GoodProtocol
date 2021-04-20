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
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("SimpleDAISTAking - staking with cDAI mocks", () => {
  let dai: Contract;
  let cDAI, cDAI1,cDAI2: Contract;
  let goodReserve: GoodReserveCDai;
  let goodCompoundStaking;
  let goodFundManager: Contract;
  let avatar,
    identity,
    marketMaker: GoodMarketMaker,
    contribution,
    controller,
    founder,
    staker,
    schemeMock,
    signers,
    nameService,
    setDAOAddress;

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
      cdaiAddress
    } = await createDAO();
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar
    });
    goodFundManager = await goodFundManagerFactory.deploy(
      nameService.address,
      cDAI.address,
      founder.address,
      founder.address,
      BLOCK_INTERVAL
    );
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address
    });
    
    contribution = await ethers.getContractAt(
      ContributionCalculation.abi,
      await nameService.getAddress("CONTRIBUTION_CALCULATION")
    );

    marketMaker = mm;
    const reserveFactory = await ethers.getContractFactory("GoodReserveCDai");
    console.log("deployed contribution, deploying reserve...", {
      mmOwner: await marketMaker.owner(),
      founder: founder.address
    });
    goodReserve = (await upgrades.deployProxy(
      reserveFactory,
      [nameService.address, ethers.constants.HashZero],
      {
        initializer: "initialize(address,bytes32)"
      }
    )) as GoodReserveCDai;

    console.log("setting permissions...");

    //give reserve generic call permission
    await setSchemes([goodReserve.address, schemeMock.address]);
    goodCompoundStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address
    );

    console.log("initializing marketmaker...");
    await marketMaker.initializeToken(
      cDAI.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    cDAI1 = await cdaiFactory.deploy(dai.address);
    cDAI2 = await cdaiFactory.deploy(dai.address);
    await marketMaker.initializeToken(
      cDAI1.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    await marketMaker.initializeToken(
      cDAI2.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    await marketMaker.transferOwnership(goodReserve.address);

    setDAOAddress("CDAI", cDAI.address)
    setDAOAddress("DAI", dai.address)

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();
    //Set  Goodfundmanager's reserve
    const encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setReserve",
      [goodReserve.address]
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
  });

  it("should get g$ minting permissions", async () => {
    expect(await goodReserve.dao()).to.be.equal(controller);
    expect(await goodReserve.avatar()).to.be.equal(avatar);
    await goodReserve.start();
  });
  
  it("should be set fundmanager address in NameService", async() => {
    let fundManagerAddress = await nameService.getAddress("FUND_MANAGER")
    expect(fundManagerAddress).to.be.equal(goodFundManager.address)
  })

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
    expect(balance.toString()).to.be.equal("100000000000000000000");
    await dai.connect(staker).transfer(dai.address, balance.toString());
  });

  it("should return an error if non avatar account is trying to execute recover", async () => {
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const cdai1 = await cdaiFactory.deploy(dai.address);
    let error = await goodCompoundStaking.recover(cdai1.address).catch(e => e);
    expect(error.message).not.to.be.empty;
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
      "SimpleStaking"
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
      "SimpleStaking"
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
    //we should change cDAI address to cDAI1's address in nameservice so it can work properly for this test case
    await setDAOAddress("CDAI",cDAI1.address)
    //update reserve addresses
    await goodReserve.setAddresses()
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI1.address,
      BLOCK_INTERVAL,
      nameService.address
    );
    const weiAmount = ethers.utils.parseEther("1000");

    // staking dai
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    let stakerBalanceBefore = await dai.balanceOf(staker.address);

    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    await simpleStaking1.connect(staker).stake(weiAmount, 100);

    // transfer excessive dai to the contract
    await dai["mint(address,uint256)"](founder.address, weiAmount);
    await dai.transfer(simpleStaking1.address, weiAmount);
    let balanceBefore = await dai.balanceOf(avatar);

    const simpleStakingFactory = await ethers.getContractFactory(
      "SimpleStaking"
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
    await ictrl.genericCall(simpleStaking1.address, encodedCall, avatar, 0);
    await simpleStaking1.connect(staker).withdrawStake(weiAmount);
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
    await setDAOAddress("CDAI",cDAI.address)
    //update reserve addresses
    await goodReserve.setAddresses()
  });

  it("should not transfer user's funds when execute recover", async () => {
    let depositAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, depositAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, depositAmount);
    let balanceBefore = await dai.balanceOf(avatar);
    let stakerBalanceBefore = await dai.balanceOf(staker.address);
    await goodCompoundStaking.connect(staker).stake(depositAmount, 100);

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
    await goodCompoundStaking.connect(staker).withdrawStake(depositAmount);
    let balanceAfter = await dai.balanceOf(avatar);
    let stakerBalanceAfter = await dai.balanceOf(staker.address);
    expect(balanceAfter.toString()).to.be.equal(balanceBefore.toString());
    expect(stakerBalanceAfter.toString()).to.be.equal(
      stakerBalanceBefore.toString()
    );
  });

  it("should not transfer excessive cdai funds when total staked is more than 0 and not paused and execute recover", async () => {
    //should set CDAI in nameservice to cDAI1's address
    await setDAOAddress("CDAI",cDAI1.address)
    //update reserve addresses
    await goodReserve.setAddresses()
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI1.address,
      BLOCK_INTERVAL,
      nameService.address
    );
    const weiAmount = ethers.utils.parseEther("1000");

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
    await simpleStaking1.connect(staker).stake(weiAmount, 100);
    const simpleStakingFactory = await ethers.getContractFactory(
      "SimpleStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "recover",
      [cDAI1.address]
    );

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(simpleStaking1.address, encodedCall, avatar, 0);
    await simpleStaking1.connect(staker).withdrawStake(weiAmount);
    let balanceAfter = await cDAI1.balanceOf(avatar);
    let stakerBalanceAfter = await dai.balanceOf(staker.address);
    expect(balanceAfter.sub(balanceBefore).toString()).to.be.equal("0");
    expect(stakerBalanceAfter.toString()).to.be.equal(
      stakerBalanceBefore.toString()
    );
    //should revert cdai address back in nameservice
    await setDAOAddress("CDAI",cDAI.address)
    //update reserve addresses
    await goodReserve.setAddresses()
  });

  it("should transfer excessive dai funds when execute recover", async () => {
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, ethers.utils.parseEther("100"));
    let totalStaked0 = (await goodCompoundStaking.interestData())
      .globalTotalStaked;
    await goodCompoundStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"), 100);
    let totalStaked1 = (await goodCompoundStaking.interestData())
      .globalTotalStaked;
    await dai["mint(address,uint256)"](
      goodCompoundStaking.address,
      ethers.utils.parseEther("100")
    );
    let stakerBalanceBefore = await dai.balanceOf(staker.address);
    let avatarBalanceBefore = await dai.balanceOf(avatar);
    const simpleStakingFactory = await ethers.getContractFactory(
      "SimpleStaking"
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
      .withdrawStake(ethers.utils.parseEther("100"));
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
    let totalStakedBefore = (await goodCompoundStaking.interestData())
      .globalTotalStaked;
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, ethers.utils.parseEther("100"));
    await goodCompoundStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"), 100)
      .catch(console.log);
    let totalStakedAfter = (await goodCompoundStaking.interestData())
      .globalTotalStaked;
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
    let totalStakedBefore = (await goodCompoundStaking.interestData())
      .globalTotalStaked; // total staked in GoodStaking
    const transaction = await (
      await goodCompoundStaking.connect(staker).withdrawStake(balanceBefore[0])
    ).wait();
    let stakedcDaiBalanceAfter = await cDAI.balanceOf(
      goodCompoundStaking.address
    ); // simpleStaking cDAI balance
    let stakerDaiBalanceAfter = await dai.balanceOf(staker.address); // staker DAI balance
    let balanceAfter = await goodCompoundStaking.getStakerData(staker.address); // user staked balance in GoodStaking
    let totalStakedAfter = (await goodCompoundStaking.interestData())
      .globalTotalStaked; // total staked in GoodStaking
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
    expect(transaction.events.find(_ => _.event === "StakeWithdraw")).to.be.not
      .empty;
    expect(
      transaction.events.find(_ => _.event === "StakeWithdraw").args.staker
    ).to.be.equal(staker.address);
    expect(
      transaction.events
        .find(_ => _.event === "StakeWithdraw")
        .args.value.toString()
    ).to.be.equal((stakerDaiBalanceAfter - stakerDaiBalanceBefore).toString());
  });

  it("should be able to withdraw stake by staker when the worth is lower than the actual staked", async () => {
    //should set cdai in nameservice
    await setDAOAddress("CDAI",cDAI2.address)
    //update reserve addresses
    await goodReserve.setAddresses()
    dai["mint(address,uint256)"](cDAI2.address, ethers.utils.parseEther("100000000"));
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let simpleStaking1 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI2.address,
      BLOCK_INTERVAL,
      nameService.address
    );
    
    const weiAmount = ethers.utils.parseEther("1000");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    await simpleStaking1.connect(staker).stake(weiAmount, 100);
    let balanceBefore = (await simpleStaking1.getStakerData(staker.address)); // user staked balance in GoodStaking
    let stakerDaiBalanceBefore = await dai.balanceOf(staker.address); // staker DAI balance
    await simpleStaking1.connect(staker).withdrawStake(weiAmount);
    let balanceAfter = (await simpleStaking1.getStakerData(staker.address)); // user staked balance in GoodStaking
    let stakerDaiBalanceAfter = await dai.balanceOf(staker.address); // staker DAI balance
    expect(balanceAfter[0].toString()).to.be.equal("0");
    expect(balanceBefore[0].toString()).to.be.equal(
      stakerDaiBalanceAfter.sub(stakerDaiBalanceBefore).toString()
    );
    //should revert cdai address back in nameservice
    await setDAOAddress("CDAI",cDAI.address)
    //update reserve addresses
    await goodReserve.setAddresses()
  });
  it("should return 0s for gains when the current cdai worth is lower than the inital worth", async () => {
    //should set CDAI in nameService to cDAI1 address
    await setDAOAddress("CDAI",cDAI1.address)
    //update reserve addresses
    await goodReserve.setAddresses()
    await dai["mint(address,uint256)"](
      cDAI1.address,
      ethers.utils.parseEther("100000000")
    );

    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI1.address,
      BLOCK_INTERVAL,
      nameService.address
    );

    const weiAmount = ethers.utils.parseEther("1000");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    await simpleStaking1.connect(staker).stake(weiAmount, 100);
    let gains = await simpleStaking1.currentUBIInterest();

    expect(gains["0"].toString()).to.be.equal("0"); // cdaiGains
    expect(gains["1"].toString()).to.be.equal("0"); // daiGains
    expect(gains["2"].toString()).to.be.equal("0"); // precisionLossDai
    //should revert cdai address back in nameservice
    await setDAOAddress("CDAI",cDAI.address)
    //update reserve addresses
    await goodReserve.setAddresses()
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
      .stake(ethers.utils.parseEther("100"), 100)
      .catch(console.log);
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
      .withdrawStake(ethers.utils.parseEther("100"));
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

    let fakeSimpleStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      fakecDAI.address,
      BLOCK_INTERVAL,
      nameService.address
    );
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
      .stake(ethers.utils.parseEther("100"))
      .catch(e => e);
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

    let fakeSimpleStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      fakecDAI.address,
      BLOCK_INTERVAL,
      nameService.address
    );
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(fakeSimpleStaking.address, ethers.utils.parseEther("100"));
    let totalStakedBefore = await fakeSimpleStaking.interestData();
    const error = await fakeSimpleStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"))
      .catch(e => e);
    expect(error.message).not.to.be.empty;
    let totalStakedAfter = await fakeSimpleStaking.interestData();
    expect(totalStakedAfter[0].toString()).to.be.equal(
      totalStakedBefore[0].toString()
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

    let fakeSimpleStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      fakecDAI.address,
      BLOCK_INTERVAL,
      nameService.address
    );
    await dai["mint(address,uint256)"](
      staker.address,
      ethers.utils.parseEther("100")
    );
    await dai
      .connect(staker)
      .approve(fakeSimpleStaking.address, ethers.utils.parseEther("100"));
    const error = await fakeSimpleStaking
      .connect(staker)
      .stake(ethers.utils.parseEther("100"))
      .catch(e => e);
    expect(error.message).not.to.be.empty;
    let balance = await fakeSimpleStaking.getStakerData(staker.address);
    expect(balance[0].toString()).to.be.equal("0");
  });

  it("should be able to stake dai when the allowed dai amount is higher than the staked amount", async () => {
    await dai["mint(address,uint256)"](staker.address, ethers.utils.parseEther("100"));
    await dai.connect(staker).approve(goodCompoundStaking.address, ethers.utils.parseEther("200"));

    let balanceBefore = await goodCompoundStaking.getStakerData(staker.address);
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(goodCompoundStaking.address);

    await goodCompoundStaking.connect(staker)
      .stake(ethers.utils.parseEther("100"),100)
      .catch(console.log);

    let balanceAfter = await goodCompoundStaking.getStakerData(staker.address);
    expect((balanceAfter[0] - balanceBefore[0]).toString()).to.be.equal(
     "100000000000000000000" //100 dai
    );

    let stakedcDaiBalanceAfter = await cDAI.balanceOf(goodCompoundStaking.address);
    expect((stakedcDaiBalanceAfter - stakedcDaiBalanceBefore).toString()).to.be.equal(
      "9900000000" //8 decimals precision (99 cdai)
    );

    await goodCompoundStaking.connect(staker).withdrawStake(ethers.utils.parseEther("100"));
  });

  it("should not be able to stake 0 dai", async () => {
    const error = await goodCompoundStaking
      .connect(staker)
      .stake("0", 100)
      .catch(e => e);
    expect(error.message).to.have.string(
      "You need to stake a positive token amount"
    );
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
      .stake(weiAmount)
      .catch(e => e);
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
      .stake(approvedAmount)
      .catch(e => e);

    expect(error.message).not.to.be.empty;
  });

  it("should emit a DAIStaked event", async () => {
    let weiAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.approve(goodCompoundStaking.address, weiAmount);

    const transaction = await (
      await goodCompoundStaking.connect(staker).stake(weiAmount, 100)
    ).wait();

    expect(transaction.events.find(_ => _.event === "Staked")).not.to.be.empty;
    expect(
      transaction.events.find(_ => _.event === "Staked").args.value.toString()
    ).to.be.equal(weiAmount.toString());

    await goodCompoundStaking.connect(staker).withdrawStake(weiAmount);
  });

  it("should not withdraw interest to owner if cDAI value is lower than the staked", async () => {
    const weiAmount = ethers.utils.parseEther("1000");
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(goodCompoundStaking.address, weiAmount);
    await goodCompoundStaking.connect(staker)
      .stake(weiAmount, 100)
      .catch(console.log);
    const gains = await goodCompoundStaking.currentUBIInterest();
    const cdaiGains = gains["0"];
    const precisionLossDai = gains["2"].toString(); //last 10 decimals since cdai is only 8 decimals while dai is 18
    const fundBalanceBefore = await cDAI.balanceOf(founder.address);
    await advanceBlocks(BLOCK_INTERVAL);
    await setDAOAddress("FUND_MANAGER",founder.address)
    const res = await goodCompoundStaking.collectUBIInterest(founder.address);
    await setDAOAddress("FUND_MANAGER",goodFundManager.address)
    const fundBalanceAfter = await cDAI.balanceOf(founder.address);
    expect(cdaiGains.toString()).to.be.equal("0");
    expect(precisionLossDai.toString()).to.be.equal("0");
    expect(fundBalanceAfter.toString()).to.be.equal(fundBalanceBefore.toString());
    await goodCompoundStaking.connect(staker).withdrawStake(weiAmount);
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
      .stake(stakingAmount, 100)
      .catch(console.log);
    await cDAI.exchangeRateCurrent();
    const gains = await goodCompoundStaking.currentUBIInterest();

    const cdaiGains = gains["0"];
    const precisionLossDai = gains["2"];
    expect(cdaiGains.toString()).to.be.equal("380659786"); //8 decimals precision
    expect(precisionLossDai.toString()).to.be.equal("5733333332"); //10 decimals precision lost
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
  });

  it("should withdraw interest to owner", async () => {
    const stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking
      .connect(staker)
      .stake(stakingAmount, 100)
      .catch(console.log);
    const gains = await goodCompoundStaking.currentUBIInterest();
    const cdaiGains = gains["0"];
    const precisionLossDai = gains["2"]; //last 10 decimals since cdai is only 8 decimals while dai is 18
    const fundBalance0 = await cDAI.balanceOf(goodReserve.address);
    const res = await goodFundManager.transferInterest(
      goodCompoundStaking.address
    );
    const fundBalance1 = await cDAI.balanceOf(goodReserve.address);
    const fundDaiWorth = await goodCompoundStaking.currentTokenWorth();
    expect(cdaiGains.toString()).to.be.equal(
      fundBalance1.sub(fundBalance0).toString()
    );
    expect(fundDaiWorth.toString()).to.be.equal(
      //10 gwei = 10 decimals + precisionLoss = 20 decimals = 100 ether of DAI
      ethers.utils.parseUnits("1", 10) + precisionLossDai
    );
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
  });

  it("should withdraw only by fundmanager", async () => {
    const error = await goodCompoundStaking
      .connect(staker)
      .collectUBIInterest(founder.address)
      .catch(e => e);
    expect(error.message).to.have.string(
      "Only FundManager can call this method"
    );
  });

  it("should not be able to double withdraw stake", async () => {
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);
    let balance = await goodCompoundStaking.getStakerData(staker.address);
    await goodCompoundStaking
      .connect(staker)
      .withdrawStake(balance[0])
      .catch(e => console.log({ e }));
    const error = await goodCompoundStaking
      .connect(staker)
      .withdrawStake(stakingAmount)
      .catch(e => e);
    expect(error.message).to.have.string("Not enough token staked");
  });

  it("should not be able to withdraw if not a staker", async () => {
    const error = await goodCompoundStaking
      .withdrawStake(ethers.utils.parseEther("100"))
      .catch(e => e);
    expect(error.message).to.have.string("Not enough token staked");
  });

  it("should not be able to change the reserve cDAI balance in case of an error", async () => {
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(goodReserve.address);
    await goodCompoundStaking
      .withdrawStake(ethers.utils.parseEther("100"))
      .catch(e => e);
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
      .stake(weiAmount, 100)
      .catch(console.log);
    let stakedcDaiBalanceBefore = await cDAI.balanceOf(
      goodCompoundStaking.address
    ); // simpleStaking cDAI balance
    const transaction = await goodCompoundStaking
      .connect(staker)
      .withdrawStake(weiAmount);
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
      .stake(weiAmount, 100)
      .catch(console.log);

    const gains = await goodCompoundStaking.currentUBIInterest();
    const cdaiGains = gains["0"];
    const precisionLossDai = gains["2"].toString(); //last 10 decimals since cdai is only 8 decimals while dai is 18
    await advanceBlocks(BLOCK_INTERVAL);
    await setDAOAddress("FUND_MANAGER", founder.address);
    const res = await goodCompoundStaking.collectUBIInterest(staker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    const stakerBalance = await cDAI.balanceOf(staker.address);
    const fundDaiWorth = await goodCompoundStaking.currentTokenWorth();
    expect(cdaiGains.toString()).to.be.equal(stakerBalance.toString());
    // expect(fundDaiWorth.toString()).to.be.equal(
    //   // 10 gwei = 10 decimals + precisionLoss = 20 decimals = 100 ether of DAI
    //   web3.utils.toWei("10", "gwei") + precisionLossDai
    // );
  });

  it("should not withdraw interest if the recipient specified by the owner is the staking contract", async () => {
    await advanceBlocks(BLOCK_INTERVAL);
    await setDAOAddress("FUND_MANAGER", founder.address);
    const error = await goodCompoundStaking
      .collectUBIInterest(goodCompoundStaking.address)
      .catch(e => e);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    expect(error.message).to.have.string(
      "Recipient cannot be the staking contract"
    );
  });

  it("should pause the contract", async () => {
    const simpleStakingFactory = await ethers.getContractFactory(
      "SimpleStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "end",
      []
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
    const isPaused = await goodCompoundStaking.paused();
    expect(isPaused).to.be.true;
  });

  it("should not transfer excessive cdai funds when the contract is paused and the total staked is not 0", async () => {
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address
    );
    const weiAmount = ethers.utils.parseEther("100");

    // staking dai
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    await simpleStaking1.connect(staker).stake(weiAmount, 100);

    // transfer excessive cdai to the contract
    await dai["mint(address,uint256)"](founder.address, weiAmount);
    await dai.approve(cDAI.address, weiAmount);
    await cDAI["mint(uint256)"](weiAmount);
    const cdaiBalanceFounder = await cDAI.balanceOf(founder.address);
    await cDAI.transfer(simpleStaking1.address, cdaiBalanceFounder);
    const simpleStakingFactory = await ethers.getContractFactory(
      "SimpleStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData(
      "end",
      []
    );

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(
      simpleStaking1.address,
      encodedCall,
      avatar,
      0
    );
    let avatarBalanceBefore = await cDAI.balanceOf(avatar);
    encodedCall = simpleStakingFactory.interface.encodeFunctionData("recover", [
      cDAI.address
    ]);
    await ictrl.genericCall(
      simpleStaking1.address,
      encodedCall,
      avatar,
      0
    );
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

    let simpleStaking1 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      nameService.address
    );
    let avatarBalanceBefore = await cDAI.balanceOf(avatar);
    const simpleStakingFactory = await ethers.getContractFactory(
      "SimpleStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData("recover", [
      cDAI.address
    ]);
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(
      simpleStaking1.address,
      encodedCall,
      avatar,
      0
    );
    let avatarBalanceAfter = await cDAI.balanceOf(avatar);
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.be.equal(
      "0"
    );
  });

  it("should transfer excessive cdai funds when execute recover", async () => {
   
    await dai["mint(address,uint256)"](founder.address, ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    const cdaiBalanceFounder1 = await cDAI.balanceOf(founder.address);
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    const cdaiBalanceFounder2 = await cDAI.balanceOf(founder.address);
    await cDAI.transfer(goodCompoundStaking.address, cdaiBalanceFounder2.sub(cdaiBalanceFounder1).toString());
    let avatarBalanceBefore = await cDAI.balanceOf(avatar);
    await goodCompoundStaking.connect(staker).withdrawStake(ethers.utils.parseEther("100"));
    
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    let encodedCall = simpleStakingFactory.interface.encodeFunctionData("recover", [
      cDAI.address
    ]);
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
    expect(avatarBalanceAfter.sub(avatarBalanceBefore).toString()).to.not.equal("0");
    expect(stakingBalance.toString()).to.be.equal("0");
  });

  it("should not transfer any funds if trying to execute recover of a token without balance", async () => {
    const cdaiFactory = await ethers.getContractFactory("cDAIMock")
    const cdai1 = await cdaiFactory.deploy(dai.address);
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cdai1.address,
      BLOCK_INTERVAL,
      nameService.address
    );
    await dai["mint(address,uint256)"](founder.address, ethers.utils.parseEther("100"));
    await dai.approve(cdai1.address, ethers.utils.parseEther("100"));
    await cdai1.balanceOf(founder.address);
    await cdai1["mint(uint256)"](ethers.utils.parseEther("100"));
    await cdai1.transfer(simpleStaking1.address, "0");
    let balanceBefore = await cdai1.balanceOf(avatar);
    
    let encodedCall = goodCompoundStakingFactory.interface.encodeFunctionData("recover", [
      cdai1.address
    ]);
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ictrl.genericCall(
      simpleStaking1.address,
      encodedCall,
      avatar,
      0
    );
    let balanceAfter = await cdai1.balanceOf(avatar);
    expect(balanceAfter.toString()).to.be.equal(balanceBefore.toString());
  });

});
