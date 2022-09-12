import { default as hre, ethers, upgrades, network } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { deploy } from "../../scripts/test/localOldDaoDeploy";
import deploySettings from "../../releases/deploy-settings.json";
import GoodReserveCDai from "@gooddollar/goodcontracts/stakingModel/build/contracts/GoodReserveCDai.json";
import MarketMaker from "@gooddollar/goodcontracts/stakingModel/build/contracts/GoodMarketMaker.json";
import SimpleDAIStaking from "@gooddollar/goodcontracts/stakingModel/build/contracts/SimpleDAIStaking.json";
import { GoodMarketMaker } from "../../types";
const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("ProtocolUpgrade - Upgrade old protocol contracts to new ones", () => {
  let avatar,
    fuseAvatar,
    deployment,
    dai,
    cDAI,
    signers,
    oldReserve,
    oldFundManager,
    oldDAIStaking,
    identity,
    fuseIdentity,
    oldMarketMaker,
    oldDonationsStaking,
    cDaiBalanceOfOldReserveBeforeUpgrade,
    cDaiBalanceOfOldReserveAfterUpgrade,
    stakingAmountOfOldDonationsStakingBeforeUpgrade,
    stakingAmountOfOldDonationsStakingAfterUpgrade,
    ethBalanceOfOldDonationsStakingBeforeUpgrade,
    ethBalanceOfOldDonationsStakingAfterUpgrade,
    stakingAmountOfNewDonationStaking,
    oldReserveSupply,
    newReserveSupply,
    gdBalanceOfOldUBISchemeBeforeUpgrade,
    gdBalanceOfOldUBISchemeAfterUpgrade,
    isSchemeRegistrarRegistered,
    isSchemeRegistrarRegisteredFuse,
    isUpgradeSchemeRegisteredFuse,
    isSchemeRegistrarRegisteredAfterUpgradeFuse,
    isUpgradeSchemeRegisteredAfterUpgradeFuse,
    isCompoundVotingMachineRegisteredFuse,
    isUpgradeSchemeRegistered,
    goodDollar,
    fuseGoodDollar,
    newReserve,
    cdaiBalanceOfNewReserve,
    oldDaiStaking,
    isSchemeRegistrarRegisteredAfterUpgrade,
    isUpgradeSchemeRegisteredAfterUpgrade,
    isCompoundVotingMachineRegistered,
    newFundManager,
    oldUBIScheme,
    newUBIScheme,
    schemeMock,
    comp,
    founder,
    bancorFormula,
    newStakingContract,
    controller,
    fuseController,
    goodReserve;
  const { name: networkName } = network;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const prov = ethers.provider;
    let {
      Reserve: oldRes,
      MarketMaker: oldMm,
      cDAI: cDAIAddress,
      DAI: daiAddress,
      COMP: compAddress,
      DAIStaking: oldStaking,
      DonationsStaking: oldDonations,
      GoodDollar: gd,
      Controller: ctrl,
      SchemeRegistrar: schemeRegistrarAddress,
      UpgradeScheme: upgradeSchemeAddress,
      Identity,
      FundManager,
      DAIStaking,
      Avatar
    } = await deploy("test-mainnet"); // deploy old dao locally

    identity = Identity;
    oldFundManager = FundManager;
    oldDAIStaking = DAIStaking;

    console.log("deployed old mainnet dao");
    let {
      UBIScheme: oldUBISc,
      GoodDollar: fuseGd,
      Avatar: FuseAvatar,
      Controller: fuseCtrl,
      SchemeRegistrar: schemeRegistrarAddressFuse,
      UpgradeScheme: upgradeSchemeAddressFuse,
      Identity: FuseIdentity
    } = await deploy("test"); //deploy sidechain old dao localally

    avatar = Avatar;
    fuseAvatar = FuseAvatar;
    fuseIdentity = FuseIdentity;
    console.log("deployed old sidechain dao");

    oldMarketMaker = oldMm;
    oldDonationsStaking = oldDonations;
    cDAI = await ethers.getContractAt("cDAIMock", cDAIAddress);
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    oldDaiStaking = await ethers.getContractAt(
      SimpleDAIStaking.abi,
      oldStaking
    );
    comp = await ethers.getContractAt("DAIMock", compAddress);
    controller = await ethers.getContractAt("Controller", ctrl);
    fuseController = await ethers.getContractAt("Controller", fuseCtrl);
    //add some funds to reserve so we can test upgrade transfer
    oldReserve = await ethers.getContractAt(GoodReserveCDai.abi, oldRes);
    const oldMmContract = await ethers.getContractAt(MarketMaker.abi, oldMm);
    await cDAI["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("1000", 8)
    );
    await cDAI.approve(oldRes, ethers.utils.parseUnits("1000", 8));

    await oldReserve.buy(cDAI.address, ethers.utils.parseUnits("1000", 8), 0);
    cDaiBalanceOfOldReserveBeforeUpgrade = await cDAI.balanceOf(
      oldReserve.address
    );
    let oldReserveToken = await oldMmContract.reserveTokens(cDAI.address);
    oldReserveSupply = oldReserveToken.reserveSupply;
    fuseGoodDollar = await ethers.getContractAt("IGoodDollar", fuseGd);
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    //this will be non zero since it is initialized in localOldDaoDeploy.ts
    stakingAmountOfOldDonationsStakingBeforeUpgrade =
      await oldDaiStaking.stakers(oldDonations);
    oldUBIScheme = oldUBISc;
    gdBalanceOfOldUBISchemeBeforeUpgrade = await fuseGoodDollar.balanceOf(
      oldUBIScheme
    );
    isSchemeRegistrarRegistered = await controller.isSchemeRegistered(
      schemeRegistrarAddress,
      avatar
    );
    isSchemeRegistrarRegisteredFuse = await fuseController.isSchemeRegistered(
      schemeRegistrarAddressFuse,
      fuseAvatar
    );
    isUpgradeSchemeRegistered = await controller.isSchemeRegistered(
      upgradeSchemeAddress,
      avatar
    );
    isUpgradeSchemeRegisteredFuse = await fuseController.isSchemeRegistered(
      upgradeSchemeAddressFuse,
      fuseAvatar
    );
    ethBalanceOfOldDonationsStakingBeforeUpgrade = await prov.getBalance(
      oldDonationsStaking
    );

    const {
      main: performUpgrade
    } = require("../../scripts/upgradeToV2/upgradeToV2");

    console.log("running upgrades...");
    await performUpgrade("test");
    console.log("done sidechain upgrades...");
    await performUpgrade("test-mainnet");
    console.log("done mainnet upgrades...");
    gdBalanceOfOldUBISchemeAfterUpgrade = await fuseGoodDollar.balanceOf(
      oldUBIScheme
    );
    cDaiBalanceOfOldReserveAfterUpgrade = await cDAI.balanceOf(
      oldReserve.address
    );
    stakingAmountOfOldDonationsStakingAfterUpgrade =
      await oldDaiStaking.stakers(oldDonations);
    ethBalanceOfOldDonationsStakingAfterUpgrade = await prov.getBalance(
      oldDonationsStaking
    );
    const fse = require("fs-extra");
    deployment = await fse.readJson("releases/deployment.json");
    console.log("got deployment json file");
    cdaiBalanceOfNewReserve = await cDAI.balanceOf(
      deployment["test-mainnet"].GoodReserveCDai
    );
    newReserve = await ethers.getContractAt(
      "GoodReserveCDai",
      deployment["test-mainnet"].GoodReserveCDai
    );
    newStakingContract = await ethers.getContractAt(
      "GoodCompoundStakingV2",
      deployment["test-mainnet"].StakingContracts[0][0]
    );
    stakingAmountOfNewDonationStaking =
      await newStakingContract.getProductivity(
        deployment["test-mainnet"].DonationsStaking
      );
    newFundManager = await ethers.getContractAt(
      "GoodFundManager",
      deployment["test-mainnet"].GoodFundManager
    );
    const newMM = await ethers.getContractAt(
      "GoodMarketMaker",
      deployment["test-mainnet"].GoodMarketMaker
    );
    newUBIScheme = deployment["test"].UBIScheme;
    const newReserveToken = await newMM.reserveTokens(cDAI.address);
    newReserveSupply = newReserveToken.reserveSupply;
    isSchemeRegistrarRegisteredAfterUpgrade =
      await controller.isSchemeRegistered(schemeRegistrarAddress, avatar);
    isSchemeRegistrarRegisteredAfterUpgradeFuse =
      await fuseController.isSchemeRegistered(
        schemeRegistrarAddressFuse,
        fuseAvatar
      );
    isUpgradeSchemeRegisteredAfterUpgrade = await controller.isSchemeRegistered(
      upgradeSchemeAddress,
      avatar
    );
    isUpgradeSchemeRegisteredAfterUpgradeFuse =
      await fuseController.isSchemeRegistered(
        upgradeSchemeAddressFuse,
        fuseAvatar
      );
    isCompoundVotingMachineRegistered = await controller.isSchemeRegistered(
      deployment["test-mainnet"].CompoundVotingMachine,
      avatar
    );
    isCompoundVotingMachineRegisteredFuse =
      await fuseController.isSchemeRegistered(
        deployment["test"].CompoundVotingMachine,
        fuseAvatar
      );
  });

  it("should unregister old fundmanager, reserve, daistaking, identity, formula", async () => {
    const formula = await goodDollar.formula();
    console.log({
      identity,
      reserve: oldReserve.address,
      oldFundManager,
      oldDAIStaking,
      formula
    });
    expect(await controller.isSchemeRegistered(identity, avatar)).to.be.true;
    expect(await controller.getSchemePermissions(identity, avatar)).to.equal(
      "0x00000001"
    );

    expect(await controller.isSchemeRegistered(oldReserve.address, avatar)).to
      .be.false;
    expect(await controller.isSchemeRegistered(oldFundManager, avatar)).to.be
      .false;
    expect(await controller.isSchemeRegistered(oldDAIStaking, avatar)).to.be
      .false;
    expect(await controller.isSchemeRegistered(formula, avatar)).to.be.false;
    const stakingContract = await ethers.getContractAt(
      ["function paused() view returns(bool)"],
      oldDAIStaking
    );
    expect(await stakingContract.paused()).to.be.true;
  });

  it("should unregister old fuse ubi, identity, formula", async () => {
    const formula = await fuseGoodDollar.formula();
    console.log({
      fuseIdentity,
      oldUBIScheme,
      formula
    });

    expect(await fuseController.isSchemeRegistered(oldUBIScheme, fuseAvatar)).to
      .be.false;
    expect(await fuseController.isSchemeRegistered(formula, fuseAvatar)).to.be
      .false;

    expect(await fuseController.isSchemeRegistered(fuseIdentity, fuseAvatar)).to
      .be.true;
    expect(
      await fuseController.getSchemePermissions(fuseIdentity, fuseAvatar)
    ).to.equal("0x00000001");
  });

  it("it should update reserve and transfer old funds ", async () => {
    expect(cDaiBalanceOfOldReserveBeforeUpgrade).to.be.gt(0);
    expect(cDaiBalanceOfOldReserveAfterUpgrade).to.be.equal(0);
    expect(cdaiBalanceOfNewReserve).to.be.equal(
      ethers.utils.parseUnits("1000", 8)
    );
    expect(oldReserveSupply).to.be.gt(0);
    expect(newReserveSupply).to.be.equal(oldReserveSupply);
  });
  it("it should upgrade donationStaking from old one to new one properly and transfer funds", async () => {
    expect(stakingAmountOfOldDonationsStakingBeforeUpgrade[0]).to.be.gt(0);
    expect(stakingAmountOfOldDonationsStakingAfterUpgrade[0]).to.be.equal(0);
    expect(stakingAmountOfNewDonationStaking[0]).to.be.gt(0);
    expect(ethBalanceOfOldDonationsStakingBeforeUpgrade).to.be.gt(0);
    expect(ethBalanceOfOldDonationsStakingAfterUpgrade).to.be.equal(0);
  });
  it("it should set staking rewards per block properly for staking contract", async () => {
    const rewardsPerBlock = await newFundManager.rewardsForStakingContract(
      newStakingContract.address
    );
    expect(rewardsPerBlock[0]).to.be.equal(
      deploySettings.default.staking.rewardsPerBlock
    );
  });
  it("new reserve should have G$ minting permission", async () => {
    await cDAI["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("100", 8)
    );
    await cDAI.approve(newReserve.address, ethers.utils.parseUnits("100", 8));
    const founderGdBalanceBeforeBuy = await goodDollar.balanceOf(
      founder.address
    );
    await newReserve.buy(ethers.utils.parseUnits("100", 8), 0, founder.address);
    const founderGdBalanceAfterBuy = await goodDollar.balanceOf(
      founder.address
    );
    expect(founderGdBalanceAfterBuy).to.be.gt(founderGdBalanceBeforeBuy);
  });
  it("it should end old UBIScheme and transfer leftover UBIs to new UBIScheme", async () => {
    expect(gdBalanceOfOldUBISchemeBeforeUpgrade).to.be.gt(0);
    expect(gdBalanceOfOldUBISchemeAfterUpgrade).to.be.equal(0);
    const gdBalanceOfNewUBIScheme = await fuseGoodDollar.balanceOf(
      newUBIScheme
    );
    expect(gdBalanceOfNewUBIScheme).to.be.equal(
      gdBalanceOfOldUBISchemeBeforeUpgrade
    );
  });
  it("it should set nameservice variables properly", async () => {
    const fse = require("fs-extra");
    const deployment = await fse.readJson("releases/deployment.json");
    const oldDao = await fse.readJson("releases/olddao.json");
    const nameServiceContract = await ethers.getContractAt(
      "NameService",
      deployment["test-mainnet"].NameService
    );
    const reserveAddress = await nameServiceContract.getAddress("RESERVE");
    const marketMakerAddress = await nameServiceContract.getAddress(
      "MARKET_MAKER"
    );
    const fundManagerAddress = await nameServiceContract.getAddress(
      "FUND_MANAGER"
    );
    const reputationAddress = await nameServiceContract.getAddress(
      "REPUTATION"
    );
    const stakersDistributionAddress = await nameServiceContract.getAddress(
      "GDAO_STAKERS"
    );
    const bridgeContractAddress = await nameServiceContract.getAddress(
      "BRIDGE_CONTRACT"
    );
    const ubiRecipientAddress = await nameServiceContract.getAddress(
      "UBI_RECIPIENT"
    );
    expect(reserveAddress).to.be.equal(
      deployment["test-mainnet"].GoodReserveCDai
    );
    expect(marketMakerAddress).to.be.equal(
      deployment["test-mainnet"].GoodMarketMaker
    );
    expect(fundManagerAddress).to.be.equal(
      deployment["test-mainnet"].GoodFundManager
    );
    expect(reputationAddress).to.be.equal(
      deployment["test-mainnet"].GReputation
    );
    expect(stakersDistributionAddress).to.be.equal(
      deployment["test-mainnet"].StakersDistribution
    );
    expect(bridgeContractAddress).to.be.equal(
      oldDao["test-mainnet"].ForeignBridge
    );
    expect(ubiRecipientAddress).to.be.equal(deployment["test"].UBIScheme);
  });
  it("it should delete schemes after protocolupgrade and register new compoundvotingmachine", async () => {
    expect(isSchemeRegistrarRegistered).to.be.equal(true);
    expect(isUpgradeSchemeRegistered).to.be.equal(true);
    expect(isSchemeRegistrarRegisteredAfterUpgrade).to.be.equal(false);
    expect(isUpgradeSchemeRegisteredAfterUpgrade).to.be.equal(false);
    expect(isCompoundVotingMachineRegistered).to.be.equal(true);
  });
  it("it should upgrade fuse governance contracts properly and remove old schemes", async () => {
    expect(isSchemeRegistrarRegisteredFuse).to.be.equal(true);
    expect(isUpgradeSchemeRegisteredFuse).to.be.equal(true);
    expect(isSchemeRegistrarRegisteredAfterUpgradeFuse).to.be.equal(false);
    expect(isUpgradeSchemeRegisteredAfterUpgradeFuse).to.be.equal(false);
    expect(isCompoundVotingMachineRegisteredFuse).to.be.equal(true);
  });
  it("should set guardian from settings", async () => {
    const cvm = await ethers.getContractAt(
      "CompoundVotingMachine",
      deployment["test-mainnet"].CompoundVotingMachine
    );
    expect(await cvm.guardian()).to.equal(
      "0x914dA3B2508634998d244059dAb5488D9bA1814f"
    );
    const fuseCVM = await ethers.getContractAt(
      "CompoundVotingMachine",
      deployment["test"].CompoundVotingMachine
    );
    expect(await fuseCVM.guardian()).to.equal(
      "0x914dA3B2508634998d244059dAb5488D9bA1814f"
    );
  });

  it("should initialize reputation address", async () => {
    const cvm = await ethers.getContractAt(
      "CompoundVotingMachine",
      deployment["test-mainnet"].CompoundVotingMachine
    );
    expect(await cvm.rep()).to.equal(deployment["test-mainnet"].GReputation);
  });

  it("it should set fuse nameservice variables properly", async () => {
    const fse = require("fs-extra");
    const deployment = await fse.readJson("releases/deployment.json");
    const oldDao = await fse.readJson("releases/olddao.json");
    const nameServiceContract = await ethers.getContractAt(
      "NameService",
      deployment["test"].NameService
    );
    const reputationAddress = await nameServiceContract.getAddress(
      "REPUTATION"
    );
    const bridgeContractAddress = await nameServiceContract.getAddress(
      "BRIDGE_CONTRACT"
    );
    const ubiSchemeAddress = await nameServiceContract.getAddress("UBISCHEME");
    const gdaoStakingAddress = await nameServiceContract.getAddress(
      "GDAO_STAKING"
    );
    const gdaoClaimersAddress = await nameServiceContract.getAddress(
      "GDAO_CLAIMERS"
    );
    expect(reputationAddress).to.be.equal(deployment["test"].GReputation);
    expect(bridgeContractAddress).to.be.equal(oldDao["test"].ForeignBridge);
    expect(ubiSchemeAddress).to.be.equal(deployment["test"].UBIScheme);
    expect(gdaoStakingAddress).to.be.equal(
      deployment["test"].GovernanceStaking
    );
    expect(gdaoClaimersAddress).to.be.equal(
      deployment["test"].ClaimersDistribution
    );
  });
  it("it should be able to buy GD with exchangeHelper", async () => {
    const fse = require("fs-extra");
    const deployment = await fse.readJson("releases/deployment.json");
    const exchangeHelper = await ethers.getContractAt(
      "ExchangeHelper",
      deployment["test-mainnet"].ExchangeHelper
    );
    await cDAI["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("1000", 8)
    );
    await cDAI.approve(
      exchangeHelper.address,
      ethers.utils.parseUnits("1000", 8)
    );
    const gdBalanceBeforeBuy = await goodDollar.balanceOf(founder.address);
    await exchangeHelper.buy(
      [cDAI.address],
      ethers.utils.parseUnits("1000", 8),
      0,
      0,
      ethers.constants.AddressZero
    );
    const gdBalanceAfterBuy = await goodDollar.balanceOf(founder.address);
    expect(gdBalanceAfterBuy).to.be.gt(gdBalanceBeforeBuy);
  });
});
