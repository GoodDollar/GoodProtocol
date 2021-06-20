import { default as hre, ethers, upgrades, network } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import { networkNames } from "@openzeppelin/upgrades-core";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { deploy } from "../localOldDaoDeploy";
import GoodReserveCDai from "@gooddollar/goodcontracts/stakingModel/build/contracts/GoodReserveCDai.json";
import MarketMaker from "@gooddollar/goodcontracts/stakingModel/build/contracts/GoodMarketMaker.json";
import { GoodMarketMaker } from "../../types";
const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("ProtocolUpgrade - Upgrade old protocol contracts to new ones", () => {
  let nameService,
    dai,
    cDAI,
    avatar,
    identity,
    controller,
    contribution,
    schemeMock,
    oldSetScheme,
    goodDollar,
    signers,
    protocolUpgrade,
    oldReserve,
    oldMarketMaker,
    marketMaker,
    comp,
    founder,
    bancorFormula,
    goodReserve;
  const { name: networkName } = network;
  networkNames[1] = networkName;
  networkNames[122] = networkName;
  networkNames[3] = networkName;
  before(async () => {
    [founder, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
  });
  it("it should update reserve and transfer old funds ", async () => {
    let {
      Reserve: oldRes,
      MarketMaker: oldMm,
      cDAI: cDAIAddress,
      COMP: compAddress
    } = await deploy("develop-mainnet"); // deploy old dao locally
    await deploy("develop");
    const { main } = require("../../scripts/upgradeToV2/upgradeToV2");
    oldReserve = oldRes;
    oldMarketMaker = oldMm;
    const cDAI = await ethers.getContractAt("cDAIMock", cDAIAddress);
    const comp = await ethers.getContractAt("DAIMock", compAddress);
    const oldResContract = await ethers.getContractAt(
      GoodReserveCDai.abi,
      oldRes
    );
    const oldMmContract = await ethers.getContractAt(MarketMaker.abi, oldMm);
    await cDAI["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("1000", 8)
    );
    await cDAI.approve(oldRes, ethers.utils.parseUnits("1000", 8));
    let reserveToken = await oldMmContract.reserveTokens(cDAI.address);
    let reserveSupplyBeforeBuy = reserveToken.reserveSupply;
    await oldResContract.buy(
      cDAI.address,
      ethers.utils.parseUnits("1000", 8),
      0
    );
    reserveToken = await oldMmContract.reserveTokens(cDAI.address);
    let reserveSupplyAfter = reserveToken.reserveSupply;
    console.log(`reserveSupplyBeforeBuy ${reserveSupplyBeforeBuy}`);
    console.log(`reserveSupplyAfter ${reserveSupplyAfter}`);
    let cDaiBalanceOfOldReserve = await cDAI.balanceOf(oldReserve);
    console.log(`cDaiBalanceOfOldReserve ${cDaiBalanceOfOldReserve}`);
    expect(cDaiBalanceOfOldReserve).to.be.gt(0);
    await main("develop");
    await main("develop-mainnet");
    cDaiBalanceOfOldReserve = await cDAI.balanceOf(oldReserve);
    expect(cDaiBalanceOfOldReserve).to.be.equal(0);
    const deployment = require("../../releases/deployment.json");
    console.log(
      `deployment["develop-mainnet"].GoodReserveCDai ${deployment["develop-mainnet"].GoodReserveCDai}`
    );
    const cdaiBalanceOfNewReserve = await cDAI.balanceOf(
      deployment["develop-mainnet"].GoodReserveCDai
    );
    console.log(`cdaiBalanceOfNewReserve ${cdaiBalanceOfNewReserve}`);
    expect(cdaiBalanceOfNewReserve).to.be.equal(
      ethers.utils.parseUnits("1000", 8)
    );
  });
});
