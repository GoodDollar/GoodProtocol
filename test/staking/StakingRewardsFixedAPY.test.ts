import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { createDAO, advanceBlocks } from '../helpers';
import { deploy } from '../../scripts/test/localOldDaoDeploy';

const BN = ethers.BigNumber;

// APY=5% | Blocks per year = 12*60*24*365 = 6307200
// per block = nroot(1+0.05,numberOfBlocksPerYear) = 1000000007735630000
const BLOCKS_ONE_YEAR = 6307200;
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
    fixedStaking,
    goodDollar,
    founder,
    staker1,
    staker2,
    staker3
    ;

  async function stake(_staker, _amount, _givebackRatio) {
    await goodDollar.mint(_staker.address, _amount);
    await goodDollar.connect(_staker).approve(fixedStaking.address, _amount);
    await fixedStaking.connect(_staker).stake(_staker.address, _amount, _givebackRatio);
  }

  function print(object) { // to be removed, just for debugging 
    object.forEach(element => {
      console.log(element.toString())
    });
    console.log(`----------------------`);
  }

  before(async () => {
    [founder, staker1, staker2, staker3, ...signers] = await ethers.getSigners();

    let {
      controller: ctrl,
      avatar: av,
      genericCall: gc,
      gd
    } = await createDAO();

    avatar = av;
    genericCall = gc;
    controller = ctrl;
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    fixedStakingMockFactory = await ethers.getContractFactory(
      "StakingMockFixedAPY"
    );
  });

  beforeEach(async () => {
    const interestRatePerBlock = BN.from(INTEREST_RATE_5APY_X64);
    fixedStaking = await fixedStakingMockFactory.deploy(interestRatePerBlock);
    await goodDollar.mint(fixedStaking.address, "10000000"); // to fund rewards
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

  it("should set APY successfully", async () => {
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

  it("should update last update block after each operation stake/withdraw", async () => {
    const statsBeforeStake1 = await fixedStaking.stats();
    print(statsBeforeStake1); // to be removed

    const stakeAmount1 = 100;
    await stake(staker1, stakeAmount1, 0);
    const info0 = await fixedStaking.stakersInfo(staker1.address);
    print(info0); // to be removed
    const statsAfterStake1 = await fixedStaking.stats();
    print(statsAfterStake1); // to be removed

    const stakeAmount2 = 200;
    await stake(staker2, stakeAmount2, 0);
    const info00 = await fixedStaking.stakersInfo(staker1.address);
    print(info00); // to be removed
    const statsAfterStake2 = await fixedStaking.stats();
    print(statsAfterStake2); // to be removed

    advanceBlocks(BLOCKS_ONE_YEAR);

    // change withdrawAmount2 to 51 to test reward withdrawal
    const withdrawAmount1 = 50, withdrawAmount2 = 50

    await fixedStaking.connect(staker1).withdraw(staker1.address, withdrawAmount1);
    const info1 = await fixedStaking.stakersInfo(staker1.address);
    print(info1); // to be removed
    const statsAfterWithdraw1 = await fixedStaking.stats();
    print(statsAfterWithdraw1); // to be removed

    const principleBeforeWithdraw = await fixedStaking.getPrinciple(staker1.address);
    console.log({ p: principleBeforeWithdraw.toString() }) // to be removed

    await fixedStaking.connect(staker1).withdraw(staker1.address, withdrawAmount2);
    const info2 = await fixedStaking.stakersInfo(staker1.address);
    print(info2); // to be removed
    const statsAfterWithdraw2 = await fixedStaking.stats();
    print(statsAfterWithdraw2); // to be removed

    // lastUpdateBlock
    expect(statsAfterStake1.lastUpdateBlock.gt(statsBeforeStake1.lastUpdateBlock));
    expect(statsAfterStake2.lastUpdateBlock.gt(statsAfterStake1.lastUpdateBlock));
    expect(statsAfterWithdraw1.lastUpdateBlock.gt(statsAfterStake2.lastUpdateBlock));
    expect(statsAfterWithdraw2.lastUpdateBlock.gt(statsAfterWithdraw1.lastUpdateBlock));

    // totalStaked
    expect(statsAfterStake1.totalStaked.eq(statsBeforeStake1.totalStaked.add(stakeAmount1)));
    expect(statsAfterStake2.totalStaked.eq(statsAfterStake1.totalStaked.add(stakeAmount2)));
    expect(statsAfterWithdraw1.totalStaked.eq(statsAfterStake2.totalStaked.sub(withdrawAmount1)));
    expect(statsAfterWithdraw2.totalStaked.eq(statsAfterWithdraw1.totalStaked.sub(withdrawAmount2)));

    // totalShares
    expect(statsAfterStake1.totalShares.gt(statsBeforeStake1.totalShares));
    expect(statsAfterStake2.totalShares.gt(statsAfterStake1.totalShares));
    expect(statsAfterWithdraw1.totalShares.lt(statsAfterStake2.totalShares));
    expect(statsAfterWithdraw2.totalShares.lt(statsAfterWithdraw1.totalShares));

    // // totalRewardsPaid
    // expect(statsAfterStake1.totalRewardsPaid.eq(statsBeforeStake1.totalRewardsPaid.add(stakeAmount1)));
    // expect(statsAfterStake2.totalRewardsPaid.eq(statsAfterStake1.totalRewardsPaid.add(stakeAmount2)));
    // expect(statsAfterWithdraw1.totalRewardsPaid.eq(statsAfterStake2.totalRewardsPaid.sub(withdrawAmount1)));
    // expect(statsAfterWithdraw2.totalRewardsPaid.eq(statsAfterWithdraw1.totalRewardsPaid.sub(withdrawAmount2)));

    // principle
    expect(statsAfterStake1.principle.gt(statsBeforeStake1.principle));
    expect(statsAfterStake2.principle.gt(statsAfterStake1.principle));
    expect(statsAfterWithdraw1.principle.lt(statsAfterStake2.principle));
    expect(statsAfterWithdraw2.principle.lt(statsAfterWithdraw1.principle));
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

  it("should assert precision is 18e and share precision is 1e6", async () => {
    // maybe not needed and the share precision is what's important
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
