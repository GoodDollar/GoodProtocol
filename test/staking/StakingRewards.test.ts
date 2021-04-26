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

describe("StakingRewards - staking with cDAI mocks and get Rewards in GoodDollar", () => {
  let dai: Contract;
  let cDAI, cDAI1, cDAI2, cDAI3: Contract;
  let goodReserve: GoodReserveCDai;
  let goodCompoundStaking;
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
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
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
      nameService.address,
      "Good DAI",
      "gDAI"
    );

    console.log("initializing marketmaker...");
    await marketMaker.initializeToken(
      cDAI.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    cDAI1 = await cdaiFactory.deploy(dai.address);
    const cdaiLowWorthFactory = await ethers.getContractFactory(
      "cDAILowWorthMock"
    );
    cDAI2 = await cdaiLowWorthFactory.deploy(dai.address);
    const cdaiNonMintableFactory = await ethers.getContractFactory(
      "cDAINonMintableMock"
    );
    cDAI3 = await cdaiNonMintableFactory.deploy(dai.address);
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
    await marketMaker.initializeToken(
      cDAI3.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    await marketMaker.transferOwnership(goodReserve.address);

    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

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
    const encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", goodCompoundStaking.address,"0","44",false] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    await goodReserve.start();
  });

  it("should be set rewards per block for particular stacking contract", async () => {
    let rewardPerBlock= await goodFundManager.rewardsForStakingContract(
      goodCompoundStaking.address
    );
    expect(rewardPerBlock[0].toString()).to.be.equal("1000");
    expect(rewardPerBlock[1].toString()).to.be.equal("0")
    expect(rewardPerBlock[2].toString()).to.be.equal("44")
    expect(rewardPerBlock[3]).to.be.equal(false)
    
  });

  it("should be able to earn rewards after some block passed", async () => {
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);

    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    await advanceBlocks(4);
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);

    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);
    expect(gdBalancerAfterWithdraw.toString()).to.be.equal("2500")
 
  });

  it("shouldn't be able to earn rewards after rewards blockend passed", async () => {
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);

    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    advanceBlocks(5);
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);
    
    expect(gdBalancerAfterWithdraw).to.be.equal(gdBalanceBeforeWithdraw)
    
  
  })

  it("shouldn't be able to mint reward when staking contract is blacklisted",async() =>{
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", goodCompoundStaking.address,"50","1000",true] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);

    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    advanceBlocks(5);
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);
    
    expect(gdBalancerAfterWithdraw).to.be.equal(gdBalanceBeforeWithdraw)

  })

  it("should set blacklisted false and mint rewards", async() => {
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const encodedDataTwo = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      ["1000", goodCompoundStaking.address,"50","1000",false] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);

    let gdBalanceBeforeWithdraw = await goodDollar.balanceOf(staker.address);
    advanceBlocks(5);
    await goodCompoundStaking.connect(staker).withdrawStake(stakingAmount);
    let gdBalancerAfterWithdraw = await goodDollar.balanceOf(staker.address);
    let gCDAIbalanceAfter = await goodCompoundStaking.balanceOf(staker.address)
    let gCDAITotalSupply = await goodCompoundStaking.totalSupply();
    expect(gCDAIbalanceAfter).to.be.equal(gCDAITotalSupply) // staker should own whole staking tokens
    expect(gdBalancerAfterWithdraw.toString()).to.be.equal("5500"); // should mint previous rewards as well
  })

  it("it should send staker's productivity to some other user", async() =>{
    let stakingAmount = ethers.utils.parseEther("100");
    await dai["mint(address,uint256)"](staker.address, stakingAmount);
    await dai
      .connect(staker)
      .approve(goodCompoundStaking.address, stakingAmount);
    await goodCompoundStaking.connect(staker).stake(stakingAmount, 100);
    let stakersProductivityBefore = await goodCompoundStaking.getProductivity(staker.address);
    await goodCompoundStaking.connect(staker).transfer(founder.address , stakingAmount);
    let stakersProductivityAfter = await goodCompoundStaking.connect(staker).getProductivity(staker.address);
    let foundersProductivity = await goodCompoundStaking.getProductivity(founder.address);

    expect(stakersProductivityAfter[0].toString()).to.be.equal("0");
    expect(foundersProductivity[0].toString()).to.be.equals(stakingAmount.toString());
    
  })

  it("it shouldn't be able to withdraw stake when staker sent it to another user", async() => {
    let stakingAmount = ethers.utils.parseEther("100");
    await expect( goodCompoundStaking.connect(staker).withdrawStake(stakingAmount)).to.be.reverted;

  })

});
