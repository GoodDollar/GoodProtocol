import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { createDAO } from "../helpers";
import { deploy } from '../../scripts/test/localOldDaoDeploy';

const BN = ethers.BigNumber;
// APY=5% | Blocks per year = 12*60*24*365 = 6307200
// per block = nroot(1+0.05,numberOfBlocksPerYear) = 1000000007735630000
const INTEREST_RATE_5APY_X64 = BN.from("1000000007735630000");   // x64 representation of same number
const INTEREST_RATE_5APY_128 = BN.from("18446744216406738474"); // 128 representation of same number
// APY = 10% | nroot(1+0.10,numberOfBlocksPerYear) = 1000000015111330000
const INTEREST_RATE_10APY_X64 = BN.from("1000000015111330000");   // x64 representation of same number
const INTEREST_RATE_10APY_128 = BN.from("18446744352464388739"); // 128 representation of same number

describe("StakingRewardsFixedAPY - generic staking for fixed APY rewards contract", () => {
  let signers,
    avatar,
    genericCall,
    controller,
    fixedStakingMockFactory,
    fixedStaking;

  before(async () => {
    signers = await ethers.getSigners();

    let {
      controller: ctrl,
      avatar: av,
      genericCall: gc,
    } = await createDAO();

    avatar = av;
    genericCall = gc;
    controller = ctrl;

    fixedStakingMockFactory = await ethers.getContractFactory(
      "StakingMockFixedAPY"
    );
  });

  beforeEach(async () => {
    const interestRatePerBlock = BN.from(INTEREST_RATE_5APY_X64);
    fixedStaking = await fixedStakingMockFactory.deploy(interestRatePerBlock);
  });

  it("Should instantiate by constructor and get interest rate", async () => {
    const interestRatePerBlock = BN.from(INTEREST_RATE_5APY_X64);     // x64 representation of same number
    const interestRateInt128Format = BN.from(INTEREST_RATE_5APY_128); // 128 representation of same number
    const fixedStakingInstance = await (await ethers.getContractFactory(
      "StakingRewardsFixedAPY"
    )).deploy(interestRatePerBlock);

    const actualInterestRateIn128 = await fixedStakingInstance.interestRatePerBlockX64();
    expect(actualInterestRateIn128).to.equal(interestRateInt128Format);
  });

  it("should set APY", async () => {
    const beforeSetInterestRateIn128 = await fixedStaking.interestRatePerBlockX64();

    const interestRatePerBlockX64 = BN.from(INTEREST_RATE_10APY_X64);   // x64 representation of same number
    const interestRateInt128Format = BN.from(INTEREST_RATE_10APY_128);  // 128 representation of same number
    await fixedStaking.setAPY(interestRatePerBlockX64)

    const afterSetInterestRateIn128 = await fixedStaking.interestRatePerBlockX64();

    expect(afterSetInterestRateIn128).to.not.equal(beforeSetInterestRateIn128);
    expect(afterSetInterestRateIn128).to.equal(interestRateInt128Format);
  });

  it("should not allow to set APY with bad values?", async () => {
    // maybe we should add APY _interestRatePerBlock lower and upper limits?
  });

  it("should assert precision is 18e", async () => {
  });

  it("should update last update block after each operation stake/withdraw", async () => {
    // check once after stake
    // once after withdraw
  });

  // in the next few tests check after running a certain scenario 
  // to repeat scenarion maybe helper function or fixture
  // stake -> advance 1 year -> check stats, from here continue
  // in some tests add multiple stakers / withdraws

  it("Should get stakers info", async () => {
    // assert stakeinfo deposit, shared, rewardsPaid and avgRatio.
  });

  it("Should get contract stats", async () => {
    // especially the principle
    // assert after 1st staker, 2nd staker, 3rd staker
    // after 1st partial stake withdrawal, after 2nd complete withdrawal
  });

  it("should compound principle over period", async () => {
    // call compound and assert calculation
  });

  it("should get correct principle", async () => {
    // call getPrinciple and assert calculation
  });

  it("should calculate earned rewards in period", async () => {
    // stake
    // advance blocks
    // call earned, assert result
    // assert stakersInfo
    // advance again
  });

  it("Should check shares precision remains accurate", async () => {
    // still thinking it through, tbd
  });

  it("Should undo reward", async () => {
    // stake > pass time > collect reward > undo whole amount
  });

  it("Should fail to undo exceeding reward", async () => {
    // stake > pass time > collect reward > undo bigger amount
  });

  it("Should fail to withdraw exceeding amount", async () => {
  });
});
