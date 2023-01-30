import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { createDAO, advanceBlocks } from "../helpers";
import { StakingMockFixedAPY } from "../../types";
import { default as StakingABI } from "../../artifacts/contracts/mocks/StakingMockFixedAPY.sol/StakingMockFixedAPY.json";
const BN = ethers.BigNumber;

// APY=5% | Blocks per year = 12*60*24*365 = 6307200
// per block = nroot(1+0.05,numberOfBlocksPerYear) = 1000000007735630000
const BLOCKS_ONE_YEAR = 6307200;
const BLOCKS_FOUR_YEARS = 25228800;
const BLOCKS_TEN_YEARS = 63072000;
const INTEREST_RATE_5APY_X64 = BN.from("1000000007735630000"); // x64 representation of same number
const INTEREST_RATE_5APY_128 = BN.from("18446744216406738474"); // 128 representation of same number
// APY = 10% | nroot(1+0.10,numberOfBlocksPerYear) = 1000000015111330000
const INTEREST_RATE_10APY_X64 = BN.from("1000000015111330000"); // x64 representation of same number
const INTEREST_RATE_10APY_128 = BN.from("18446744352464388739"); // 128 representation of same number
// APY = 8% | nroot(1+0.08,numberOfBlocksPerYear) = 1000000012202093100
const INTEREST_RATE_8APY_X64 = BN.from("1000000012202093100"); // x64 representation of same number

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

  async function stake(_staker, _amount, contract = fixedStaking) {
    await contract.connect(_staker).stake(_staker.address, _amount);
  }

  // on withdraw: _amount / sharePrice = shares redeemed
  // on stake: _amount / sharePrice = shares added
  async function getExpectedSharesChange(_amount, _contract = fixedStaking) {
    return BN.from(_amount)
      .mul(await _contract.SHARE_PRECISION())
      .div(await _contract.sharePrice());
  }

  async function expectSavings(_staker, _amount, _contract = fixedStaking) {
    const savings = await _contract.getSavings(_staker.address);
    expect(savings.eq(_amount)).to.be.true;
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
    } = await loadFixture(createDAO);

    setNSAddress = setDAOAddress;
    nameService = ns;
    avatar = av;
    genericCall = gc;
    controller = ctrl;
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
  });

  const fixture_initOnly = async (wallets, provider) => {
    const staking: StakingMockFixedAPY = (await waffle.deployContract(
      provider.getWallets()[0],
      StakingABI,
      [INTEREST_RATE_5APY_X64]
    )) as StakingMockFixedAPY;

    return { staking };
  };

  const fixture_2 = async (wallets, provider) => {
    const staking: StakingMockFixedAPY = (await waffle.deployContract(
      provider.getWallets()[0],
      StakingABI,
      [INTEREST_RATE_5APY_X64]
    )) as StakingMockFixedAPY;

    return { staking };
  };

  const fixture_1year = async (wallets, provider) => {
    const staking: StakingMockFixedAPY = (await waffle.deployContract(
      provider.getWallets()[0],
      StakingABI,
      [INTEREST_RATE_5APY_X64]
    )) as StakingMockFixedAPY;

    await stake(staker1, 10000, staking);
    await stake(staker2, 10000, staking);
    await stake(staker3, 10000, staking);

    await advanceBlocks(BLOCKS_ONE_YEAR);
    return { staking };
  };

  const fixture_1year_single = async (wallets, provider) => {
    const staking: StakingMockFixedAPY = (await waffle.deployContract(
      provider.getWallets()[0],
      StakingABI,
      [INTEREST_RATE_5APY_X64]
    )) as StakingMockFixedAPY;

    await stake(staker3, 10000, staking);

    await advanceBlocks(BLOCKS_ONE_YEAR);
    return { staking };
  };

  it("should set APY successfully", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);

    const beforeSetInterestRateIn128 = await staking.interestRatePerBlockX64();

    const interestRatePerBlockX64 = BN.from(INTEREST_RATE_10APY_X64); // x64 representation of same number
    const interestRateInt128Format = BN.from(INTEREST_RATE_10APY_128); // 128 representation of same number
    await staking.setAPY(interestRatePerBlockX64);

    const afterSetInterestRateIn128 = await staking.interestRatePerBlockX64();

    expect(afterSetInterestRateIn128).to.not.equal(beforeSetInterestRateIn128);
    expect(afterSetInterestRateIn128).to.equal(interestRateInt128Format);
  });

  it("should update staker info after stake operation", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);

    await stake(staker1, 9000, staking);

    let info = await staking.stakersInfo(staker1.address);
    const initialShares = (await staking.SHARE_DECIMALS()).mul(9000);
    expect(info.lastSharePrice)
      .to.equal(
        (await staking.SHARE_PRECISION()).div(await staking.SHARE_DECIMALS())
      )
      .to.eq(await staking.sharePrice()); // (1g$ with 2 decimals)
    expect(await staking.sharesSupply())
      .to.equal(initialShares)
      .to.equal(await staking.totalSupply());
    expect(await staking.sharesOf(staker1.address))
      .eq(initialShares)
      .eq(await staking.balanceOf(staker1.address));
    expect(info.rewardsPaid).to.equal(0);
  });

  it("should handle stake/withdraw the minimal amount of 1", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);

    await stake(staker4, 1, staking);

    await advanceBlocks(BLOCKS_TEN_YEARS);
    await advanceBlocks(BLOCKS_FOUR_YEARS);

    await expectSavings(staker4, 1, staking); // (1.01^14) = 1.979931
    // await expect((await staking.sharePrice()).eq(BN.from(1979931))).to.be.true;

    await advanceBlocks(BLOCKS_ONE_YEAR);

    await expectSavings(staker4, 2, staking); // (1.01^15) = 2.078928
    await expect((await staking.sharePrice()).eq(207892821613185)).to.be.true;

    const minimalShares = await staking.amountToShares(1);
    const stakerInfo = await staking.stakersInfo(staker4.address);
    console.log({
      sharePrice: await staking.sharePrice(),
      minimalShares,
      stakerInfo,
      stakerShares: await staking.balanceOf(staker4.address)
    });
    await staking.withdraw(staker4.address, minimalShares); //this also withdraws the donated rewards

    let info = await staking.stakersInfo(staker4.address);
    await expectSavings(staker4, 1, staking);
    expect(info.rewardsPaid).to.equal(1);
    expect(await staking.balanceOf(staker4.address)).to.equal(
      10000 - minimalShares.toNumber()
    );

    await expect(
      staking.withdraw(
        staker4.address,
        (await staking.amountToShares(1)).sub(1)
      )
    ).revertedWith("min shares");
  });

  it("should fail on staking 0", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);
    await expect(stake(staker4, 0, staking)).to.be.revertedWith("stake 0");
  });

  xit("should fail on staking with donationRatio > 100", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);
    await expect(stake(staker4, 1, 101, staking)).to.be.revertedWith(
      "donation"
    );
  });

  it("should fail on staking less than minimal amount of 1", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);
    await expect(stake(staker4, 0.99, staking)).to.be.reverted;
  });

  it("Should fail to withdraw exceeding amount", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);
    await stake(staker1, 1000, staking);

    const shares = await staking.balanceOf(staker1.address);
    await expect(staking.withdraw(staker1.address, shares.add(1))).revertedWith(
      "no balance"
    );
  });

  it("Should fail to withdraw when empty balance", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);

    await expect(staking.withdraw(staker1.address, 0)).revertedWith(
      "no balance"
    );
  });

  it("should update global stats after stake operation", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);
    const statsBefore = await staking.stats();
    const PRECISION = await staking.PRECISION();

    await stake(staker1, 9000, staking);

    const statsAfter = await staking.stats();
    expect(statsAfter.lastUpdateBlock.gt(statsBefore.lastUpdateBlock));
    expect(statsAfter.totalStaked).to.equal(9000);
    expect(await staking.sharesSupply()).eq(
      (await staking.SHARE_DECIMALS()).mul(9000)
    );
    expect(statsAfter.totalRewardsPaid).to.equal(0);
    expect(statsAfter.savings).to.equal(PRECISION.mul(9000));
  });

  it("should update staker info after withdraw operation", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);
    await stake(staker1, 9000, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);

    const sharesToWithdraw = await staking.amountToShares(4000);
    const rewardsBalanceBefore = await staking.earned(staker1.address);
    expect(rewardsBalanceBefore).eq(450);
    await staking.withdraw(staker1.address, sharesToWithdraw);

    let info = await staking.stakersInfo(staker1.address);

    const initialShares = (await staking.SHARE_DECIMALS()).mul(9000);
    const shares = await staking.sharesOf(staker1.address);
    const savings = await staking.getSavings(staker1.address);
    const rewardsBalance = await staking.earned(staker1.address);
    const depositShareAfterWithdraw = info.lastSharePrice
      .mul(shares)
      .div(await staking.SHARE_PRECISION());

    expect(savings).to.eq(5450); // 9000 deposit + 450 rewards - 4000 withdrawn
    expect(rewardsBalance).to.eq(0); // 449 - 190
    expect(shares).to.equal(initialShares.sub(sharesToWithdraw));
    expect(info.rewardsPaid).to.equal(450); //relative amount of withdraw from total savings multiplied by rewards earned 4000/9450 * 450 and rounded up

    await staking.withdraw(staker1.address, shares); //now withdraw everything
    info = await staking.stakersInfo(staker1.address);
    expect(await staking.sharesOf(staker1.address)).eq(0);
    expect(info.rewardsPaid).to.equal(450);
  });

  it("should update global stats after withdraw operation", async () => {
    const { staking } = await waffle.loadFixture(fixture_initOnly);
    await stake(staker1, 9000, staking);
    const statsBefore = await staking.stats();
    await advanceBlocks(BLOCKS_ONE_YEAR);

    const sharesToWithdraw = await staking.amountToShares(4000);
    await staking.withdraw(staker1.address, sharesToWithdraw);

    const statsAfter = await staking.stats();
    const initialShares = (await staking.SHARE_DECIMALS()).mul(9000);
    expect(statsAfter.lastUpdateBlock.gt(statsBefore.lastUpdateBlock));
    expect(statsAfter.totalStaked).to.equal(9000 - 4000 + 450); // 9000 - (4000 - 190 rewards component withdrawn)
    expect(await staking.sharesSupply()).to.equal(
      initialShares.sub(sharesToWithdraw)
    );
    expect(statsAfter.totalRewardsPaid).to.equal(450);
    expect(statsAfter.savings).to.equal(await staking.compoundNextBlock());
  });

  it("should compound savings over period", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    console.log(
      "shares:",
      await staking.balanceOf(staker1.address),
      await staking.balanceOf(staker2.address),
      await staking.balanceOf(staker3.address),
      "info:",
      await staking.stakersInfo(staker1.address),
      await staking.stakersInfo(staker2.address),
      await staking.stakersInfo(staker3.address)
    );
    let savings = await staking.getSavings(staker1.address);
    expect(savings).to.equal(10500);
    savings = await staking.getSavings(staker2.address);
    expect(savings).to.equal(10500);
    savings = await staking.getSavings(staker3.address);
    expect(savings).to.equal(10499); //bought in 2 blocks after

    let info = await staking.stakersInfo(staker1.address);
    const initialShares = (await staking.SHARE_DECIMALS()).mul(10000);
    expect(await staking.principle(staker1.address)).to.equal(10000);
    expect(await staking.balanceOf(staker1.address)).to.equal(initialShares);

    info = await staking.stakersInfo(staker2.address);
    expect(await staking.principle(staker2.address)).to.equal(9999);
    expect(await staking.balanceOf(staker2.address)).to.equal(99999999);
    expect(info.rewardsPaid).to.equal(0);

    info = await staking.stakersInfo(staker3.address);
    expect(await staking.principle(staker3.address)).to.equal(9999);
    expect(await staking.balanceOf(staker3.address)).to.equal(99999998);
    expect(info.rewardsPaid).to.equal(0);
  });

  it("should compound savings over 2 years and new staker after 1 year", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);

    //add staker after first year
    await stake(staker4, 125125, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    //check all stakes after 2nd year
    let savings = await staking.getSavings(staker1.address);
    expect(savings).to.equal(11025);
    savings = await staking.getSavings(staker2.address);
    expect(savings).to.equal(11025);
    savings = await staking.getSavings(staker3.address);
    expect(savings).to.equal(11025);
    savings = await staking.getSavings(staker4.address);
    expect(savings).to.equal(131381);
  });

  it("should withdraw full amount", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const balance = await staking.sharesOf(staker1.address);
    await staking.withdraw(staker1.address, balance);
    const info = await staking.stakersInfo(staker1.address);

    expect(await staking.getSavings(staker1.address)).to.equal(0);
    expect(await staking.balanceOf(staker1.address)).to.equal(0);
    expect(info.rewardsPaid).to.equal(500);
  });

  it("should withdraw partial amount and calculate savings correctly after 1 year", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const sharesBefore = await staking.sharesOf(staker3.address);
    //9500 withdraw / sharePrice = shares to reduce
    const expectedSharesRedeemed = await staking.amountToShares(9500);
    await staking.withdraw(staker3.address, expectedSharesRedeemed);

    const balanceAfterWithdraw = await staking.getSavings(staker3.address);
    expect(balanceAfterWithdraw).to.equal(999); //shares are not exactly 9500
    expect((await staking.stakersInfo(staker3.address)).rewardsPaid).to.eq(500);
    await advanceBlocks(BLOCKS_ONE_YEAR);

    const info = await staking.stakersInfo(staker3.address);
    const earnedRewards = await staking.earned(staker3.address);
    expect(await staking.getSavings(staker3.address)).to.equal(1049); //savings after 999 + 1 year 5%
    expect(earnedRewards).to.equal(50);

    //check shares
    expect(await staking.sharesOf(staker3.address)).to.equal(
      sharesBefore.sub(expectedSharesRedeemed)
    );
  });

  xit("should withdraw partial amount when partially donating and calculate savings correctly after 1 year", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const infoBefore = await staking.stakersInfo(staker2.address);
    const expectedSharesRedeemed = await getExpectedSharesChange(
      9500 + 125,
      staking
    ); //withdrawing 9500 but 125 donated rewards will be withdrawn also

    await staking.withdraw(staker2.address, BN.from(9500)); // will withdraw 9500 from savings but also  125 donated rewards, 375 will be withdrawn from the rewards part.

    const balanceAfterWithdraw = await staking.getSavings(staker2.address);
    expect(balanceAfterWithdraw).to.equal(875); //10500 - 9500 + 125 donated

    await advanceBlocks(BLOCKS_ONE_YEAR);

    const info = await staking.stakersInfo(staker2.address);
    const [earnedRewards, earnedRewardsAfterDonations] = await staking.earned(
      staker2.address
    );
    expect(await staking.getSavings(staker2.address)).to.equal(
      907 //918 after 1 year. rewards part 43, donated 43*0.25=10.75 = 918-10.75
    ); // 875 + 5%APY * 25%donation
    expect(info.deposit).to.equal(875);
    expect(info.rewardsPaid).to.equal(375);
    expect(info.rewardsDonated).to.equal(125);
    expect(info.avgDonationRatio).to.equal((await staking.PRECISION()).mul(25));
    expect(info.shares.toNumber()).to.equal(
      infoBefore.shares.sub(expectedSharesRedeemed)
    );
    expect(
      info.shares
        .mul(await staking.sharePrice())
        .div(await staking.SHARE_PRECISION())
    ).to.equal(info.deposit.add(earnedRewards));
    expect(await staking.getSavings(staker2.address)).to.equal(
      info.deposit.add(earnedRewardsAfterDonations)
    );
  });

  xit("should withdraw partial amount when donating 100% and calculate savings correctly after 1 year", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const infoBefore = await staking.stakersInfo(staker1.address);
    const expectedSharesRedeemed = await getExpectedSharesChange(
      9500 + 500,
      staking
    ); //withdrawing 9500 but 500 donated rewards will be withdrawn also

    await staking.withdraw(staker1.address, BN.from(9500)); // this will withdraw 9500 from deposit but also 500 donated rewards

    const balanceAfterWithdraw = await staking.getSavings(staker1.address);
    expect(balanceAfterWithdraw).to.equal(500);

    await advanceBlocks(BLOCKS_ONE_YEAR);

    const info = await staking.stakersInfo(staker1.address);
    const [earnedRewards, earnedRewardsAfterDonations] = await staking.earned(
      staker1.address
    );
    expect(await staking.getSavings(staker1.address)).to.equal(500);
    expect(info.deposit).to.equal(500);
    expect(info.rewardsPaid).to.equal(0);
    expect(info.rewardsDonated).to.equal(500);
    expect(info.avgDonationRatio).to.equal(
      (await staking.PRECISION()).mul(100)
    );
    expect(info.shares.toNumber()).to.equal(
      infoBefore.shares.sub(expectedSharesRedeemed)
    );
    expect(
      info.shares
        .mul(await staking.sharePrice())
        .div(await staking.SHARE_PRECISION())
    ).to.equal(info.deposit.add(earnedRewards));
    expect(await staking.getSavings(staker1.address)).to.equal(
      info.deposit.add(earnedRewardsAfterDonations)
    );
  });

  xit("should withdraw rewards from rewards only", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const infoBefore = await staking.stakersInfo(staker3.address);
    const balance = await staking.getSavings(staker3.address);

    const expectedSharesRedeemed = await getExpectedSharesChange(500, staking);
    await staking.withdraw(staker3.address, 500);
    const info = await staking.stakersInfo(staker3.address);

    expect(balance).to.equal(10500); //initial stake 10000 + 5%
    expect(await staking.getSavings(staker3.address)).to.equal(10000);
    expect(info.deposit).to.equal(10000);
    expect(info.shares.toNumber()).to.equal(
      infoBefore.shares.sub(expectedSharesRedeemed)
    );
    expect(info.rewardsPaid).to.equal(500);
    expect(info.rewardsDonated).to.equal(0);
    expect(info.avgDonationRatio).to.equal(0);
  });

  xit("should update avgDonationRatio after second stake", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const infoBefore = await staking.stakersInfo(staker1.address);
    const statsBefore = await staking.stats();

    await staking.stake(
      staker1.address,
      BN.from(infoBefore.shares) // staker1 buys same amount of shares he had
        .mul(await staking.sharePrice())
        .div(await staking.SHARE_PRECISION()),
      0
    );

    const infoAfter = await staking.stakersInfo(staker1.address);
    const statsAfter = await staking.stats();
    const PRECISION = await staking.PRECISION();

    expect(infoBefore.avgDonationRatio).to.equal(PRECISION.mul(100)); // 1st stake had 100% donation
    expect(infoAfter.avgDonationRatio).to.equal(PRECISION.mul(50)); // 2nd stake had 0% for same amount of shares => 50% average
    expect(statsBefore.avgDonationRatio).to.equal(PRECISION.mul(125).div(3)); // total avg of 3 stakers => 0, 25, 100 each had staked 10000
    expect(statsAfter.avgDonationRatio).to.equal(
      BN.from("31249999999999999999")
    ); // 31.25% = (2 * 0% + 1 * 25% + 1 * 100%) / 4
  });

  xit("should update avgDonationRatio after partial withdraw", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const infoBeforeWithdraw = await staking.stakersInfo(staker1.address);
    const statsBeforeWithdraw = await staking.stats();
    const expectedSharesRedeemed = await getExpectedSharesChange(
      2000 + 500,
      staking
    ); //2000 + 500 that are donated
    await staking.withdraw(staker1.address, 2000); //this also withdraws the donated rewards
    const statsAfterWithdraw = await staking.stats();

    const expectedGlobalAvgRatio = statsBeforeWithdraw.avgDonationRatio
      .mul(statsBeforeWithdraw.totalShares)
      .sub(expectedSharesRedeemed.mul(infoBeforeWithdraw.avgDonationRatio))
      .div(statsAfterWithdraw.totalShares);

    const infoAfterWithdraw = await staking.stakersInfo(staker1.address);
    expect(infoBeforeWithdraw.avgDonationRatio).to.equal(
      infoAfterWithdraw.avgDonationRatio
    );

    expect(expectedGlobalAvgRatio).to.equal(
      statsAfterWithdraw.avgDonationRatio
    );
  });

  it("should calculate correct share price after savings has grown", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const SHARE_PRECISION = await staking.SHARE_PRECISION();

    const savingsBefore = await staking.compound();
    const expectedSharePriceBefore = BN.from(savingsBefore)
      .mul(SHARE_PRECISION)
      .div(await staking.PRECISION())
      .div(await staking.sharesSupply());
    const actualSharePriceBefore = await staking.sharePrice();
    expect(actualSharePriceBefore).to.equal(expectedSharePriceBefore);

    await advanceBlocks(BLOCKS_ONE_YEAR);

    const savingsAfter = savingsBefore.mul(105).div(100); //estimate
    const expectedSharePriceAfter = BN.from(savingsAfter)
      .mul(SHARE_PRECISION)
      .div(await staking.PRECISION())
      .div(await staking.sharesSupply());
    const actualSharePriceAfter = await staking.sharePrice();
    expect(actualSharePriceAfter.div(1e8)).to.eq(
      expectedSharePriceAfter.div(1e8)
    ); //compare rough estimate so we reduce precision by 1e8
  });

  it("should check compound function compounds savings correctly", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const PRECISION = await staking.PRECISION();

    const expectedCompoundBefore = 3 * 10000 * 1.05; // 3 stakers of 10000 with 5 APY, after one year
    const actualCompoundBefore = (await staking.compound()).div(PRECISION);
    expect(actualCompoundBefore).to.equal(expectedCompoundBefore);

    await advanceBlocks(BLOCKS_ONE_YEAR);

    const expectedCompoundAfter = expectedCompoundBefore * 1.05;
    const actualCompoundAfter = (await staking.compound()).div(PRECISION);
    expect(actualCompoundAfter).to.equal(expectedCompoundAfter);
    expect(actualCompoundAfter.gt(actualCompoundBefore)).to.be.true;
  });

  it("should calculate earned rewards in period", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    let earnedRewards1 = await staking.earned(staker1.address);
    let earnedRewards2 = await staking.earned(staker2.address);
    let earnedRewards3 = await staking.earned(staker3.address);

    expect(earnedRewards1).equal(earnedRewards2).equal(500);
    expect(earnedRewards3).eq(499);

    await advanceBlocks(BLOCKS_ONE_YEAR);
    earnedRewards1 = await staking.earned(staker1.address);
    earnedRewards2 = await staking.earned(staker2.address);
    earnedRewards3 = await staking.earned(staker3.address);

    expect(earnedRewards1)
      .equal(earnedRewards2)
      .equal(earnedRewards3)
      .equal(1025);
  });

  it("Should undo reward part and update staker info", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);

    const initialInfo = await staking.stakersInfo(staker3.address);
    const sharesToWithdraw = await staking.amountToShares(500);
    const initialRewards = await staking.earned(staker3.address);
    await staking.withdrawAndUndo(staker3.address, sharesToWithdraw);

    const infoAfterUndo = await staking.stakersInfo(staker3.address);

    expect(await staking.getSavings(staker3.address)).to.equal(10499);

    expect(await staking.earned(staker3.address)).to.eq(500);
    expect(infoAfterUndo.rewardsPaid).to.equal(initialInfo.rewardsPaid);
  });

  it("Should undo reward and keep global stats the same", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);

    const initialStats = await staking.stats();

    const initialSavings = await staking.compoundNextBlock(); //withdrawAndUndo will calculate savings of next block
    const sharesToWithdraw = await staking.amountToShares(500);
    const initialShares = await staking.sharesSupply();
    await staking.withdrawAndUndo(staker3.address, sharesToWithdraw);
    const statsAfterUndo = await staking.stats();

    expect(statsAfterUndo.savings.div(ethers.constants.WeiPerEther)).to.equal(
      31500
    );

    expect(initialStats.totalRewardsPaid).to.equal(
      statsAfterUndo.totalRewardsPaid
    );

    expect(await staking.sharesSupply()).to.lt(initialShares);
    expect(initialStats.totalStaked).to.equal(statsAfterUndo.totalStaked);
  });

  xit("Should undo reward when part of them is donated and keep info and global stats the same", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);

    const initialStats = await staking.stats();
    const initialInfo = await staking.stakersInfo(staker2.address);
    const initialSavings = await staking.getSavings(staker2.address);
    const latestSavings = await staking.compoundNextBlock(); //withdrawAndUndo will calculate savings of next block

    await staking.withdrawAndUndo(staker2.address, 375); //375 rewards 125 donated

    const infoAfterUndo = await staking.stakersInfo(staker2.address);
    expect(await staking.getSavings(staker2.address)).to.equal(initialSavings);
    expect(infoAfterUndo.rewardsPaid).to.equal(0);
    expect(infoAfterUndo.rewardsDonated).to.equal(0);

    expect(infoAfterUndo.avgDonationRatio).to.equal(
      initialInfo.avgDonationRatio
    );
    expect(initialInfo.shares).to.eq(infoAfterUndo.shares);

    //check global stats
    const statsAfterUndo = await staking.stats();

    expect(statsAfterUndo.savings).to.equal(latestSavings);

    expect(initialStats.totalRewardsDonated).to.equal(
      statsAfterUndo.totalRewardsDonated
    );
    expect(initialStats.totalRewardsPaid).to.equal(
      statsAfterUndo.totalRewardsPaid
    );
    expect(initialStats.totalShares).to.equal(statsAfterUndo.totalShares);
    expect(initialStats.totalStaked).to.equal(statsAfterUndo.totalStaked);
    expect(initialStats.avgDonationRatio).to.equal(
      statsAfterUndo.avgDonationRatio.add(1) //precision loss during withdraw avgDonationRatio calculation
    );
  });

  it("Should undo reward when withdrawing partial rewards keep info and global stats the same", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);

    const initialInfo = await staking.stakersInfo(staker2.address);
    const initialSavings = await staking.getSavings(staker2.address);
    const initialStats = await staking.stats();
    const initialTotalSavings = await staking.compoundNextBlock(); //withdrawAndUndo will calculate savings of next block
    const initialSharesSupply = await staking.sharesSupply();
    //current rewards are 500 so 250 is only partial withdraw of rewards
    const sharesToWithdraw = await staking.amountToShares(250);
    await staking.withdrawAndUndo(staker2.address, sharesToWithdraw);

    const infoAfterUndo = await staking.stakersInfo(staker2.address);
    expect(await staking.getSavings(staker2.address)).to.equal(initialSavings);
    expect(infoAfterUndo.rewardsPaid).to.equal(initialInfo.rewardsPaid);

    //check global stats
    const statsAfterUndo = await staking.stats();

    expect(statsAfterUndo.savings).to.equal(initialTotalSavings);

    expect(initialStats.totalRewardsDonated).to.equal(
      statsAfterUndo.totalRewardsDonated
    );
    expect(initialStats.totalRewardsPaid).to.equal(
      statsAfterUndo.totalRewardsPaid
    );
    expect(initialSharesSupply).to.equal((await staking.sharesSupply()).add(1)); //precision loss when converting back from rewards amount to shares
    expect(initialStats.totalStaked).to.equal(statsAfterUndo.totalStaked);
  });

  //helper test
  // it.only("Should not suffer from endless precission loss", async () => {
  //   const { staking } = await waffle.loadFixture(fixture_1year_single);

  //   const initialShares = await staking.sharesOf(staker3.address);
  //   const maxLoss = await staking.amountToShares(1);
  //   for (let i = 0; i < 500; i++) {
  //     expect(await staking.getSavings(staker3.address)).eq(10500);
  //     expect(await staking.sharesOf(staker3.address)).gte(
  //       initialShares.sub(maxLoss)
  //     );
  //     expect(await staking.earned(staker3.address)).eq(500);
  //     const sharesToWithdraw = await staking.amountToShares(500);
  //     await staking.withdrawAndUndo(staker3.address, sharesToWithdraw);
  //   }
  // });

  xit("Should undo reward when withdrawing rewards + deposit and update deposit info and stats correctly", async () => {});

  it("Should be able to withdraw right after staking", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    await stake(staker4, 10000, staking);
    await expect(
      staking.withdraw(
        staker4.address,
        await staking.balanceOf(staker4.address)
      )
    ).not.reverted;

    const info = await staking.stakersInfo(staker4.address);
    expect(await staking.getSavings(staker4.address)).to.equal(0);
    expect(info.rewardsPaid).to.equal(0);
    expect(info.lastSharePrice.div(1e8)).to.equal(
      (await staking.sharePrice()).div(1e8)
    );
  });

  it("should calculate savings correctly after set APY ", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    await stake(staker4, 125125, staking);

    // before set, APY is 5%
    const beforeSetInterestRateIn128 = await staking.interestRatePerBlockX64();
    expect(beforeSetInterestRateIn128).to.equal(INTEREST_RATE_5APY_128);

    // set APY to 10%
    await staking.setAPY(INTEREST_RATE_10APY_X64);
    await advanceBlocks(BLOCKS_ONE_YEAR);

    await expectSavings(staker1, 11550, staking);
    await expectSavings(staker2, 11550, staking);
    await expectSavings(staker3, 11550, staking); // 10000 + 10000((1.05APY1 * 1.10APY2) - 1)
    await expectSavings(staker4, 137637, staking); // 125125((1.10APY2) - 1)

    // set APY to 8%
    await staking.setAPY(INTEREST_RATE_8APY_X64);
    await advanceBlocks(BLOCKS_ONE_YEAR);

    await expectSavings(staker1, 12474, staking);
    await expectSavings(staker2, 12474, staking);
    await expectSavings(staker3, 12474, staking);
    await expectSavings(staker4, 148648, staking); // 125125((1.10APY2 * 1.08APY3) - 1)
  });

  it("should handle first stake big, followed by smaller actions", async () => {
    const { staking } = await waffle.loadFixture(fixture_2);

    await stake(staker4, 10000000, staking);

    const savingsAfterBigStake = await staking.getSavings(staker4.address);
    const infoAfterBigStake = await staking.stakersInfo(staker4.address);
    await stake(signers[0], 5, staking);

    const savingsAfterSmallStake = await staking.getSavings(staker4.address);
    const smallStakeSavings = await staking.getSavings(signers[0].address);
    expect(smallStakeSavings).gt(0);
    const sharesAfterBigStake = await staking.balanceOf(staker4.address);

    const sharesAfterSmallStake = await staking.balanceOf(signers[0].address);
    expect(savingsAfterSmallStake.eq(savingsAfterBigStake)).to.be.true;
    expect(sharesAfterSmallStake).gt(0);

    const onegdShares = await staking.amountToShares(1);
    await expect(staking.withdraw(staker4.address, 1000)).revertedWith("min");

    await expect(staking.withdraw(staker4.address, onegdShares)).not.reverted;
    await expect(
      staking.withdraw(
        signers[0].address,
        await staking.balanceOf(signers[0].address)
      )
    ).not.reverted;

    const sharesAfterWithdraw = await staking.balanceOf(staker4.address);
    const sharesAfterWithdraw2 = await staking.balanceOf(signers[0].address);

    expect(sharesAfterWithdraw).to.equal(sharesAfterBigStake.sub(onegdShares));
    expect(sharesAfterWithdraw2).to.equal(0);
  });

  it("should handle first stake small, followed by 100 Billion stake", async () => {
    const { staking } = await waffle.loadFixture(fixture_2);

    await stake(signers[0], 5, staking);
    await stake(staker4, 1e13, staking);

    const onegdShares = await staking.amountToShares(1);
    await staking.withdraw(staker4.address, onegdShares);

    await expect(
      staking.withdraw(
        signers[0].address,
        await staking.balanceOf(signers[0].address)
      )
    ).not.reverted;
  });

  it("should handle first 100 Billion stake, followed by a small", async () => {
    const { staking } = await waffle.loadFixture(fixture_2);

    await stake(staker4, 1e13, staking);
    await stake(signers[0], 5, staking);

    const onegdShares = await staking.amountToShares(1);
    await expect(
      staking.withdraw(
        signers[0].address,
        await staking.balanceOf(signers[0].address)
      )
    ).not.reverted;
    await expect(staking.withdraw(staker4.address, onegdShares)).not.reverted;
  });

  xit("should withdraw all when amount=max uint", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    await expect(staking.withdraw(staker3.address, 0)).revertedWith("balance");
    await staking.withdraw(staker3.address, ethers.constants.MaxUint256);
    const info = await staking.stakersInfo(staker3.address);

    expect(info.rewardsPaid).to.equal(499);
    expect(await staking.sharesOf(staker3.address)).to.equal(0);
    expect(await staking.getSavings(staker3.address)).to.equal(0);
  });

  it("should be able to get rewards debt (ie savings - deposits - donated rewards)", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    const debt = (await staking.getRewardsDebt()).div(
      ethers.utils.parseEther("1")
    ); //debt is in 1e18 precision
    expect(debt).to.equal(1500); //30000*1.05 - 300000
  });

  it("should not be able to stake less than share price", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    await advanceBlocks(BLOCKS_TEN_YEARS * 20);

    await expect(stake(staker1, 1, staking)).to.revertedWith("share");
    await expect(stake(staker1, 2, staking)).to.not.reverted;
  });

  it("should not be able to withdraw less than share price", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    await advanceBlocks(BLOCKS_TEN_YEARS * 10);

    const sharePrice = await staking.sharePrice();
    await expect(staking.withdraw(staker3.address, 1)).to.revertedWith("share");
  });

  it("should handle stake/withdraw for 1 Trillion staked for 50 years", async () => {
    const { staking } = await waffle.loadFixture(fixture_1year);
    await stake(staker3, 100000000000000, staking);
    await advanceBlocks(BLOCKS_TEN_YEARS * 5);

    await expect(
      staking.withdraw(
        staker3.address,
        await staking.balanceOf(staker3.address)
      )
    ).to.not.reverted;
  });

  it("should have undo reward handle invalid input", async () => {
    const staking: StakingMockFixedAPY = (await (
      await ethers.getContractFactory("StakingMockFixedAPY")
    ).deploy(INTEREST_RATE_5APY_X64)) as StakingMockFixedAPY;

    //undo 0 rewards
    await stake(staker4, 10000, staking);
    await staking.withdraw(
      staker4.address,
      await staking.balanceOf(staker4.address)
    );
    await expect(staking.undoReward(staker4.address, 0)).to.not.reverted;
  });
});
