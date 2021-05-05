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
    governanceStaking =await upgrades.deployProxy(
      governanceStakingFactory,
      [ grep.address,
        nameService.address,
        "DAOStaking",
        "DST"],
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
      "setRewardsPerBlock",
      ["10"]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
    
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100")
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()).to.be.equal("50")
    encodedCall = governanceStakingFactory.interface.encodeFunctionData(
        "setRewardsPerBlock",
        ["7"]
      );
      await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
  });

  it("Should be able to withdraw rewards without withdraw stake", async () => {

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawRewards()
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()).to.be.equal("35")
    await governanceStaking.withdrawStake("100")
  })

});
