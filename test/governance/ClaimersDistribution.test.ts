import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { ClaimersDistribution, GReputation } from "../../types";
import { createDAO, deployUBI, advanceBlocks, increaseTime } from "../helpers";

describe("ClaimersDistribution", () => {
  let reputation;
  let root,
    acct,
    claimer1,
    claimer2,
    claimer3,
    signers,
    nameService,
    genericCall,
    ubiScheme,
    cd: ClaimersDistribution;

  before(async () => {
    [
      root,
      acct,
      claimer1,
      claimer2,
      claimer3,
      ...signers
    ] = await ethers.getSigners();

    const deployedDAO = await createDAO();
    let {
      nameService: ns,
      genericCall: gn,
      reputation: rep,
      setDAOAddress,
      setSchemes,
      addWhitelisted
    } = deployedDAO;
    nameService = ns;
    genericCall = gn;
    reputation = rep;

    let ubi = await deployUBI(deployedDAO);
    cd = (await upgrades.deployProxy(
      await ethers.getContractFactory("ClaimersDistribution"),
      [ns.address]
    )) as ClaimersDistribution;

    ubiScheme = ubi.ubiScheme;
    setDAOAddress("GDAO_CLAIMERS", cd.address);
    addWhitelisted(claimer1.address, "claimer1");
    await addWhitelisted(claimer2.address, "claimer2");
    await increaseTime(60 * 60 * 24);
  });

  it("should initialize with monthly distribution", async () => {
    expect(await cd.monthlyReputationDistribution()).to.gt(0);
    expect(await cd.currentMonth()).to.gt(0);
  });

  it("should not be able to set monthly distribution", async () => {
    await expect(
      cd["setMonthlyReputationDistribution(uint256)"](10)
    ).to.revertedWith("only avatar");
  });

  it("should be able to set monthly distribution by avatar", async () => {
    const encoded = cd.interface.encodeFunctionData(
      "setMonthlyReputationDistribution",
      [1000]
    );
    await genericCall(cd.address, encoded);
    expect(await cd.monthlyReputationDistribution()).to.equal(1000);
  });

  it("should not update claim if didnt claim today", async () => {
    await expect(cd.updateClaim(claimer1.address)).to.revertedWith(
      "ClaimersDistribution: didn't claim today"
    );
  });

  it("should update claim if claimed today", async () => {
    const ts = Date.now();
    await ubiScheme.connect(claimer1).claim();
    expect(await cd.lastUpdated(claimer1.address)).gt((ts / 1000).toFixed(0));
    expect(await cd.getMonthClaims(claimer1.address)).to.equal(1);
    const monthData = await cd.months(await cd.currentMonth());
    expect(monthData.totalClaims).to.equal(1);
    expect(monthData.monthlyDistribution).to.equal(
      ethers.utils.parseEther("4000000")
    );
  });

  it("should not update claim if already updated", async () => {
    await expect(cd.updateClaim(claimer1.address)).to.revertedWith(
      "ClaimersDistribution: already updated"
    );
  });

  it("should update stats after second claimer", async () => {
    const ts = Date.now();
    await ubiScheme.connect(claimer2).claim();
    expect(await cd.lastUpdated(claimer2.address)).gt((ts / 1000).toFixed(0));
    expect(await cd.getMonthClaims(claimer2.address)).to.equal(1);
    const monthData = await cd.months(await cd.currentMonth());
    expect(monthData.totalClaims).to.equal(2);
    expect(monthData.monthlyDistribution).to.equal(
      ethers.utils.parseEther("4000000")
    );
  });

  it("should distribute reputation after a month and update to current monthly distribution", async () => {
    await increaseTime(60 * 60 * 24 * 30);
    const ts = Date.now();
    await ubiScheme.connect(claimer2).claim();
    expect(await cd.lastUpdated(claimer2.address)).gt((ts / 1000).toFixed(0));
    expect(await cd.getMonthClaims(claimer2.address)).to.equal(1);
    const monthData = await cd.months(await cd.currentMonth());
    expect(monthData.totalClaims).to.equal(1);
    expect(monthData.monthlyDistribution).to.equal(1000); //the newly set distribution is now 1000, set in previous test

    //distribution tests
    const curmonth = await cd.currentMonth();
    expect(await cd.lastMonthClaimed(claimer2.address)).to.equal(
      curmonth.sub(1)
    );
    const rep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;
    expect(await rep.balanceOf(claimer2.address)).to.equal(
      ethers.utils.parseEther("2000000")
    ); //half of reputation since he claimed once out of 2 claims
  });

  it("should be able to call distribute reputation directly", async () => {
    await cd.claimReputation(claimer1.address);

    //distribution tests
    const curmonth = await cd.currentMonth();
    expect(await cd.lastMonthClaimed(claimer1.address)).to.equal(
      curmonth.sub(1)
    );
    const rep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;
    expect(await rep.balanceOf(claimer1.address)).to.equal(
      ethers.utils.parseEther("2000000")
    ); //half of reputation since he claimed once out of 2 claims
  });

  //testing branch condition in ClaimersDistribution.sol line 85
  //`if (lastMonthClaimed[_claimer] >= prevMonth) return;`
  it("should not try to claimReputation when updating claim second time in month", async () => {
    const prevMonth = (await cd.currentMonth()).sub(1);
    expect(await cd.lastMonthClaimed(claimer1.address)).gte(prevMonth);
    await expect(ubiScheme.connect(claimer1).claim()).to.not.reverted;
  });

  it("should not be able to claim reputation if already distributed", async () => {
    await expect(cd.claimReputation(claimer1.address)).to.revertedWith(
      "already claimed"
    );
    await expect(cd.claimReputation(claimer2.address)).to.revertedWith(
      "already claimed"
    );
  });

  it("should be able to claim reputation if never claimed but get 0 reputation", async () => {
    await cd.claimReputation(claimer3.address);

    const curmonth = await cd.currentMonth();
    expect(await cd.lastMonthClaimed(claimer3.address)).to.equal(
      curmonth.sub(1)
    );

    const rep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;
    expect(await rep.balanceOf(claimer3.address)).to.equal(0);
  });
});
