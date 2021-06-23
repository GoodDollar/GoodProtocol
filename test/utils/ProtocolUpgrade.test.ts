import { default as hre, ethers, upgrades, network } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import { networkNames } from "@openzeppelin/upgrades-core";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { deploy } from "../localOldDaoDeploy";
import deploySettings from "../../releases/deploy-settings.json";
import GoodReserveCDai from "@gooddollar/goodcontracts/stakingModel/build/contracts/GoodReserveCDai.json";
import MarketMaker from "@gooddollar/goodcontracts/stakingModel/build/contracts/GoodMarketMaker.json";
import SimpleDAIStaking from "@gooddollar/goodcontracts/stakingModel/build/contracts/SimpleDAIStaking.json";
import { GoodMarketMaker } from "../../types";
const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("ProtocolUpgrade - Upgrade old protocol contracts to new ones", () => {
  let nameService,
    dai,
    cDAI,
    signers,
    protocolUpgrade,
    oldReserve,
    oldMarketMaker,
    oldDonationsStaking,
    marketMaker,
    cDaiBalanceOfOldReserveBeforeUpgrade,
    cDaiBalanceOfOldReserveAfterUpgrade,
    stakingAmountOfOldDonationsStakingBeforeUpgrade,
    stakingAmountOfOldDonationsStakingAfterUpgrade,
    stakingAmountOfNewDonationStaking,
    oldReserveSupply,
    newReserveSupply,
    gdBalanceOfOldUBISchemeBeforeUpgrade,
    gdBalanceOfOldUBISchemeAfterUpgrade,
    isSchemeRegistrarRegistered,
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
    goodReserve;
  const { name: networkName } = network;
  networkNames[1] = networkName;
  networkNames[122] = networkName;
  networkNames[3] = networkName;
  before(async () => {
    [founder, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
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
      Avatar: avatar,
    } = await deploy("develop-mainnet"); // deploy old dao locally
    let { UBIScheme: oldUBISc, GoodDollar: fuseGd } = await deploy("develop"); //deploy sidechain old dao localally

    const {
      main: performUpgrade,
    } = require("../../scripts/upgradeToV2/upgradeToV2");
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
    isUpgradeSchemeRegistered = await controller.isSchemeRegistered(
      upgradeSchemeAddress,
      avatar
    );
    await performUpgrade("develop");
    await performUpgrade("develop-mainnet");
    gdBalanceOfOldUBISchemeAfterUpgrade = await fuseGoodDollar.balanceOf(
      oldUBIScheme
    );
    cDaiBalanceOfOldReserveAfterUpgrade = await cDAI.balanceOf(
      oldReserve.address
    );
    stakingAmountOfOldDonationsStakingAfterUpgrade =
      await oldDaiStaking.stakers(oldDonations);

    const deployment = require("../../releases/deployment.json");
    cdaiBalanceOfNewReserve = await cDAI.balanceOf(
      deployment["develop-mainnet"].GoodReserveCDai
    );
    newReserve = await ethers.getContractAt(
      "GoodReserveCDai",
      deployment["develop-mainnet"].GoodReserveCDai
    );
    newStakingContract = await ethers.getContractAt(
      "GoodCompoundStaking",
      deployment["develop-mainnet"].StakingContracts[0]
    );
    stakingAmountOfNewDonationStaking =
      await newStakingContract.getProductivity(
        deployment["develop-mainnet"].DonationsStaking
      );
    newFundManager = await ethers.getContractAt(
      "GoodFundManager",
      deployment["develop-mainnet"].GoodFundManager
    );
    const newMM = await ethers.getContractAt(
      "GoodMarketMaker",
      deployment["develop-mainnet"].GoodMarketMaker
    );
    newUBIScheme = deployment["develop"].UBIScheme;
    const newReserveToken = await newMM.reserveTokens(cDAI.address);
    newReserveSupply = newReserveToken.reserveSupply;
    isSchemeRegistrarRegisteredAfterUpgrade =
      await controller.isSchemeRegistered(schemeRegistrarAddress, avatar);
    isUpgradeSchemeRegisteredAfterUpgrade = await controller.isSchemeRegistered(
      upgradeSchemeAddress,
      avatar
    );
    isCompoundVotingMachineRegistered = await controller.isSchemeRegistered(
      deployment["develop-mainnet"].CompoundVotingMachine,
      avatar
    );
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
  });
  it("it should set staking rewards per block properly for staking contract", async () => {
    const rewardsPerBlock = await newFundManager.rewardsForStakingContract(
      newStakingContract.address
    );
    console.log(`rewardsPerBlock ${rewardsPerBlock}`);
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
    await newReserve.buy(
      cDAI.address,
      ethers.utils.parseUnits("100", 8),
      0,
      0,
      founder.address
    );
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
    const deployment = require("../../releases/deployment.json");
    const oldDao = require("../../releases/oldDao.json");
    const nameServiceContract = await ethers.getContractAt(
      "NameService",
      deployment["develop-mainnet"].NameService
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
      deployment["develop-mainnet"].GoodReserveCDai
    );
    expect(marketMakerAddress).to.be.equal(
      deployment["develop-mainnet"].GoodMarketMaker
    );
    expect(fundManagerAddress).to.be.equal(
      deployment["develop-mainnet"].GoodFundManager
    );
    expect(reputationAddress).to.be.equal(
      deployment["develop-mainnet"].GReputation
    );
    expect(stakersDistributionAddress).to.be.equal(
      deployment["develop-mainnet"].StakersDistribution
    );
    expect(bridgeContractAddress).to.be.equal(oldDao["develop-mainnet"].Bridge);
    expect(ubiRecipientAddress).to.be.equal(deployment["develop"].UBIScheme);
  });
  it("it should delete schemes after protocolupgrade", async () => {
    expect(isSchemeRegistrarRegistered).to.be.equal(true);
    expect(isUpgradeSchemeRegistered).to.be.equal(true);
    expect(isSchemeRegistrarRegisteredAfterUpgrade).to.be.equal(false);
    expect(isUpgradeSchemeRegisteredAfterUpgrade).to.be.equal(false);
    expect(isCompoundVotingMachineRegistered).to.be.equal(true);
  });
});
