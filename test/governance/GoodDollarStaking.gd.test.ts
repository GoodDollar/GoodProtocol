import { default as hre, ethers, upgrades, waffle } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
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
  let governanceStaking: GoodDollarStaking;
  let goodFundManager: Contract;
  let grep: GReputation;
  let avatar,
    goodDollar,
    marketMaker: GoodMarketMaker,
    controller,
    founder,
    staker,
    staker2,
    staker3,
    schemeMock,
    signers,
    nameService,
    setDAOAddress,
    setSchemes,
    runAsAvatarOnly;

  before(async () => {
    [founder, staker, staker2, staker3, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GoodDollarStaking"
    );

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      daoCreator,
      nameService: ns,
      setDAOAddress: sda,
      setSchemes: ss,
      marketMaker: mm,
      daiAddress,
      cdaiAddress,
      reserve,
      reputation,
      setReserveToken,
      runAsAvatarOnly: raao
    } = await createDAO();

    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);

    setSchemes = ss;
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    runAsAvatarOnly = raao;
    goodReserve = reserve as GoodReserveCDai;
    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar
    });
    goodFundManager = await upgrades.deployProxy(
      goodFundManagerFactory,
      [nameService.address],
      { kind: "uups" }
    );
    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address
    });
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

    marketMaker = mm;

    console.log("setting permissions...");

    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();

    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
  });

  async function stake(
    _staker,
    _amount,
    _givebackRatio,
    stakingContract
  ) {
    await goodDollar.mint(_staker.address, _amount);
    await goodDollar.approve(stakingContract.address, _amount);
    await stakingContract.stake(_amount, _givebackRatio);
  }

  const fixture = async (wallets, provider) => {
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
      [nameService.address, BN.from(INTEREST_RATE_5APY_X64), 518400 * 12, 30]
    )) as GoodDollarStaking;

    await staking.upgrade();

    return { staking };
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

    return { staking };
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

    await stake(founder, STAKE_AMOUNT, DONATION_30_PERCENT, staking);

    const info = await staking.stakersInfo(founder.address);
    expect(info.deposit).to.equal(STAKE_AMOUNT);
    expect(info.rewardsPaid).to.equal(0);
    expect(info.rewardsDonated).to.equal(0);
    expect(info.shares).to.equal((await staking.SHARE_DECIMALS()).mul(STAKE_AMOUNT));
    expect(info.avgDonationRatio).to.equal((await staking.PRECISION()).mul(DONATION_30_PERCENT));

    const stats = await staking.stats();
    expect(stats.lastUpdateBlock.gt(statsBefore.lastUpdateBlock));
    expect(stats.totalStaked).to.equal(STAKE_AMOUNT);
    expect(
      stats.totalShares.eq((await staking.SHARE_DECIMALS()).mul(STAKE_AMOUNT))
    ).to.be.true;
    expect(stats.totalRewardsPaid).to.equal(0);
    expect(stats.totalRewardsDonated).to.equal(0);
    expect(stats.avgDonationRatio).to.equal(PRECISION.mul(DONATION_30_PERCENT));
    expect(stats.principle).to.equal(PRECISION.mul(STAKE_AMOUNT));
  });

  xit("should withdraw from deposit and undo rewards if unable to mint rewards", async () => {
    //test that withdraw is success for deposit part even if call to GoodDollarMintBurnWrapper fails
    const { staking } = await waffle.loadFixture(fixture_ready);

    const mintBurnWrapperFactory = await ethers.getContractFactory("GoodDollarMintBurnWrapper");
    let goodDollarMintBurnWrapper = (await upgrades.deployProxy(
      mintBurnWrapperFactory,
      [1, INITIAL_CAP, avatar, nameService.address],
      { kind: "uups" }
    )) as unknown as GoodDollarMintBurnWrapper;
    await setSchemes([goodDollarMintBurnWrapper.address]);
    await setDAOAddress("MintBurnWrapper", goodDollarMintBurnWrapper.address);

    let encodedCall = goodDollarMintBurnWrapper.interface.encodeFunctionData("addMinter", [
      staking.address,
      INITIAL_CAP,
      INITIAL_CAP,
      30,
      true
    ]);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(goodDollar.address, encodedCall, avatar, 0);

    await stake(founder, STAKE_AMOUNT, DONATION_30_PERCENT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    await staking.withdrawStake(STAKE_AMOUNT);
  });

  it("should withdraw rewards after mint rewards is enabled again", async () => {});

  it("should get G$ rewards when withdrawing", async () => {
    //need to make sure GoodDollarMintBurnWrapper is deployed or some mock, so it can mint rewards
    //test that G$ balance is equal to principle after some interest was earned
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

  xit("should withdraw only rewards when calling withdrawRewards", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    // collect 350 earned rewards: 10,000 * 5%APY = 500 total rewards, minus 30% donation
    await stake(founder, STAKE_AMOUNT, DONATION_30_PERCENT, staking);
    await advanceBlocks(BLOCKS_ONE_YEAR);
    const infoBefore = await staking.stakersInfo(founder.address);

    await staking.withdrawRewards();

    const info = await staking.stakersInfo(founder.address);
    expect(info.deposit).to.equal(infoBefore.deposit).to.equal(STAKE_AMOUNT);
    expect(info.rewardsPaid).to.equal(350);
    expect(info.rewardsDonated).to.equal(150);
  });

  it("should handle stakingrewardsfixed apy correctly when transfering staking tokens", async () => {
    //test that logic of _transfer is as expected
  });
});
