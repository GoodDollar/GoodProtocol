import { default as hre, ethers, upgrades, waffle } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  GoodReserveCDai,
  GReputation,
  GoodDollarStaking,
  GovernanceStaking
} from "../../types";
import { createDAO, advanceBlocks, increaseTime } from "../helpers";
import { FormatTypes } from "ethers/lib/utils";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;
const DONATION_30_PERCENT = 30;
const STAKE_AMOUNT = 10000;

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
    setSchemes;

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
      setReserveToken
    } = await createDAO();

    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);

    setSchemes = ss;
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
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
    await stakingContract.stake(_amount, DONATION_30_PERCENT);
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
      [nameService.address, BN.from("1000000007735630000"), 518400 * 12, 30]
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

  it("should withdraw from deposit and undo rewards if unable to mint rewards", async () => {
    //test that withdraw is success for deposit part even if call to GoodDollarMintBurnWrapper fails
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

  it("should change GD apy only by avatar", async () => {});

  it("should withdraw only rewards when calling withdrawRewards", async () => {});

  it("should handle stakingrewardsfixed apy correctly when transfering staking tokens", async () => {
    //test that logic of _transfer is as expected
  });
});
