import { default as hre, ethers, upgrades, waffle } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Contract, Signer } from "ethers";
import { expect } from "chai";
import {
  GoodReserveCDai,
  GReputation,
  GoodDollarStaking,
  GovernanceStaking,
  GoodDollarMintBurnWrapper,
  IGoodDollar
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
    goodDollar: IGoodDollar,
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
    } = await loadFixture(createDAO);

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

    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;

    goodDollar = (await ethers.getContractAt("IGoodDollar", gd)) as IGoodDollar;

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    // await goodReserve.setAddresses();
  });

  async function stake(_staker, _amount, stakingContract) {
    await goodDollar.mint(_staker.address, _amount);
    await goodDollar.connect(_staker).approve(stakingContract.address, _amount);
    await stakingContract.connect(_staker).stake(_amount);
  }

  const fixture_staked1year = async (wallets, provider) => {
    const { staking, goodDollarMintBurnWrapper } = await fixture_ready(
      wallets,
      provider
    );

    await stake(staker1, STAKE_AMOUNT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);

    return { staking, goodDollarMintBurnWrapper };
  };

  const fixture_ready = async (wallets, provider) => {
    const f = await ethers.getContractFactory("GoodDollarStakingMock");

    wallets = provider.getWallets();
    const staking = (await waffle.deployContract(
      wallets[0],
      {
        abi: JSON.parse(
          f.interface.format(FormatTypes.json) as string
        ) as any[],
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
      [avatar, nameService.address],
      { kind: "uups" }
    )) as unknown as GoodDollarMintBurnWrapper;
    await setSchemes([goodDollarMintBurnWrapper.address]);
    await setDAOAddress("MINTBURN_WRAPPER", goodDollarMintBurnWrapper.address);

    await goodDollar.mint(founder.address, "200000000000"); //mint so that 30bps cap can mint some G$

    let encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData(
      "addMinter",
      [staking.address, 0, 0, 30, 0, 0, 30, true]
    );

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(
      goodDollarMintBurnWrapper.address,
      encodedCall,
      avatar,
      0
    );

    return { staking: staking.connect(staker1), goodDollarMintBurnWrapper };
  };

  const fixture_upgradeTest = async (wallets, provider) => {
    const f = await ethers.getContractFactory("GoodDollarStaking");
    const gf = await ethers.getContractFactory("GovernanceStaking");

    wallets = provider.getWallets();
    const staking = (await waffle.deployContract(
      wallets[0],
      {
        abi: JSON.parse(
          f.interface.format(FormatTypes.json) as string
        ) as any[],
        bytecode: f.bytecode
      },
      [nameService.address, BN.from("1000000007735630000"), 518400 * 12, 30]
    )) as GoodDollarStaking;

    const govStaking = (await waffle.deployContract(
      wallets[0],
      {
        abi: JSON.parse(
          gf.interface.format(FormatTypes.json) as string
        ) as any[],
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

    await stake(staker1, STAKE_AMOUNT, staking);

    expect(await goodDollar.balanceOf(staking.address)).equal(STAKE_AMOUNT);
    const info = await staking.stakersInfo(staker1.address);
    expect(await staking.getSavings(staker1.address)).to.equal(STAKE_AMOUNT);
    expect(info.rewardsPaid).to.equal(0);
    expect(await staking.sharesOf(staker1.address)).to.equal(
      (await staking.SHARE_DECIMALS()).mul(STAKE_AMOUNT)
    );

    const stats = await staking.stats();
    expect(stats.lastUpdateBlock.gt(statsBefore.lastUpdateBlock));
    expect(stats.totalStaked).to.equal(STAKE_AMOUNT);
    expect(await staking.sharesSupply()).eq(
      (await staking.SHARE_DECIMALS()).mul(STAKE_AMOUNT)
    );
    expect(stats.totalRewardsPaid).to.equal(0);
    expect(stats.totalStaked).to.equal(STAKE_AMOUNT);
    expect(stats.savings).to.equal(PRECISION.mul(STAKE_AMOUNT));
  });

  it("should withdraw only rewards when calling withdrawRewards", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    // collect 350 earned rewards: 10,000 * 5%APY = 500 total rewards, minus 30% donation
    await stake(staker1, STAKE_AMOUNT, staking);
    expect(await goodDollar.balanceOf(staking.address)).equal(STAKE_AMOUNT);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    const stakeBefore = await staking.principle(staker1.address);
    const savingsBefore = await staking.getSavings(staker1.address);

    await staking.connect(staker1).withdrawRewards();

    const savingsAfter = await staking.getSavings(staker1.address);
    const infoAfter = await staking.stakersInfo(staker1.address);
    expect(await staking.principle(staker1.address))
      .to.equal(stakeBefore)
      .to.equal(STAKE_AMOUNT);
    expect(await goodDollar.balanceOf(staker1.address)).equal(500);
    expect(infoAfter.rewardsPaid).to.equal(500);
    expect(savingsAfter).to.equal(savingsBefore.sub(500));
    expect(await staking.earned(staker1.address)).eq(0);
  });

  it("should withdraw from deposit and undo rewards if unable to mint rewards", async () => {
    const { staking, goodDollarMintBurnWrapper } = await waffle.loadFixture(
      fixture_ready
    );
    const PAUSE_ALL_ROLE = await goodDollarMintBurnWrapper.PAUSE_ALL_ROLE();
    expect(await goodDollarMintBurnWrapper.paused(PAUSE_ALL_ROLE)).to.be.false;

    // pause goodDollarMintBurnWrapper
    const encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData(
      "pause",
      [PAUSE_ALL_ROLE]
    );
    await genericCall(goodDollarMintBurnWrapper.address, encodedCall);
    expect(await goodDollarMintBurnWrapper.paused(PAUSE_ALL_ROLE)).to.be.true;

    await stake(staker1, STAKE_AMOUNT, staking);
    expect(await goodDollar.balanceOf(staking.address)).equal(STAKE_AMOUNT);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    const savingsBefore = await staking.getSavings(staker1.address);
    const infoBefore = await staking.stakersInfo(staker1.address);

    // withdraw so undo rewards will be called on rewards part
    await staking.withdrawStake(await staking.sharesOf(staker1.address));

    const savingsAfter = await staking.getSavings(staker1.address);
    const infoAfter = await staking.stakersInfo(staker1.address);
    expect(await goodDollar.balanceOf(staker1.address)).to.eq(STAKE_AMOUNT); //we expect only the stake to have been withdrawn successfully, no rewards yet
    expect(savingsBefore).to.equal(STAKE_AMOUNT + 500);
    expect(savingsAfter).to.equal(500);
    expect(await staking.earned(staker1.address)).to.equal(500);
    expect(infoBefore.lastSharePrice).to.gt(0);
    expect(infoAfter.lastSharePrice).to.eq(0); //we have withdrawn all stake, so all shares are rewards (ie profit)
    expect(infoAfter.rewardsPaid).to.equal(0);
  });

  it("should withdraw rewards after mint rewards is enabled again", async () => {
    const { staking, goodDollarMintBurnWrapper } = await waffle.loadFixture(
      fixture_ready
    );
    const PAUSE_ALL_ROLE = await goodDollarMintBurnWrapper.PAUSE_ALL_ROLE();
    // pause goodDollarMintBurnWrapper
    let encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData(
      "pause",
      [PAUSE_ALL_ROLE]
    );
    await genericCall(goodDollarMintBurnWrapper.address, encodedCall);
    await stake(staker1, STAKE_AMOUNT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    // withdraw so undo rewards will be called on rewards part
    await staking.withdrawStake(await staking.sharesOf(staker1.address));
    encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData(
      "unpause",
      [PAUSE_ALL_ROLE]
    );
    await genericCall(goodDollarMintBurnWrapper.address, encodedCall);
    expect(await goodDollarMintBurnWrapper.paused(PAUSE_ALL_ROLE)).to.be.false;

    expect(await goodDollar.balanceOf(staker1.address)).to.equal(STAKE_AMOUNT);
    await staking.withdrawStake(await staking.sharesOf(staker1.address));

    const stakerInfo = await staking.stakersInfo(staker1.address);
    expect(await goodDollar.balanceOf(staker1.address)).to.equal(
      STAKE_AMOUNT + 500
    );
  });

  it("should have upgrade deadline < 60 days", async () => {
    const f = await ethers.getContractFactory("GoodDollarStaking");
    await expect(
      f.deploy(
        nameService.address,
        BN.from("1000000007735630000"),
        518400 * 12,
        61
      )
    ).revertedWith("max two");
  });

  it("should not perform upgrade when not deadline", async () => {
    const { staking } = await waffle.loadFixture(fixture_upgradeTest);
    await expect(staking.upgrade()).to.revertedWith("deadline");
  });

  it("should perform upgrade after deadline", async () => {
    const { staking, govStaking } = await waffle.loadFixture(
      fixture_upgradeTest
    );

    const gdaoStakingBefore = await nameService.getAddress("GDAO_STAKING");

    await increaseTime(60 * 60 * 24 * 31); //pass > 30 days of
    await expect(staking.upgrade()).to.not.reverted;
    const ctrl = await ethers.getContractAt("Controller", controller);

    await expect(staking.upgrade()).to.reverted; //should not be able to call upgrade again

    //verify nameService address changed
    expect(gdaoStakingBefore).to.equal(govStaking.address);
    expect(await nameService.getAddress("GDAO_STAKING")).to.equal(
      staking.address
    );

    //verify no longer registered as scheme
    expect(await ctrl.isSchemeRegistered(staking.address, avatar)).to.be.false;

    //verify rewards have changed
    expect((await staking.getRewardsPerBlock())[0]).gt(0);
    expect(await govStaking.getRewardsPerBlock()).eq(0);
  });

  it("should set APY and change getRewardsPerBlock only by avatar", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const [, gdRewardsPerBlockBeforeSet] = await staking.getRewardsPerBlock();
    expect(gdRewardsPerBlockBeforeSet.add(1)).to.equal(INTEREST_RATE_5APY_X64);
    const gdInterestRateIn128BeforeSet =
      await staking.interestRatePerBlockX64();
    expect(gdInterestRateIn128BeforeSet).to.equal(INTEREST_RATE_5APY_128);

    await runAsAvatarOnly(
      staking,
      "setGdApy(uint128)",
      INTEREST_RATE_10APY_X64
    );

    const [, gdRewardsPerBlockAfterSet] = await staking.getRewardsPerBlock();
    expect(gdRewardsPerBlockAfterSet.add(1)).to.equal(INTEREST_RATE_10APY_X64);
    const gdInterestRateIn128AfterSet = await staking.interestRatePerBlockX64();
    expect(gdInterestRateIn128AfterSet).to.equal(INTEREST_RATE_10APY_128);
  });

  it("should be pausable by avatar", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await runAsAvatarOnly(staking, "pause(bool,uint128)", true, "0");
    expect(await staking.paused()).to.equal(true);
    let [, gdRewardsPerBlockAfterSet] = await staking.getRewardsPerBlock();
    expect(gdRewardsPerBlockAfterSet).to.equal("0");

    await runAsAvatarOnly(
      staking,
      "pause(bool,uint128)",
      false,
      "1000000029000000000"
    );
    expect(await staking.paused()).to.equal(false);
    [, gdRewardsPerBlockAfterSet] = await staking.getRewardsPerBlock();
    expect(gdRewardsPerBlockAfterSet.add(1)).to.equal("1000000029000000000");
  });

  it("should not be able to stake when paused", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await runAsAvatarOnly(staking, "pause(bool,uint128)", true, "0");
    await expect(stake(staker2, "1000", staking)).to.revertedWith("pause");
  });

  it("should have max yearly apy of 20%", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await runAsAvatarOnly(staking, "setGdApy(uint128)", "1000000029000000000");

    let [, gdRewardsPerBlockAfterSet] = await staking.getRewardsPerBlock();
    expect(gdRewardsPerBlockAfterSet.add(1)).to.equal("1000000029000000000");

    //shout not be set as > 20% apy
    await runAsAvatarOnly(staking, "setGdApy(uint128)", "1000000030000000000");

    [, gdRewardsPerBlockAfterSet] = await staking.getRewardsPerBlock();
    expect(gdRewardsPerBlockAfterSet.add(1)).to.equal("1000000029000000000");
  });

  it("should handle stakingrewardsfixed apy correctly when transfering staking tokens to new staker", async () => {
    const { staking } = await waffle.loadFixture(fixture_staked1year);

    const RECEIVER_STAKE = 10000;
    const receiver = staker2;
    await stake(receiver, RECEIVER_STAKE, staking);
    const receiverInfo = await staking.stakersInfo(receiver.address);
    const stakerInfo = await staking.stakersInfo(staker1.address);

    expect(await staking.getSavings(staker1.address)).to.equal(
      STAKE_AMOUNT + 500
    ); // 500 yearly earned reward
    expect(await staking.getSavings(receiver.address)).to.equal(
      RECEIVER_STAKE - 1 //precision loss
    );

    const sharesToTransfer = await staking.amountToShares(200);
    await staking.transfer(receiver.address, sharesToTransfer);

    expect(
      (await staking.stakersInfo(staker1.address)).lastSharePrice
    ).to.equal(stakerInfo.lastSharePrice); // keep staker relative earnings

    expect(await staking.getSavings(staker1.address)).to.equal(
      STAKE_AMOUNT + 500 - 200
    );
    expect(await staking.earned(staker1.address)).to.equal(490);
    expect(await staking.earned(receiver.address)).to.equal(9); //the rewards part should have been transfered, there's precision loss
    expect((await staking.stakersInfo(receiver.address)).lastSharePrice).to.lt(
      receiverInfo.lastSharePrice
    ); // increase receiver rewards part = lower lastSharePrice

    expect(await staking.getSavings(receiver.address)).to.equal(
      RECEIVER_STAKE + 200
    );
    const senderInfo = await staking.stakersInfo(staker1.address);
    expect(senderInfo.rewardsPaid).to.equal(0); //no rewards transfer
    expect(await goodDollar.balanceOf(staking.address)).to.equal(
      STAKE_AMOUNT + RECEIVER_STAKE
    ); // no withdrawals yet

    //should be able to withdraw everything successfully, ie making sure all calculations add up
    await staking.withdrawStake(await staking.sharesOf(staker1.address));

    expect(await staking.earned(receiver.address)).to.equal(9); //the rewards part should have been transfered, there's precision loss, it is "fixed" when withdrawing
    await staking
      .connect(receiver)
      .withdrawStake(await staking.sharesOf(receiver.address));

    expect((await staking.stakersInfo(receiver.address)).rewardsPaid).eq(10); //withdraw transfered 1 GD to the rewards part, to make sure contract balance withdraws are correct
    expect((await staking.stakersInfo(staker1.address)).rewardsPaid).eq(490);
    expect(await goodDollar.balanceOf(staking.address)).eq(0);
    expect(await goodDollar.balanceOf(staker1.address)).eq(10300);
    expect(await goodDollar.balanceOf(receiver.address)).eq(10200);
  });

  it("should be able to stake using onTokenTransfer", async () => {
    const { staking, goodDollarMintBurnWrapper } = await waffle.loadFixture(
      fixture_ready
    );

    await goodDollar.mint(staker1.address, "100000000");

    await expect(
      goodDollar
        .connect(staker1)
        .transferAndCall(
          staking.address,
          "100000000",
          ethers.constants.HashZero
        )
    ).not.reverted;
    expect(await staking.getSavings(staker1.address)).to.equal("100000000");
  });

  it("should asure getStaked returns correct value", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    // correct after stake
    await stake(staker1, STAKE_AMOUNT, staking);
    let [userProductivity, totalProductivity] = await staking[
      "getStaked(address)"
    ](staker1.address);
    let stakerShares = await staking.sharesOf(staker1.address);
    let totalStaked = (await staking.stats()).totalStaked;
    expect(userProductivity).eq(totalProductivity).to.equal(stakerShares);
    expect(totalStaked).to.equal(STAKE_AMOUNT);

    await staking.connect(staker1).withdrawStake(stakerShares.div(2));

    let [userProductivity2, totalProductivity2] = await staking[
      "getStaked(address)"
    ](staker1.address);

    expect(userProductivity2).to.equal(stakerShares.div(2));
    expect(totalProductivity2).to.equal(stakerShares.div(2));
  });

  it("it should return getUserPendingReward G$ value equal to earned() rewards after donation", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    await stake(staker1, STAKE_AMOUNT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);

    const [, earnedGdRewards] = await staking["getUserPendingReward(address)"](
      staker1.address
    );
    const earnedRewards = await staking.earned(staker1.address);

    expect(earnedGdRewards)
      .to.equal(earnedRewards)
      .to.equal(BN.from(STAKE_AMOUNT).mul(5).div(100)); // 5% apy
  });

  it("should return G$ totalRewardsPerShare equal sharePrice()", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    await stake(staker1, STAKE_AMOUNT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    const stats = await staking.stats();
    const sharePrice = await staking.sharePrice();
    let [, accumulatedGdRewardsPerShare] = await staking[
      "totalRewardsPerShare()"
    ]();
    // to be changed
    //rewards per share = (savings - deposit) / number of shares = 10500 - 10000 / 1000000
    expect(accumulatedGdRewardsPerShare.div(1e6)) //div by 1e6 to not compare exact precision due to compounding interest precision
      .to.equal(
        BN.from("10500")
          .sub("10000")
          .mul(await staking.SHARE_PRECISION())
          .div(await staking.sharesSupply())
          .div(1e6)
      )
      .to.gt(0);
  });

  it("it should not upgrade if no balance or target is not approved by dao", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    await expect(
      staking.connect(staker1).upgradeTo(signers[10].address)
    ).revertedWith("no balance");
    await stake(staker1, STAKE_AMOUNT, staking);
    await expect(
      staking.connect(staker1).upgradeTo(signers[10].address)
    ).revertedWith("not DAO approved");
  });

  it("it should not upgrade if cant mint rewards", async () => {
    const { staking, goodDollarMintBurnWrapper } = await waffle.loadFixture(
      fixture_ready
    );
    await stake(staker1, STAKE_AMOUNT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock //has scheme permissions set by createDAO()
    );

    await ictrl.registerScheme(
      signers[10].address,
      ethers.constants.HashZero,
      "0x00000001",
      avatar
    );

    const PAUSE_ALL_ROLE = await goodDollarMintBurnWrapper.PAUSE_ALL_ROLE();
    // pause goodDollarMintBurnWrapper
    let encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData(
      "pause",
      [PAUSE_ALL_ROLE]
    );

    await genericCall(goodDollarMintBurnWrapper.address, encodedCall);

    await expect(
      staking.connect(staker1).upgradeTo(signers[10].address)
    ).revertedWith("unable to mint rewards");
  });

  it("it should upgrade and transfer funds to new staking contract", async () => {
    const { staking, goodDollarMintBurnWrapper } = await waffle.loadFixture(
      fixture_ready
    );
    await stake(staker1, STAKE_AMOUNT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);

    const f = await ethers.getContractFactory("GoodDollarStakingMock");
    const newStaking = await f.deploy(
      nameService.address,
      BN.from("1000000007735630000"),
      518400 * 12,
      30
    );

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock //has scheme permissions set by createDAO()
    );

    await ictrl.registerScheme(
      newStaking.address,
      ethers.constants.HashZero,
      "0x00000001",
      avatar
    );

    const balance = await staking.getSavings(staker1.address);
    console.log("balance:", balance.toNumber());
    await staking.connect(staker1).upgradeTo(newStaking.address);
    expect(await goodDollar.balanceOf(newStaking.address))
      .eq(balance)
      .gt(0);
  });
});
