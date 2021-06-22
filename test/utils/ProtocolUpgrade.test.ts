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
    cdaiBalanceOfNewReserve,
    oldDaiStaking,
    newFundManager,
    schemeMock,
    comp,
    founder,
    bancorFormula,
    newStakingContract,
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
      DonationsStaking: oldDonations
    } = await deploy("develop-mainnet"); // deploy old dao locally
    await deploy("develop");
    const { main } = require("../../scripts/upgradeToV2/upgradeToV2");
    oldMarketMaker = oldMm;
    oldDonationsStaking = oldDonations;
    cDAI = await ethers.getContractAt("cDAIMock", cDAIAddress);
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    oldDaiStaking = await ethers.getContractAt(
      SimpleDAIStaking.abi,
      oldStaking
    );
    comp = await ethers.getContractAt("DAIMock", compAddress);
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
    stakingAmountOfOldDonationsStakingBeforeUpgrade = await oldDaiStaking.stakers(
      oldDonations
    );

    await main("develop");
    await main("develop-mainnet");

    cDaiBalanceOfOldReserveAfterUpgrade = await cDAI.balanceOf(
      oldReserve.address
    );
    stakingAmountOfOldDonationsStakingAfterUpgrade = await oldDaiStaking.stakers(
      oldDonations
    );

    const deployment = require("../../releases/deployment.json");
    cdaiBalanceOfNewReserve = await cDAI.balanceOf(
      deployment["develop-mainnet"].GoodReserveCDai
    );
    newStakingContract = await ethers.getContractAt(
      "GoodCompoundStaking",
      deployment["develop-mainnet"].StakingContracts[0]
    );
    stakingAmountOfNewDonationStaking = await newStakingContract.getProductivity(
      deployment["develop-mainnet"].DonationsStaking
    );
    newFundManager = newStakingContract = await ethers.getContractAt(
      "GoodFundManager",
      deployment["develop-mainnet"].GoodFundManager
    );
  });
  it("it should update reserve and transfer old funds ", async () => {
    expect(cDaiBalanceOfOldReserveBeforeUpgrade).to.be.gt(0);
    expect(cDaiBalanceOfOldReserveAfterUpgrade).to.be.equal(0);
    expect(cdaiBalanceOfNewReserve).to.be.equal(
      ethers.utils.parseUnits("1000", 8)
    );
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
});
