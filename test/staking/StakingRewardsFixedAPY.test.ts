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

  // on withdraw: _amount / sharePrice = shares redeemed
  // on stake: _amount / sharePrice = shares added
  async function getExpectedSharesChange(_amount, _contract = fixedStaking) {
    return BN.from(_amount)
      .mul(await _contract.SHARE_PRECISION())
      .div(await _contract.sharePrice());
  }

  async function getSharesPercentage(_sharesAmount, _percent, _contract) {
    return BN.from(_sharesAmount).mul(_percent).div(100).div(await _contract.SHARE_DECIMALS());
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
  });

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
    const infoBefore = await staking.stakersInfo(staker3.address);

    //9500 withdraw / sharePrice = shares to reduce
    const expectedSharesRedeemed = await getExpectedSharesChange(9500, staking);
    await staking.withdraw(staker3.address, BN.from(9500));
    const balanceAfterWithdraw = await staking.getPrinciple(staker3.address);
    expect(balanceAfterWithdraw).to.equal(1000);

    await advanceBlocks(BLOCKS_ONE_YEAR);

    const info = await staking.stakersInfo(staker3.address);
    expect(await staking.getPrinciple(staker3.address)).to.equal(1050); //principle after 1000 + 1 year 5%
    expect(info.deposit).to.equal(1000); // 10000 original deposit + 500 rewards before. 1000 principle after

    //check shares
    expect(info.shares).to.equal(infoBefore.shares.sub(expectedSharesRedeemed));
    expect(
      info.shares
        .mul(await staking.sharePrice())
        .div(await staking.SHARE_PRECISION())
    ).to.equal(await staking.getPrinciple(staker3.address));

    expect(info.rewardsPaid).to.equal(500);
    expect(info.avgDonationRatio).to.equal(0);
  });

  it("should withdraw partial amount when donating and calculate principle correctly after 1 year", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const infoBefore = await staking.stakersInfo(staker1.address);
    // const expectedSharesRedeemed = await getExpectedSharesChange(9500, staking);

    await staking.withdraw(staker1.address, BN.from(9500)); // 10000 deposit + 0 rewards before
    const balanceAfterWithdraw = await staking.getPrinciple(staker1.address);
    expect(balanceAfterWithdraw).to.equal(500);

    await advanceBlocks(BLOCKS_ONE_YEAR);
    const info = await staking.stakersInfo(staker1.address);

    expect(await staking.getPrinciple(staker1.address)).to.equal(500);
    expect(info.deposit).to.equal(500);
    // console.log("info.shares.toNumber() %s, infoBefore.shares %s expectedSharesRedeemed %s",
    //   info.shares.toNumber(), infoBefore.shares, expectedSharesRedeemed)
    // expect(info.shares.toNumber()).to.equal(infoBefore.shares.sub(expectedSharesRedeemed));
    expect(info.rewardsPaid).to.equal(0);
    expect(info.avgDonationRatio).to.equal(
      (await staking.PRECISION()).mul(100)
    );
  });

  it("should withdraw rewards from rewards only", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const infoBefore = await staking.stakersInfo(staker3.address);
    const balance = await staking.getPrinciple(staker3.address);

    const expectedSharesRedeemed = await getExpectedSharesChange(500, staking);
    await staking.withdraw(staker3.address, 500);
    const info = await staking.stakersInfo(staker3.address);

    expect(balance).to.equal(10500); //initial stake 10000 + 5%
    expect(await staking.getPrinciple(staker3.address)).to.equal(10000);
    expect(info.deposit).to.equal(10000);
    expect(info.shares.toNumber()).to.equal(infoBefore.shares.sub(expectedSharesRedeemed));
    expect(info.rewardsPaid).to.equal(500);
    expect(info.avgDonationRatio).to.equal(0);
  });

  it("should update avgDonationRatio after second stake", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const infoBefore = await staking.stakersInfo(staker1.address);
    const statsBefore = await staking.stats();

    await staking.stake(
      staker1.address,
      BN.from(infoBefore.shares) // staker1 buys same amount of shares he had
        .mul(await staking.sharePrice())
        .div(await staking.SHARE_PRECISION()),
      0);

    const infoAfter = await staking.stakersInfo(staker1.address);
    const statsAfter = await staking.stats();
    const PRECISION = await staking.PRECISION()

    expect(infoBefore.avgDonationRatio).to.equal(PRECISION.mul(100)); // 1st stake had 100% donation
    expect(infoAfter.avgDonationRatio).to.equal(PRECISION.mul(50)); // 2nd stake had 0% for same amount of shares => 50% average
    expect(statsBefore.avgDonationRatio).to.equal(PRECISION.mul(50)); // total avg of 3 stakers => 0, 50, 100 each had staked 10000
    expect(statsAfter.avgDonationRatio).to.equal(PRECISION.mul(375).div(10)); // 37.5% = (2 * 0% + 1 * 50% + 1 * 100%) / 4 
  });

  // it("should update avgDonationRatio after partial withdraw and then second stake", async () => { // todo: same test with donations
  //   const { staking } = await waffle.loadFixture(fixture_1year);
  //   const infoBeforeWithdraw = await staking.stakersInfo(staker1.address);
  //   const statsBeforeWithdraw = await staking.stats();
  //   print(infoBeforeWithdraw)
  //   print(statsBeforeWithdraw)

  //   await staking.withdraw(staker1.address,
  //     await getSharesPercentage(statsBeforeWithdraw.totalShares, 10, staking)); // with

  //   const infoAfterWithdraw = await staking.stakersInfo(staker1.address);
  //   print(infoAfterWithdraw)
  //   const statsAfterWithdraw = await staking.stats();
  //   print(statsAfterWithdraw)

  // });

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
