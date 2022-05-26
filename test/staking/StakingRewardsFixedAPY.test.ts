import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { createDAO } from "../helpers";

describe("StakingRewardsFixedAPY - generic staking for fixed APY rewards contract", () => {
  let signers, avatar, genericCall, controller, nameService;
  before(async () => {
    signers = await ethers.getSigners();

    let {
      controller: ctrl,
      avatar: av,
      genericCall: gc,
      nameService: ns
    } = await createDAO();

    avatar = av;
    genericCall = gc;
    controller = ctrl;
    nameService = ns;
  });

  // initialize StakingMockFixedAPY once here
  // or in every test with deployStakingMock = async () => deploy and return new contract;

  // general checks
  it("Should initialize using GoodDollarStaking ctor", async () => {
    // assert interestRatePerBlockX64 == ctor input
    // using mock
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
