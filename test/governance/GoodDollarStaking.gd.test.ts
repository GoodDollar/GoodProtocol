import { default as hre, ethers, upgrades, waffle } from "hardhat";
import { Contract, Signer } from "ethers";
import { expect } from "chai";
import {
  GoodReserveCDai,
  GReputation,
  GoodDollarStaking,
  GovernanceStaking,
  GoodDollarMintBurnWrapper
} from "../../types";
import { createDAO, advanceBlocks, increaseTime } from "../helpers";
import { FormatTypes } from "ethers/lib/utils";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;
const DONATION_10_PERCENT = 10;
const DONATION_30_PERCENT = 30;
const STAKE_AMOUNT = 10000;
const BLOCKS_ONE_YEAR = 6307200;
// APY=5% | per block = nroot(1+0.05,numberOfBlocksPerYear) = 1000000007735630000
const INTEREST_RATE_5APY_X64 = BN.from("1000000007735630000"); // x64 representation of same number
const INTEREST_RATE_5APY_128 = BN.from("18446744216406738474"); // 128 representation of same number
// APY = 10% | nroot(1+0.10,numberOfBlocksPerYear) = 1000000015111330000
const INTEREST_RATE_10APY_X64 = BN.from("1000000015111330000"); // x64 representation of same number
const INTEREST_RATE_10APY_128 = BN.from("18446744352464388739"); // 128 representation of same number
const INITIAL_CAP = 100000000000; //1B G$s

