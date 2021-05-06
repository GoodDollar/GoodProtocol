import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  SimpleStaking,
  GReputation
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("GovernanceStaking - staking with GD  and get Rewards in GDAO", () => {
  let dai: Contract;
  let cDAI: Contract;
  let goodReserve: GoodReserveCDai;
  let governanceStaking: Contract;
  let goodFundManager: Contract;
  let grep: GReputation;
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
    setDAOAddress;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
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
      reputation,
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
    goodFundManager = await goodFundManagerFactory.deploy(
      nameService.address,
      cDAI.address,
      founder.address,
      founder.address,
      BLOCK_INTERVAL
    );
    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;
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

    console.log("setting permissions...");
    governanceStaking = await upgrades.deployProxy(
      governanceStakingFactory,
      [grep.address, nameService.address, "DAOStaking", "DST",ethers.utils.parseEther("12000000")],
      {
        unsafeAllowCustomTypes: true
      }
    );
    
    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();

    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
  });

  it("Should not mint reward when staking contract is not minter ", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(5);
    const error = await governanceStaking.withdrawStake("100").catch(e => e);
    expect(error.message).to.have.string(
      "GReputation: need minter role or be GDAO contract"
    );
  });

  it("Should be able mint rewards after set GDAO staking contract", async () => {
    await setDAOAddress("GDAO_STAKING", governanceStaking.address);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);

    expect(GDAOBalanceAfterWithdraw.gt(GDAOBalanceBeforeWithdraw)).to.be.true;
  });

  it("Avatar should be able to change rewards per block", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      [ethers.utils.parseEther("1728000")]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(
      GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()
    ).to.be.equal("50000000000000000000");
    encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      [ethers.utils.parseEther("12000000")]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
  });

  it("Should be able to withdraw rewards without withdraw stake", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    const transaction = await (
      await governanceStaking.withdrawRewards()
    ).wait();
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(
      GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()
    ).to.be.equal("347222222222222222220");
    expect(transaction.events.find(_ => _.event === "RewardsWithdraw")).to.be
      .not.empty;
    await governanceStaking.withdrawStake("100");
  });

  it("Should be able to withdraw transferred stakes", async () => {
    await goodDollar.mint(staker.address, "100");
    await goodDollar.connect(staker).approve(governanceStaking.address, "100");
    await governanceStaking.connect(staker).stake("100");
    await advanceBlocks(4);
    await governanceStaking.connect(staker).transfer(founder.address, "100");
    await governanceStaking.connect(staker).withdrawRewards()
    const gdaoBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const gdaoBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(gdaoBalanceAfterWithdraw.gt(gdaoBalanceBeforeWithdraw)).to.be.true;
  });

  it("should not be able to withdraw after they send their stake to somebody else", async () => {
    let transaction = await governanceStaking
      .connect(staker)
      .withdrawStake("100")
      .catch(e => e);
    expect(transaction.message).to.have.string("Not enough token staked");
  });

  it("it should distribute reward with correct precision", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      ["17280000000000000000"] // Give 0.0001 GDAO per block so 17.28 GDAO per month
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(
      GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()
    ).to.be.equal("500000000000000");
   
  });

  it("it should not generate rewards when rewards per block set to 0", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      ["0"] // Give 0 GDAO per block
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(
      GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()
    ).to.be.equal("0");
    encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      [ethers.utils.parseEther("12000000")]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
  });

  it("it should return productivity values correctly", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    const productivityValue = await governanceStaking.getProductivity(
      founder.address
    );

    expect(productivityValue[0].toString()).to.be.equal("100");
    expect(productivityValue[1].toString()).to.be.equal("100");
    await governanceStaking.withdrawStake("100");
  });

  it("it should return earned rewards with pending ones properly", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(5);
    const totalEarned = await governanceStaking.getUserPendingReward(
      founder.address
    );
    expect(totalEarned.toString()).to.be.equal("347222222222222222220");
    await governanceStaking.withdrawStake("100");
  });

  it("Accumulated per share has enough precision when reward << totalproductivity", async () => {
    await goodDollar.mint(founder.address, "100000000000000"); // 1 trillion gd stake
    await goodDollar.approve(governanceStaking.address, "1000000000000");
    await governanceStaking.stake("1000000000000");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("1000000000000");
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(
      GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()
    ).to.be.equal("347222222222222222220");
  });

  it("user receive fractional gdao properly when his stake << totalProductivity", async () => {
    await goodDollar.mint(founder.address, "800"); // 8gd
    await goodDollar.mint(staker.address, "200") // 2gd
    await goodDollar.approve(governanceStaking.address, "800");
    await goodDollar.connect(staker).approve(governanceStaking.address,"200")
    await governanceStaking.stake("800");
    await governanceStaking.connect(staker).stake("200")
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(staker.address);
    const FounderGDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("800");
    await governanceStaking.connect(staker).withdrawStake("200")
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(staker.address);
    const FounderGDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
   
    expect(FounderGDAOBalanceAfterWithdraw.sub(FounderGDAOBalanceBeforeWithdraw).toString()).to.be.equal("347222222222222222220")
    expect(GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()).to.be.equal("138888888888888888888"); // it gets full amount of rewards for 1 block plus 1/5 of amounts for 5 blokcs so 69444444444444444444 + 69444444444444444444


  });
});
