import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import { GoodMarketMaker, CERC20, GoodReserveCDai } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("GoodReserve - staking with cDAI mocks", () => {
  let dai: Contract;
  let cDAI, cDAI1: Contract;
  let goodReserve: GoodReserveCDai;
  let goodCompoundStaking;
  let goodFundManager: Contract;
  let goodDollar,
    avatar,
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
    const daiFactory = await ethers.getContractFactory("DAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );
    dai = await daiFactory.deploy();

    cDAI = await cdaiFactory.deploy(dai.address);

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      daoCreator,
      nameService: ns,
      setDAOAddress: sda,
      setSchemes,
      marketMaker: mm
    } = await createDAO();

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
      controller,
      cDAI.address,
      founder.address,
      founder.address,
      BLOCK_INTERVAL
    );
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address
    });
    goodDollar = await ethers.getContractAt("GoodDollar", gd);
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
      [controller, nameService.address, ethers.constants.HashZero],
      {
        initializer: "initialize(address,address,bytes32)"
      }
    )) as GoodReserveCDai;

    console.log("setting permissions...");

    //give reserve generic call permission
    await setSchemes([goodReserve.address, schemeMock.address]);
    goodCompoundStaking = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI.address,
      BLOCK_INTERVAL,
      controller,
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
    await marketMaker.initializeToken(
      cDAI1.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    await marketMaker.transferOwnership(goodReserve.address);

    const nsFactory = await ethers.getContractFactory("NameService");
    const encoded = nsFactory.interface.encodeFunctionData("setAddress", [
      "CDAI",
      cDAI.address
    ]);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(nameService.address, encoded, avatar, 0);

    //Set  Goodfundmanager's reserve
    const encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setReserve",
      [goodReserve.address]
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
  });

  it("should set marketmaker in the reserve by avatar", async () => {
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
  });

  it("should set fundManager in the reserve by avatar", async () => {
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
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
    const goodCompoundStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
    );

    let simpleStaking1 = await goodCompoundStakingFactory.deploy(
      dai.address,
      cDAI1.address,
      BLOCK_INTERVAL,
      controller,
      nameService.address
    );
    const weiAmount = ethers.utils.parseEther("1000");

    // staking dai
    await dai["mint(address,uint256)"](staker.address, weiAmount);
    let stakerBalanceBefore = await dai.balanceOf(staker.address);
    console.log(stakerBalanceBefore.toString());
    await dai.connect(staker).approve(simpleStaking1.address, weiAmount);
    await simpleStaking1.connect(staker).stake(weiAmount, 100);

    // transfer excessive dai to the contract
    await dai.mint(founder.address, weiAmount);
    await dai.transfer(simpleStaking1.address, weiAmount);
    let balanceBefore = await dai.balanceOf(avatar.address);

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
  });
});