describe("GoodDollarStaking - check fixed APY G$ rewards", () => {
  let dai: Contract;
  let cDAI: Contract;
  let goodReserve: GoodReserveCDai;
  let grep: GReputation;
  let avatar,
    goodDollar,
    controller,
    founder,
    schemeMock,
    signers,
    nameService,
    setDAOAddress,
    setSchemes,
    genericCall,
    runAsAvatarOnly,
    staker1,
    staker2;

  before(async () => {
    [founder, staker1, staker2, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      nameService: ns,
      setDAOAddress: sda,
      daiAddress,
      cdaiAddress,
      reserve,
      reputation,
      runAsAvatarOnly: ras,
      setSchemes: ss,
      genericCall: gc
    } = await createDAO();

    setSchemes = ss;
    runAsAvatarOnly = ras;
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    goodReserve = reserve as GoodReserveCDai;
    genericCall = gc;
    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar
    });

    grep = (await ethers.getContractAt("GReputation", reputation)) as GReputation;

    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();
  });

  async function stake(_staker, _amount, _givebackRatio, stakingContract) {
    await goodDollar.mint(_staker.address, _amount);
    await goodDollar.connect(_staker).approve(stakingContract.address, _amount);
    await stakingContract.connect(_staker).stake(_amount, _givebackRatio);
  }

  const fixture_staked1year = async (wallets, provider) => {
    const { staking, goodDollarMintBurnWrapper } = await fixture_ready(wallets, provider);

    await stake(staker1, STAKE_AMOUNT, DONATION_30_PERCENT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);

    return { staking, goodDollarMintBurnWrapper };
  };

  const fixture_ready = async (wallets, provider) => {
    const f = await ethers.getContractFactory("GoodDollarStakingMock");

    wallets = provider.getWallets();
    const staking = (await waffle.deployContract(
      wallets[0],
      {
        abi: JSON.parse(f.interface.format(FormatTypes.json) as string) as any[],
        bytecode: f.bytecode
      },
      [nameService.address, BN.from("1000000007735630000"), 518400 * 12, 30]
    )) as GoodDollarStaking;

    await staking.upgrade();

    await setDAOAddress("GDAO_STAKING", staking.address);

    const mintBurnWrapperFactory = await ethers.getContractFactory(
      "GoodDollarMintBurnWrapper"
    );
    let goodDollarMintBurnWrapper = (await upgrades.deployProxy(
      mintBurnWrapperFactory,
      [INITIAL_CAP, avatar, nameService.address],
      { kind: "uups" }
    )) as unknown as GoodDollarMintBurnWrapper;
    await setSchemes([goodDollarMintBurnWrapper.address]);
    await setDAOAddress("MintBurnWrapper", goodDollarMintBurnWrapper.address);

    await goodDollar.mint(founder.address, "100000000000"); //mint so that 30bps cap can mint some G$

    let encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData(
      "addMinter",
      [staking.address, INITIAL_CAP, INITIAL_CAP, 30, true]
    );

    const ictrl = await ethers.getContractAt("Controller", controller, schemeMock);

    await ictrl.genericCall(goodDollarMintBurnWrapper.address, encodedCall, avatar, 0);

    return { staking: staking.connect(staker1), goodDollarMintBurnWrapper };
  };

  const fixture_upgradeTest = async (wallets, provider) => {
    const f = await ethers.getContractFactory("GoodDollarStaking");
    const gf = await ethers.getContractFactory("GovernanceStaking");

    wallets = provider.getWallets();
    const staking = (await waffle.deployContract(
      wallets[0],
      {
        abi: JSON.parse(f.interface.format(FormatTypes.json) as string) as any[],
        bytecode: f.bytecode
      },
      [nameService.address, BN.from("1000000007735630000"), 518400 * 12, 30]
    )) as GoodDollarStaking;

    const govStaking = (await waffle.deployContract(
      wallets[0],
      {
        abi: JSON.parse(gf.interface.format(FormatTypes.json) as string) as any[],
        bytecode: gf.bytecode
      },
      [nameService.address]
    )) as GovernanceStaking;

    await setDAOAddress("GDAO_STAKING", govStaking.address);

    await setSchemes([staking.address]);

    return { staking, govStaking };
  };

  it("should update stakingrewardsfixedapy staker info and global stats when staking", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    const statsBefore = await staking.stats();
    const PRECISION = await staking.PRECISION();

    await stake(staker1, STAKE_AMOUNT, DONATION_30_PERCENT, staking);

    expect(await goodDollar.balanceOf(staking.address)).equal(STAKE_AMOUNT);
    const info = await staking.stakersInfo(staker1.address);
    expect(info.deposit).to.equal(STAKE_AMOUNT);
    expect(info.rewardsPaid).to.equal(0);
    expect(info.rewardsDonated).to.equal(0);
    expect(info.shares).to.equal((await staking.SHARE_DECIMALS()).mul(STAKE_AMOUNT));
    expect(info.avgDonationRatio).to.equal(
      (await staking.PRECISION()).mul(DONATION_30_PERCENT)
    );

    const stats = await staking.stats();
    expect(stats.lastUpdateBlock.gt(statsBefore.lastUpdateBlock));
    expect(stats.totalStaked).to.equal(STAKE_AMOUNT);
    expect(stats.totalShares.eq((await staking.SHARE_DECIMALS()).mul(STAKE_AMOUNT))).to.be
      .true;
    expect(stats.totalRewardsPaid).to.equal(0);
    expect(stats.totalRewardsDonated).to.equal(0);
    expect(stats.avgDonationRatio).to.equal(PRECISION.mul(DONATION_30_PERCENT));
    expect(stats.principle).to.equal(PRECISION.mul(STAKE_AMOUNT));
  });

  it("should withdraw only rewards when calling withdrawRewards", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    // collect 350 earned rewards: 10,000 * 5%APY = 500 total rewards, minus 30% donation
    await stake(staker1, STAKE_AMOUNT, DONATION_30_PERCENT, staking);
    expect(await goodDollar.balanceOf(staking.address)).equal(STAKE_AMOUNT);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    const infoBefore = await staking.stakersInfo(staker1.address);
    const principleBefore = await staking.getPrinciple(staker1.address);

    await staking.connect(staker1).withdrawRewards();

    const principleAfter = await staking.getPrinciple(staker1.address);
    const infoAfter = await staking.stakersInfo(staker1.address);
    expect(infoAfter.deposit).to.equal(infoBefore.deposit).to.equal(STAKE_AMOUNT);
    expect(await goodDollar.balanceOf(staker1.address)).equal(350);
    expect(infoAfter.rewardsPaid).to.equal(350);
    expect(infoAfter.rewardsDonated).to.equal(150);
    expect(principleAfter).to.equal(principleBefore.sub(350));
  });

  it("should withdraw from deposit and undo rewards if unable to mint rewards", async () => {
    const { staking, goodDollarMintBurnWrapper } = await waffle.loadFixture(
      fixture_ready
    );
    const PAUSE_ALL_ROLE = await goodDollarMintBurnWrapper.PAUSE_ALL_ROLE();
    expect(await goodDollarMintBurnWrapper.paused(PAUSE_ALL_ROLE)).to.be.false;

    // pause goodDollarMintBurnWrapper
    const encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData("pause", [
      PAUSE_ALL_ROLE
    ]);
    await genericCall(goodDollarMintBurnWrapper.address, encodedCall);
    expect(await goodDollarMintBurnWrapper.paused(PAUSE_ALL_ROLE)).to.be.true;

    await stake(staker1, STAKE_AMOUNT, DONATION_30_PERCENT, staking);
    expect(await goodDollar.balanceOf(staking.address)).equal(STAKE_AMOUNT);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    const principleBefore = await staking.getPrinciple(staker1.address);
    const infoBefore = await staking.stakersInfo(staker1.address);

    // withdraw so undo rewards will be called on rewards part
    await staking.withdrawStake(ethers.constants.MaxUint256);

    const principleAfter = await staking.getPrinciple(staker1.address);
    const infoAfter = await staking.stakersInfo(staker1.address);
    expect(await goodDollar.balanceOf(staker1.address)).to.eq(STAKE_AMOUNT); //we expect only the stake to have been withdrawn successfully, no rewards yet
    expect(principleBefore).to.equal(STAKE_AMOUNT + 350);
    expect(principleAfter).to.equal(350);
    expect(infoAfter.avgDonationRatio).to.equal(infoBefore.avgDonationRatio);
    expect(infoAfter.deposit).to.equal(0);
    expect(infoAfter.rewardsPaid).to.equal(0);
    expect(infoAfter.rewardsDonated).to.equal(0);
  });

  it("should withdraw rewards after mint rewards is enabled again", async () => {
    const { staking, goodDollarMintBurnWrapper } = await waffle.loadFixture(
      fixture_ready
    );
    const PAUSE_ALL_ROLE = await goodDollarMintBurnWrapper.PAUSE_ALL_ROLE();
    // pause goodDollarMintBurnWrapper
    let encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData("pause", [
      PAUSE_ALL_ROLE
    ]);
    await genericCall(goodDollarMintBurnWrapper.address, encodedCall);
    await stake(staker1, STAKE_AMOUNT, DONATION_30_PERCENT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    // withdraw so undo rewards will be called on rewards part
    await staking.withdrawStake(ethers.constants.MaxUint256);
    encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData("unpause", [
      PAUSE_ALL_ROLE
    ]);
    await genericCall(goodDollarMintBurnWrapper.address, encodedCall);
    expect(await goodDollarMintBurnWrapper.paused(PAUSE_ALL_ROLE)).to.be.false;

    expect(await goodDollar.balanceOf(staker1.address)).to.equal(STAKE_AMOUNT);
    await staking.withdrawRewards();

    const stakerInfo = await staking.stakersInfo(staker1.address);
    expect(await goodDollar.balanceOf(staker1.address)).to.equal(STAKE_AMOUNT + 350);
  });

  it("should not perform upgrade when not deadline", async () => {
    const { staking } = await waffle.loadFixture(fixture_upgradeTest);
    await expect(staking.upgrade()).to.revertedWith("deadline");
  });

  it("should perform upgrade after deadline", async () => {
    const { staking, govStaking } = await waffle.loadFixture(fixture_upgradeTest);

    const gdaoStakingBefore = await nameService.getAddress("GDAO_STAKING");

    await increaseTime(60 * 60 * 24 * 31); //pass > 30 days of
    await expect(staking.upgrade()).to.not.reverted;
    const ctrl = await ethers.getContractAt("Controller", controller);

    await expect(staking.upgrade()).to.reverted; //should not be able to call upgrade again

    //verify nameService address changed
    expect(gdaoStakingBefore).to.equal(govStaking.address);
    expect(await nameService.getAddress("GDAO_STAKING")).to.equal(staking.address);

    //verify no longer registered as scheme
    expect(await ctrl.isSchemeRegistered(staking.address, avatar)).to.be.false;

    //verify rewards have changed
    expect((await staking.getRewardsPerBlock())[0]).gt(0);
    expect(await govStaking.getRewardsPerBlock()).eq(0);
  });

  it("should change GD apy only by avatar", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    // before set, APY is 5%
    const beforeSetInterestRateIn128 = await staking.interestRatePerBlockX64();
    expect(beforeSetInterestRateIn128).to.equal(INTEREST_RATE_5APY_128);

    await runAsAvatarOnly(staking, "setGdApy(uint128)", INTEREST_RATE_10APY_X64);

    // after set, APY is 10%
    const afterSetInterestRateIn128 = await staking.interestRatePerBlockX64();
    expect(afterSetInterestRateIn128).to.equal(INTEREST_RATE_10APY_128);
  });

  it("should handle stakingrewardsfixed apy correctly when transfering staking tokens to new staker", async () => {
    const { staking } = await waffle.loadFixture(fixture_staked1year);

    const RECEIVER_STAKE = 100;
    await stake(staker2, RECEIVER_STAKE, DONATION_10_PERCENT, staking);
    expect(await staking.getPrinciple(staker1.address)).to.equal(STAKE_AMOUNT + 350); // 350 yearly earned reward
    expect(await staking.getPrinciple(staker2.address)).to.equal(RECEIVER_STAKE);

    await staking.transfer(staker2.address, 200);

    expect((await staking.stakersInfo(staker2.address)).avgDonationRatio).to.equal(
      (await staking.PRECISION()).mul(DONATION_10_PERCENT)
    ); // keep receiver avg donation ratio
    expect(await staking.getPrinciple(staker1.address)).to.equal(
      STAKE_AMOUNT + 350 - 200
    );
    expect(await staking.getPrinciple(staker2.address)).to.equal(RECEIVER_STAKE + 200);
    const senderInfo = await staking.stakersInfo(staker1.address);
    expect(senderInfo.rewardsPaid).to.equal(200);
    expect(senderInfo.rewardsDonated).to.equal(85); // (200 /(100% - 30% donation))
    expect(await goodDollar.balanceOf(staking.address)).to.equal(
      STAKE_AMOUNT + RECEIVER_STAKE
    ); // no withdrawals yet
  });
});
