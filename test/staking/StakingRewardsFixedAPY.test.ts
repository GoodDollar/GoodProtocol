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

  it("Should initialize using GoodDollarStaking ctor", async () => {
    // assert interestRatePerBlockX64 == ctor input
    // using GoodDollarStaking to be able to stake/withdraw
  });

  it("shouldn't allow set APY with bad values?", async () => {
    // maybe we should add APY _interestRatePerBlock lower and upper limits?
  });

  it("Should get stakers info", async () => {
    // after staking
    // advance 1 year
    // 
    // assert stakeinfo balance, reward, paid/minted
  });
  
  it("should assert precision is 18e", async () => {
  });
  
  it("should update last update block after each operation stake/withdraw", async () => {
    // check once after stake
    // once after withdraw
  });

  // think if to stake/withdraw and check all of these together or separately
  it("should calculate reward per token stored correctly", async () => {
  });
  
  it("should calculate principle and total staked correctly", async () => {
  });
  
  it("should calculate earned rewards in period", async () => {
    // stake
    // advance blocks
    // call earned, assert result
    // assert stakersInfo
    // advance again
  });

  it("Should be able to set APY only when avatar", async () => {
  });
});
