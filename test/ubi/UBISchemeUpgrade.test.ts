import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, deployUBI,deployOldUBI } from "../helpers";
const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;





const MAX_INACTIVE_DAYS = 3;
const ONE_DAY = 86400;


describe("UBIScheme Upgrade Process", () => {
  let ubi, controller, ubiUpgrade,addWhitelisted,deployedDAO,nameService,setSchemes;
  let goodDollar, firstClaimPool;
  let reputation;
  let founder,
    claimer1,
    claimer2,
    signers,
    ubiScheme;
  before(async () => {

    [founder, claimer1,claimer2, ...signers] = await ethers.getSigners();
    const block = await ethers.provider.getBlock('latest');
    const roundToNextMidnight = block.timestamp % (60 * 60 * 24);
    await increaseTime(60 * 60 * 24 - roundToNextMidnight);
    deployedDAO = await createDAO();
    let {
      nameService: ns,
      genericCall: gn,
      reputation: rep,
      setDAOAddress,
      setSchemes:sc,
      addWhitelisted:wl,
      gd,
    } = deployedDAO;
    addWhitelisted = wl;
    nameService = ns;
    setSchemes = sc;
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

   
  });

  it("should deploy the ubi", async () => {
    const oldUbi = await deployOldUBI(deployedDAO);
    ubi = oldUbi.ubiScheme;
    firstClaimPool = oldUbi.firstClaim;
  
    let isActive = await ubi.isActive();
    expect(isActive).to.be.false;
    await setSchemes([ubi.address]);
    await ubi.start();
    isActive = await ubi.isActive();
    await addWhitelisted(claimer1.address, "claimer1");
    await addWhitelisted(claimer2.address, "claimer2");
    const newUbi = await firstClaimPool.ubi();
    let periodStart = await ubi.periodStart().then(_ => _.toNumber());
    let startDate = new Date(periodStart * 1000);
    expect(startDate.toISOString()).to.have.string("T12:00:00.000Z"); //contract set itself to start at noon GMT
    expect(newUbi.toString()).to.be.equal(ubi.address);
    expect(isActive).to.be.true;
    const gdBalance = await goodDollar.balanceOf(ubi.address)
    expect(gdBalance.toString()).to.be.equal(
      '1000000'
    );
  });

  it("should deploy upgrade", async () => {
    await increaseTime(60 * 60 * 24 * 30 * 2); //expire prev scheme
    const block = await ethers.provider.getBlock("latest");
    const startUBI = block.timestamp;
    const endUBI = startUBI + 60 * 60 * 24 * 30;
    ubiUpgrade = await upgrades.deployProxy(
      await ethers.getContractFactory("UBIScheme"),
      [nameService.address, firstClaimPool.address, 14]
    );
  });

  it("should not be able to upgrade until registered scheme", async () => {
    const res = await ubiUpgrade.upgrade(ubi.address).catch(_ => false);
    expect(res).to.be.false;
  });

  it("should start once registered scheme and prev scheme expired", async () => {
    const block = await ethers.provider.getBlock("latest");
    const now = block.timestamp;
    let {setSchemes} = deployedDAO
    await setSchemes([ubiUpgrade.address]);
    const res = await ubiUpgrade.upgrade(ubi.address);
    const newUbi = await firstClaimPool.ubi();
    let periodStart = await ubiUpgrade.periodStart().then(_ => _.toNumber());
    let startDate = new Date(periodStart * 1000);
    expect(newUbi.toString()).to.be.equal(ubiUpgrade.address);
    expect(startDate.toISOString()).to.have.string("T12:00:00.000Z"); //contract set itself to start at noon GMT
  });

  it("should have transferred funds correctly", async () => {
    const oldUbiBalance = await goodDollar.balanceOf(ubi.address);
    const newUbiBalance = await goodDollar.balanceOf(ubiUpgrade.address);
    expect(oldUbiBalance.toNumber()).to.equal(0);
    expect(newUbiBalance.toNumber()).to.equal(1000000); 
  });

  it("should have set new firstclaim await correctly", async () => {
    expect(await firstClaimPool.claimAmount().then(_ => _.toNumber())).to.equal(1000);
  });

  it("should not be able to call upgrade again", async () => {
    const res = await ubiUpgrade.upgrade(ubi.address).catch(_ => false);
    expect(res).to.be.false;
  });

  it("should not be able to claim until 12pm", async () => {
    const res = await ubiUpgrade.connect(claimer1).claim().catch(e => e.message);
    expect(res).to.contain("not in periodStarted");
  });

  it("should be able to claim after 12pm", async () => {
    const block = await ethers.provider.getBlock("latest");
    const now = block.timestamp;
    console.log(
      new Date(now * 1000),
      new Date(await ubiUpgrade.periodStart().then(_ => _.toNumber() * 1000))
    );
    const start = await ubiUpgrade.periodStart().then(_ => _.toNumber());
    const diff = start - now;

    await increaseTime(diff + 1);
    const res = await ubiUpgrade.connect(claimer1).claim();
    expect(res).to.not.be.false;
  });


  
});
