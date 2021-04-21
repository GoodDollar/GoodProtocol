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
      "setRewardsPerBlock",
      ["1000", goodCompoundStaking.address] // set 10 gd per block
    );
    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    await ictrl.genericCall(goodFundManager.address, encodedDataTwo, avatar, 0);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
  });

  it("should get g$ minting permissions", async () => {
    expect(await goodReserve.dao()).to.be.equal(controller);
    expect(await goodReserve.avatar()).to.be.equal(avatar);
    await goodReserve.start();
  });

  it("should be set fundmanager address in NameService", async () => {
    let fundManagerAddress = await nameService.getAddress("FUND_MANAGER");
    expect(fundManagerAddress).to.be.equal(goodFundManager.address);
  });

  it("should be set rewards per block for particular stacking contract", async () => {
    let rewardPerBlock = await goodFundManager.getRewardsPerBlock(
      goodCompoundStaking.address
    );
    expect(rewardPerBlock.toString()).to.be.equal("1000");
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
    // TODO should finish this test case after gd mint stuff resolved
  });
});
