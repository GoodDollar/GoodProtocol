import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { createDAO, advanceBlocks } from "../helpers";
import { deploy } from "../../scripts/test/localOldDaoDeploy";
import { StakingRewardsFixedAPY, StakingMockFixedAPY } from "../../types";
import { default as StakingABI } from "../../artifacts/contracts/mocks/StakingMockFixedAPY.sol/StakingMockFixedAPY.json";
const BN = ethers.BigNumber;

// APY=5% | Blocks per year = 12*60*24*365 = 6307200
// per block = nroot(1+0.05,numberOfBlocksPerYear) = 1000000007735630000
const BLOCKS_ONE_YEAR = 6307200;
const INTEREST_RATE_5APY_X64 = BN.from("1000000007735630000"); // x64 representation of same number
const INTEREST_RATE_5APY_128 = BN.from("18446744216406738474"); // 128 representation of same number
// APY = 10% | nroot(1+0.10,numberOfBlocksPerYear) = 1000000015111330000
const INTEREST_RATE_10APY_X64 = BN.from("1000000015111330000"); // x64 representation of same number
const INTEREST_RATE_10APY_128 = BN.from("18446744352464388739"); // 128 representation of same number

describe("StakingRewardsFixedAPY - generic staking for fixed APY rewards contract", () => {
  let signers,
    setNSAddress,
    nameService,
    avatar,
    genericCall,
    controller,
    fixedStakingMockFactory,
    fixedStaking: StakingMockFixedAPY,
    goodDollar,
    founder,
    staker1,
    staker2,
    staker3,
    staker4;

  async function stake(
    _staker,
    _amount,
    _givebackRatio,
    contract = fixedStaking
  ) {
    await contract
      .connect(_staker)
      .stake(_staker.address, _amount, _givebackRatio);
  }

  function print(object) {
    // to be removed, just for debugging
    object.forEach(element => {
      console.log(element.toString());
    });
    console.log(`----------------------`);
  }

  before(async () => {
    [founder, staker1, staker2, staker3, staker4, ...signers] =
      await ethers.getSigners();

    let {
      controller: ctrl,
      avatar: av,
      genericCall: gc,
      gd,
      nameService: ns,
      setDAOAddress
    } = await createDAO();

    setNSAddress = setDAOAddress;
    nameService = ns;
    avatar = av;
    genericCall = gc;
    controller = ctrl;
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    fixedStakingMockFactory = await ethers.getContractFactory(
      "StakingMockFixedAPY"
    );
  });

  const fixture_1year = async (wallets, provider) => {
    const staking: StakingMockFixedAPY = (await waffle.deployContract(
      provider.getWallets()[0],
      StakingABI,
      [INTEREST_RATE_5APY_X64]
    )) as StakingMockFixedAPY;

    await stake(staker1, 10000, 100, staking);
    await stake(staker2, 10000, 50, staking);
    await stake(staker3, 10000, 0, staking);

    await advanceBlocks(BLOCKS_ONE_YEAR);

    return { staking };
  };

  it("should set APY successfully", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);

    const beforeSetInterestRateIn128 = await staking.interestRatePerBlockX64();

    const interestRatePerBlockX64 = BN.from(INTEREST_RATE_10APY_X64); // x64 representation of same number
    const interestRateInt128Format = BN.from(INTEREST_RATE_10APY_128); // 128 representation of same number
    await staking.setAPY(interestRatePerBlockX64);

    const afterSetInterestRateIn128 = await staking.interestRatePerBlockX64();

    expect(afterSetInterestRateIn128).to.not.equal(beforeSetInterestRateIn128);
    expect(afterSetInterestRateIn128).to.equal(interestRateInt128Format);
  });

  it("should not allow to set APY with bad values?", async () => {
    // maybe we should add APY _interestRatePerBlock lower and upper limits?
  });

  xit("should update global stats after each operation stake/withdraw", async () => {
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
    const withdrawAmount1 = 50,
      withdrawAmount2 = 50;

    await fixedStaking
      .connect(staker1)
      .withdraw(staker1.address, withdrawAmount1);
    const info1 = await fixedStaking.stakersInfo(staker1.address);
    print(info1); // to be removed
    const statsAfterWithdraw1 = await fixedStaking.stats();
    print(statsAfterWithdraw1); // to be removed

    const principleBeforeWithdraw = await fixedStaking.getPrinciple(
      staker1.address
    );

    await fixedStaking
      .connect(staker1)
      .withdraw(staker1.address, withdrawAmount2);
    const info2 = await fixedStaking.stakersInfo(staker1.address);
    print(info2); // to be removed
    const statsAfterWithdraw2 = await fixedStaking.stats();
    print(statsAfterWithdraw2); // to be removed

    // lastUpdateBlock
    expect(
      statsAfterStake1.lastUpdateBlock.gt(statsBeforeStake1.lastUpdateBlock)
    );
    expect(
      statsAfterStake2.lastUpdateBlock.gt(statsAfterStake1.lastUpdateBlock)
    );
    expect(
      statsAfterWithdraw1.lastUpdateBlock.gt(statsAfterStake2.lastUpdateBlock)
    );
    expect(
      statsAfterWithdraw2.lastUpdateBlock.gt(
        statsAfterWithdraw1.lastUpdateBlock
      )
    );

    // totalStaked
    expect(
      statsAfterStake1.totalStaked.eq(
        statsBeforeStake1.totalStaked.add(stakeAmount1)
      )
    );
    expect(
      statsAfterStake2.totalStaked.eq(
        statsAfterStake1.totalStaked.add(stakeAmount2)
      )
    );
    expect(
      statsAfterWithdraw1.totalStaked.eq(
        statsAfterStake2.totalStaked.sub(withdrawAmount1)
      )
    );
    expect(
      statsAfterWithdraw2.totalStaked.eq(
        statsAfterWithdraw1.totalStaked.sub(withdrawAmount2)
      )
    );

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

  it("should compound principle over period with donation 100% and 50% and 0%", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    let principle = await staking.getPrinciple(staker1.address);
    expect(principle).to.equal(10000);
    principle = await staking.getPrinciple(staker2.address);
    expect(principle).to.equal(10250);
    principle = await staking.getPrinciple(staker3.address);
    expect(principle).to.equal(10500);

    let info = await staking.stakersInfo(staker1.address);

    const initialShares = (await staking.SHARE_DECIMALS()).mul(10000);
    expect(info.deposit).to.equal(10000);
    expect(info.shares).to.equal(initialShares); //amount * shareprecision / 1000 (initial share price)
    expect(info.rewardsPaid).to.equal(0);
    expect(info.avgDonationRatio).to.equal(
      (await staking.PRECISION()).mul(100)
    );

    info = await staking.stakersInfo(staker2.address);
    expect(info.deposit).to.equal(10000);
    expect(info.shares).to.equal(initialShares);
    expect(info.rewardsPaid).to.equal(0);
    expect(info.avgDonationRatio).to.equal((await staking.PRECISION()).mul(50));
  });

  it("should compound principle over 2 years with donation 100% and 50% and new staker after 1 year with 25%", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);

    //add staker with 25% donation after first year
    await stake(staker4, 125125, 25, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    //check all stakes after 2nd year
    let principle = await staking.getPrinciple(staker1.address);
    expect(principle).to.equal(10000);
    principle = await staking.getPrinciple(staker2.address);
    expect(principle).to.equal(10512); //10000*1.05*1.05 = 11025, rewards part = 1025, 50% of rewards is 512
    principle = await staking.getPrinciple(staker3.address);
    expect(principle).to.equal(11025); //10000*1.05*1.05 = 11025, rewards part = 1025, 50% of rewards is 512
    principle = await staking.getPrinciple(staker4.address);
    expect(principle).to.equal(129817);
  });

  it("should withdraw full amount", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const balance = await staking.getPrinciple(staker3.address);
    await staking.withdraw(staker3.address, balance);
    const info = await staking.stakersInfo(staker3.address);

    expect(balance).to.equal(10500); //initial stake 10000 + 5%
    expect(await staking.getPrinciple(staker3.address)).to.equal(0);
    expect(info.deposit).to.equal(0);
    expect(info.shares).to.equal(0);
    expect(info.rewardsPaid).to.equal(500);
    expect(info.avgDonationRatio).to.equal(0);
  });

  it("should withdraw full amount when donating", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const balance = await staking.getPrinciple(staker1.address);
    await staking.withdraw(staker1.address, balance);
    const info = await staking.stakersInfo(staker1.address);

    expect(balance).to.equal(10000);
    expect(await staking.getPrinciple(staker1.address)).to.equal(0);
    expect(info.deposit).to.equal(0);
    expect(info.shares).to.equal(0);
    expect(info.rewardsPaid).to.equal(0);
    expect(info.avgDonationRatio).to.equal(
      (await staking.PRECISION()).mul(100)
    );
  });

  it("should withdraw partial amount and calculate principle correctly after 1 year", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);

    await staking.withdraw(staker3.address, BN.from(9500)); // 10000 deposit + 500 rewards before. 1000 deposit after
    const balanceAfterWithdraw = await staking.getPrinciple(staker3.address);
    expect(balanceAfterWithdraw).to.equal(1000);

    await advanceBlocks(BLOCKS_ONE_YEAR);
    const info = await staking.stakersInfo(staker3.address);
    expect(await staking.getPrinciple(staker3.address)).to.equal(1050);
    expect(info.deposit).to.equal(1000);
    // expect(info.shares).to.equal(;
    expect(info.rewardsPaid).to.equal(500);
    expect(info.avgDonationRatio).to.equal(0);
  });

  it("should withdraw partial amount when donating and calculate principle correctly after 1 year", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const balanceBeforeWithdraw = await staking.getPrinciple(staker1.address);
    await staking.withdraw(staker1.address, BN.from(9500)); // 10000 deposit + 0 rewards before
    await advanceBlocks(BLOCKS_ONE_YEAR);
    const info = await staking.stakersInfo(staker1.address);

    expect(balanceBeforeWithdraw).to.equal(10000);
    expect(await staking.getPrinciple(staker1.address)).to.equal(500);
    expect(info.deposit).to.equal(500);
    expect(info.shares.toNumber()).to.be.greaterThan(0); // todo: calc in a more accurate way
    expect(info.rewardsPaid).to.equal(0);
    expect(info.avgDonationRatio).to.equal(
      (await staking.PRECISION()).mul(100)
    );
  });

  it("should withdraw rewards from rewards only", async () => {});

  it("should update avgDonationRatio after second stake", async () => {});
  it("should update avgDonationRatio after partial withdraw and then second stake", async () => {});

  it("should calculate correct share price and staking shares after principle has grown", async () => {});

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

  it("Should fail to withdraw exceeding amount", async () => {});

  it("Should not earn new rewards when withdrawing right after withdrawing or staking", async () => {});
});
