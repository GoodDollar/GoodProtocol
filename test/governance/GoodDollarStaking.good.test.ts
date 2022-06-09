import { default as hre, ethers, upgrades, waffle } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { expect } from "chai";
import {
  GoodMarketMaker,
  GoodReserveCDai,
  GReputation,
  GoodDollarStaking
} from "../../types";
import { createDAO, advanceBlocks } from "../helpers";
import { FormatTypes } from "ethers/lib/utils";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("GoodDollarStaking - check GOOD rewards based on GovernanceStaking.test.js", () => {
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
    setDAOAddress;

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
      nameService: ns,
      setDAOAddress: sda,
      marketMaker: mm,
      daiAddress,
      cdaiAddress,
      reserve,
      reputation
    } = await createDAO();
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
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
    governanceStaking = (await governanceStakingFactory.deploy(
      nameService.address,
      BN.from("1000000007735630000"),
      518400 * 12,
      30
    )) as GoodDollarStaking;

    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();

    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
  });

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

    //TODO: register as scheme here

    return { staking };
  };

  it("Should not revert withdraw but also not mint GOOD reward when staking contract is not minter", async () => {
    const { staking } = await waffle.loadFixture(fixture);
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    await staking.stake("100", 0);
    await advanceBlocks(5);
    await expect(staking.withdrawStake("100")).to.not.reverted;
    expect(await grep.balanceOfLocal(founder.address)).to.eq(0);
  });

  it("Should be able to mint rewards after set GDAO staking contract", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    await staking.stake("100", 0);
    await advanceBlocks(5);

    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);

    expect(GDAOBalanceAfterWithdraw).to.gt(GDAOBalanceBeforeWithdraw);
  });

  it("Avatar should be able to change rewards per block", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    let encodedCall = staking.interface.encodeFunctionData(
      "setMonthlyGOODRewards",
      [ethers.utils.parseEther("1728000")]
    );
    await ictrl.genericCall(staking.address, encodedCall, avatar, 0);
    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    expect(rewardsPerBlock).to.equal(
      ethers.utils.parseEther("1728000").div(BN.from("518400")) // 1728000 is montlhy reward amount and 518400 is monthly blocks for FUSE chain
    );
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("100", 0);
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake("100");
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(calculatedReward)
    );
  });

  it("Should be able to withdraw rewards without withdraw stake", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("100", 0);
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    const transaction = await (await staking.withdrawRewards()).wait();
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(calculatedReward)
    );
    expect(transaction.events.find(_ => _.event === "ReputationEarned")).to.be
      .not.empty;
  });

  it("Should be able to withdraw transferred stakes", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(staker.address, "100");
    await goodDollar.connect(staker).approve(staking.address, "100");
    await staking.connect(staker).stake("100", 0);
    await advanceBlocks(4);
    await staking.connect(staker).transfer(founder.address, "100");
    await staking.connect(staker).withdrawRewards();
    const gdaoBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake("100");
    const gdaoBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    expect(gdaoBalanceAfterWithdraw).to.gt(gdaoBalanceBeforeWithdraw);
  });

  it("should not be able to withdraw after they send their stake to somebody else", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    let transaction = await staking
      .connect(staker)
      .withdrawStake("100")
      .catch(e => e);
    expect(transaction.message).to.have.string("no balance");
  });

  it("it should distribute reward with correct precision", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    let encodedCall = staking.interface.encodeFunctionData(
      "setMonthlyGOODRewards",
      ["17280000000000000000"] // Give 0.0001 GDAO per block so 17.28 GDAO per month
    );
    await ictrl.genericCall(staking.address, encodedCall, avatar, 0);
    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("100", 0);
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake("100");
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(calculatedReward).gt(0);
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(calculatedReward)
    );
  });

  it("it should not generate rewards when rewards per block set to 0", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    let encodedCall = staking.interface.encodeFunctionData(
      "setMonthlyGOODRewards",
      ["0"] // Give 0 GDAO per block
    );
    await ictrl.genericCall(staking.address, encodedCall, avatar, 0);

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    await staking.stake("100", 0);
    const userProductivity = await staking["getStaked(address)"](
      founder.address
    );
    expect(userProductivity[0]).to.be.equal(BN.from("100"));
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    expect(GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw)).to.equal(0);
  });

  it("it should return productivity values correctly", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    await staking.stake("100", 0);
    const productivityValue = await staking["getStaked(address)"](
      founder.address
    );

    expect(productivityValue[0].toString()).to.be.equal("100");
    expect(productivityValue[1].toString()).to.be.equal("100");
    await staking.withdrawStake("100");
  });

  it("it should return earned rewards with pending ones properly", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("100", 0);
    await advanceBlocks(5);
    const [totalEarnedGOOD] = await staking["getUserPendingReward(address)"](
      founder.address
    );
    const pendingRewardBlockNumber = await ethers.provider.getBlockNumber();
    const multiplier = pendingRewardBlockNumber - stakeBlockNumber;
    const calculatedPendingReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(totalEarnedGOOD).to.be.equal(calculatedPendingReward);
    await staking.withdrawStake("100");
  });

  it("Accumulated per share has enough precision when reward << totalproductivity", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.mint(founder.address, "100000000000000"); // 1 trillion gd stake
    await goodDollar.approve(staking.address, "1000000000000");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("1000000000000", 0);
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake("1000000000000");
    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(calculatedReward)
    );
  });

  it("user receive fractional gdao properly when his stake << totalProductivity", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.mint(founder.address, "800"); // 8gd
    await goodDollar.mint(staker.address, "200"); // 2gd
    await goodDollar.approve(staking.address, "800");
    await goodDollar.connect(staker).approve(staking.address, "200");
    await staking.stake("800", 0);
    const secondStakerStakeBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;
    await staking.connect(staker).stake("200", 0);
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(staker.address);
    const FounderGDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake("800");
    const founderWithdrawBlockNumber = await ethers.provider.getBlockNumber();
    await staking.connect(staker).withdrawStake("200");
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(staker.address);
    const FounderGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    const founderCalculatedRewards = rewardsPerBlock.add(
      rewardsPerBlock
        .mul(80)
        .mul(founderWithdrawBlockNumber - secondStakerStakeBlockNumber)
        .div(100)
    ); // Founder should get full rewards for one block then owns of %80 of rewards
    const stakerCalculatedRewards = rewardsPerBlock
      .mul(20)
      .mul(founderWithdrawBlockNumber - secondStakerStakeBlockNumber)
      .div(100)
      .add(rewardsPerBlock); // Staker should get %20 of rewards initially then when Founder withdraw their stake Staker would own %100 of rewards and would get full amount
    expect(FounderGDAOBalanceAfterWithdraw).to.be.equal(
      FounderGDAOBalanceBeforeWithdraw.add(founderCalculatedRewards)
    );
    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceBeforeWithdraw.add(stakerCalculatedRewards)
    );
  });

  it("it should be able to tranfer tokens when user approve", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    await staking.stake("100", 0);
    await staking.approve(staker.address, "100");
    const stakerProductivityBeforeTransfer = await staking.getStaked(
      staker.address
    );

    await staking
      .connect(staker)
      .transferFrom(founder.address, staker.address, "100");
    const stakerProductivity = await staking.getStaked(staker.address);

    expect(await staking.balanceOf(founder.address)).to.equal(0);
    expect(await staking.balanceOf(staker.address)).to.equal(100);

    expect((await staking.goodStakerInfo(staker.address)).amount).to.equal(100);
    expect(stakerProductivityBeforeTransfer[0]).to.be.equal(0);
    expect(stakerProductivity[0]).to.be.equal("100");
  });

  it("it should return staker data", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(staker2.address, "200");
    await goodDollar.connect(staker2).approve(staking.address, "200");
    await staking.connect(staker2).stake("100", 0);

    await advanceBlocks(10);
    await staking.connect(staker2).stake("100", 0); //perform some action so GOOD rewardDebt is updated

    expect((await staking.goodStakerInfo(staker2.address)).rewardDebt).to.gt(0); //debt should start according to accumulated rewards in contract. debt is the user stake starting point.

    await staking.connect(staker2).withdrawStake("1");

    expect(await staking.balanceOf(staker2.address)).to.equal(199);

    expect((await staking.goodStakerInfo(staker2.address)).amount).to.equal(
      199
    );
    expect((await staking.goodStakerInfo(staker2.address)).rewardDebt).to.gt(0); //should have withdrawn rewards after withdraw stake
    expect((await staking.goodStakerInfo(staker2.address)).rewardEarn).to.equal(
      0
    ); //should have 0 pending rewards after withdraw stake

    await advanceBlocks(10);
    await goodDollar.connect(staker2).approve(staking.address, "200");

    await staking.connect(staker2).stake("1", 0); //should calculate user pending rewards

    expect(
      (await staking.goodStakerInfo(staker2.address)).rewardEarn
    ).to.be.equal(
      0 //should have 0 rewardEarned because every action, like the above stake withdraws gdao rewards
    );
    await advanceBlocks(2); // pass some blocks
    const [userPendingGoodReward] = await staking[
      "getUserPendingReward(address)"
    ](staker2.address);
    expect(userPendingGoodReward).to.be.gt(0);
  });

  it("it should return pendingRewards equal zero after withdraw", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(staker.address, "200");
    await goodDollar.connect(staker).approve(staking.address, "200");
    await staking.connect(staker).stake("100", 0);
    await advanceBlocks(10);

    let [userPendingGoodRewards] = await staking[
      "getUserPendingReward(address)"
    ](staker.address);
    expect(userPendingGoodRewards).to.be.gt(0);
    await staking.connect(staker).withdrawRewards();
    [userPendingGoodRewards] = await staking["getUserPendingReward(address)"](
      staker.address
    );
    expect(userPendingGoodRewards).to.equal(0);
    await advanceBlocks(1);
    [userPendingGoodRewards] = await staking["getUserPendingReward(address)"](
      staker.address
    );
    expect(userPendingGoodRewards).to.gt(0); //one block passed

    await staking.connect(staker).withdrawStake(ethers.constants.MaxUint256);
    [userPendingGoodRewards] = await staking["getUserPendingReward(address)"](
      staker.address
    );
    expect(userPendingGoodRewards).to.be.equal(0);
  });

  it("it should calculate accumulated rewards per share correctly", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(founder.address, "200");
    await goodDollar.mint(staker.address, "200");

    await goodDollar.approve(staking.address, "200");
    await goodDollar.connect(staker).approve(staking.address, "200");

    await staking.stake("100", 0);
    let accumulatedRewardsPerShare = (
      await staking["totalRewardsPerShare()"]()
    )[0];
    expect(accumulatedRewardsPerShare).to.equal(0); //first has no accumulated rewards yet, since no blocks have passed since staking

    await staking.stake("100", 0);
    accumulatedRewardsPerShare = (await staking["totalRewardsPerShare()"]())[0];
    expect((await staking.getRewardsPerBlock())[0]).to.equal(
      ethers.utils
        .parseEther("2000000") //2M reputation
        .div(await staking.getChainBlocksPerMonth())
    );
    let totalProductiviy = BN.from("100");

    console.log(
      { accumulatedRewardsPerShare },
      await staking.getRewardsPerBlock()
    );
    //totalRewardsPerShare is in 1e27 , divid by  1e9 to get 1e18 decimals
    expect(accumulatedRewardsPerShare.div(BN.from(1e9))).to.equal(
      ethers.utils
        .parseEther("2000000") //monthly rewards
        .mul(BN.from(1e2)) //G$ is 2 decimals, dividing reduces decimals by 2, so we first increase to 1e20 decimals
        .div(await staking.getChainBlocksPerMonth())
        .mul(BN.from("1")) //=rewards per block * number of blocks = rewards earned in period
        .div(totalProductiviy) //=rewards per share
        .mul(BN.from("10000000000000000")), //restore lost precision from dividing by totalProductivity G$ 2 decimals;
      "1 block"
    ); //1 block passed with actual staking

    totalProductiviy = totalProductiviy.add(BN.from("100")); //second stake
    await staking.connect(staker).stake("100", 0);
    let accumulatedRewardsPerShare2 = (
      await staking["totalRewardsPerShare()"]()
    )[0];

    //shouldnt be naive accumlattion of 2 blocks, since total productivity has changed between blocks
    expect(accumulatedRewardsPerShare2.div(BN.from(1e9))).to.not.equal(
      ethers.utils
        .parseEther("2000000")
        .mul(BN.from(1e2)) //G$ is 2 decimals, dividing reduces decimals by 2, so we first increase to 1e20 decimals
        .div(await staking.getChainBlocksPerMonth())
        .div(totalProductiviy)
        .mul(BN.from("2"))
        .mul(BN.from("10000000000000000")), //increase precision to 1e18 from totalProductivity G$ 2 decimals;

      "2 blocks"
    ); //2 blocks passed but now we have 200 total productivity before 3rd stake

    console.log(
      accumulatedRewardsPerShare2.toString(),
      accumulatedRewardsPerShare.toString()
    );

    const calculatedAccRewards = rdiv(
      ethers.utils
        .parseEther("2000000")
        .div(await staking.getChainBlocksPerMonth()),
      totalProductiviy
    );
    //accumulated so far plus block accumulation
    expect(accumulatedRewardsPerShare2).to.equal(
      calculatedAccRewards.add(accumulatedRewardsPerShare), //add rewards from previous block
      "2 blocks correct"
    );
    await setDAOAddress("GDAO_STAKING", governanceStaking.address);
  });

  it("Staking tokens should be 2 decimals", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const decimals = await staking.decimals();
    expect(decimals.toString()).to.be.equal("2");
  });

  it("Stake amount should be positive", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await expect(staking.stake("0", 0)).revertedWith("Cannot stake 0");
  });

  it("It should approve stake amount in order to stake", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await expect(staking.stake(ethers.utils.parseEther("10000000"), 0)).to
      .reverted;
  });

  it("Withdraw 0 should succeed", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await expect(staking.withdrawStake("0")).to.not.reverted;
  });

  it("Withdraw uint max should withdraw everything", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(staker2.address, "200");
    await goodDollar.connect(staker2).approve(staking.address, "200");
    await staking.connect(staker2).stake("200", 0);
    await advanceBlocks(1000);
    await staking.connect(staker2).withdrawStake(ethers.constants.MaxUint256);
    expect(await staking.getPrinciple(staker2.address)).to.equal(0);
    const staked = await staking.getStaked(staker2.address);
    staked.map(stake => {
      expect(stake).to.equal(0);
    });
  });

  it("Should use overriden _transfer that handles productivity when using transferFrom which is defined in super erc20 contract", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    await expect(
      staking.transferFrom(
        founder.address,
        staker.address,
        ethers.utils.parseEther("10000000")
      )
    ).to.reverted;
  });

  it("it should get rewards for previous stakes when stake new amount of tokens", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.mint(founder.address, "200");
    await goodDollar.approve(staking.address, "200");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("100", 0);
    await advanceBlocks(5);
    const gdaoBalanceBeforeGetRewards = await grep.balanceOfLocal(
      founder.address
    );
    await staking.stake("100", 0);
    const getRewardsBlockNumber = await ethers.provider.getBlockNumber();
    const gdaoBalanceAfterGetRewards = await grep.balanceOfLocal(
      founder.address
    );
    const multiplier = getRewardsBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    await staking.withdrawStake("200");
    expect(gdaoBalanceAfterGetRewards).to.be.equal(
      gdaoBalanceBeforeGetRewards.add(calculatedReward)
    );
  });

  it("it should distribute rewards properly when there are multiple stakers", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    const stakingAmount = BN.from("100");
    await goodDollar.mint(founder.address, stakingAmount);
    await goodDollar.mint(staker.address, stakingAmount);
    await goodDollar.mint(signers[0].address, stakingAmount);
    await goodDollar.mint(signers[1].address, stakingAmount);

    await goodDollar.approve(staking.address, stakingAmount);
    await goodDollar.connect(staker).approve(staking.address, stakingAmount);
    await goodDollar
      .connect(signers[0])
      .approve(staking.address, stakingAmount);
    await goodDollar
      .connect(signers[1])
      .approve(staking.address, stakingAmount);
    await staking.stake(stakingAmount, 0);
    const stakerOneGDAOBalanceAfterStake = await grep.balanceOfLocal(
      founder.address
    );
    await staking.connect(staker).stake(stakingAmount.div(10), 0);
    const stakerTwoGDAOBalanceAfterStake = await grep.balanceOfLocal(
      staker.address
    );
    await staking.connect(signers[0]).stake(stakingAmount.div(4), 0);
    const stakerThreeGDAOBalanceAfterStake = await grep.balanceOfLocal(
      signers[0].address
    );
    const stakerFourStakeBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;
    await staking.connect(signers[1]).stake(stakingAmount.div(5), 0);
    const stakerFourGDAOBalanceAfterStake = await grep.balanceOfLocal(
      signers[1].address
    );
    await advanceBlocks(10);
    await staking.withdrawStake(stakingAmount);
    const stakerOneWithdrawBlockNumber = await ethers.provider.getBlockNumber();
    const stakerOneGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.connect(staker).withdrawStake(stakingAmount.div(10));
    const stakerTwoGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      staker.address
    );
    await staking.connect(signers[0]).withdrawStake(stakingAmount.div(4));
    const stakerThreeGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      signers[0].address
    );
    await staking.connect(signers[1]).withdrawStake(stakingAmount.div(5));
    const stakerFourGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      signers[1].address
    );
    const stakerOneRewardsCalculated = rewardsPerBlock
      .add(rewardsPerBlock.mul(100).div(110))
      .add(rewardsPerBlock.mul(100).div(135))
      .add(
        rewardsPerBlock
          .mul(100)
          .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
          .div(155)
      );
    // .add(BN.from("2"));
    const stakerTwoRewardsCalculated = rewardsPerBlock
      .mul(10)
      .div(110)
      .add(rewardsPerBlock.mul(10).div(135))
      .add(
        rewardsPerBlock
          .mul(10)
          .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
          .div(155)
      )
      .add(rewardsPerBlock.mul(10).div(55))
      .add(BN.from("1"));
    const stakerThreeRewardsCalculated = rewardsPerBlock
      .mul(25)
      .div(135)
      .add(
        rewardsPerBlock
          .mul(25)
          .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
          .div(155)
      )
      .add(rewardsPerBlock.mul(25).div(55))
      .add(rewardsPerBlock.mul(25).div(45))
      .add(BN.from("2"));
    const stakerFourRewardsCalculated = rewardsPerBlock
      .mul(20)
      .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
      .div(155)
      .add(rewardsPerBlock.mul(20).div(55))
      .add(rewardsPerBlock.mul(20).div(45))
      .add(rewardsPerBlock);
    // .add(BN.from("1"));
    expect(stakerOneGDAOBalanceAfterWithdraw).to.be.equal(
      stakerOneGDAOBalanceAfterStake.add(stakerOneRewardsCalculated)
    );
    expect(stakerTwoGDAOBalanceAfterWithdraw).to.be.equal(
      stakerTwoGDAOBalanceAfterStake.add(stakerTwoRewardsCalculated)
    );
    expect(stakerThreeGDAOBalanceAfterWithdraw).to.be.equal(
      stakerThreeGDAOBalanceAfterStake.add(stakerThreeRewardsCalculated)
    );
    expect(stakerFourGDAOBalanceAfterWithdraw).to.be.equal(
      stakerFourGDAOBalanceAfterStake.add(stakerFourRewardsCalculated)
    );
  });

  it("it should get staking reward even reward amount is too low", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    console.log(rewardsPerBlock.toString());
    const stakingAmount = BN.from("10000");
    await goodDollar.mint(founder.address, stakingAmount);
    await goodDollar.mint(staker.address, stakingAmount);
    await goodDollar.approve(staking.address, stakingAmount);
    await goodDollar.connect(staker).approve(staking.address, stakingAmount);
    await staking.stake(stakingAmount, 0);
    const stakerOneGDAOBalanceAfterStake = await grep.balanceOfLocal(
      founder.address
    );
    const stakerTwoStakeBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;
    await staking.connect(staker).stake(stakingAmount.div(10000), 0);
    const stakerTwoGDAOBalanceAfterStake = await grep.balanceOfLocal(
      staker.address
    );
    await advanceBlocks(10);

    await staking.connect(staker).withdrawStake(stakingAmount.div(10000));
    const stakerTwoWithdrawBlockNumber = await ethers.provider.getBlockNumber();
    await staking.withdrawStake(stakingAmount);

    const stakerOneGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    const stakerTwoGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      staker.address
    );
    const calculatedRewardsStakerOne = rewardsPerBlock
      .add(
        rewardsPerBlock
          .mul(10000)
          .mul(stakerTwoWithdrawBlockNumber - stakerTwoStakeBlockNumber)
          .div(10001)
      )
      .add(rewardsPerBlock);
    const calculatedRewardsStakerTwo = rewardsPerBlock
      .mul(1)
      .mul(stakerTwoWithdrawBlockNumber - stakerTwoStakeBlockNumber)
      .div(10001)
      .add(BN.from("1"));
    expect(stakerOneGDAOBalanceAfterWithdraw).to.be.equal(
      stakerOneGDAOBalanceAfterStake.add(calculatedRewardsStakerOne)
    );
    expect(stakerTwoGDAOBalanceAfterWithdraw).to.be.equal(
      stakerTwoGDAOBalanceAfterStake.add(calculatedRewardsStakerTwo)
    );
  });

  it("it should mint rewards properly when withdrawRewards", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    await goodDollar.mint(founder.address, "200");
    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.approve(staking.address, "200");

    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("200", BN.from(0));
    const GDAOBalanceAfterStake = await grep.balanceOfLocal(founder.address);
    await advanceBlocks(100);
    await staking.withdrawRewards();
    const withdrawRewardsBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);

    expect(GDAOBalanceAfterWithdraw).to.be.equal(
      GDAOBalanceAfterStake.add(
        rewardsPerBlock.mul(withdrawRewardsBlockNumber - stakeBlockNumber)
      )
    );
  });

  it("it should not overmint rewards when staker withdraw their rewards", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const overmintTesterFactory = await ethers.getContractFactory(
      "OverMintTester"
    );
    const overMintTester = await overmintTesterFactory.deploy(
      goodDollar.address,
      staking.address,
      grep.address
    );
    await goodDollar.mint(overMintTester.address, "100");
    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await overMintTester.stake();
    const GDAOBalanceAfterStake = await grep.balanceOfLocal(
      overMintTester.address
    );
    await advanceBlocks(100);
    await overMintTester.overMintTest();
    const withdrawRewardsBlockNumber = await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterWithdrawReward = await grep.balanceOfLocal(
      overMintTester.address
    );
    await advanceBlocks(20);
    await overMintTester.overMintTest();
    const secondWithdrawRewardsBlockNumber =
      await ethers.provider.getBlockNumber();
    const GDAOBalanceAfterSecondWithdrawReward = await grep.balanceOfLocal(
      overMintTester.address
    );

    expect(GDAOBalanceAfterWithdrawReward).to.be.gt(GDAOBalanceAfterStake);
    expect(
      GDAOBalanceAfterWithdrawReward.sub(GDAOBalanceAfterStake)
    ).to.be.equal(
      rewardsPerBlock.mul(withdrawRewardsBlockNumber - stakeBlockNumber)
    );
    expect(GDAOBalanceAfterSecondWithdrawReward).to.be.gt(
      GDAOBalanceAfterWithdrawReward
    );
    expect(
      GDAOBalanceAfterSecondWithdrawReward.sub(GDAOBalanceAfterWithdrawReward)
    ).to.be.equal(
      rewardsPerBlock.mul(
        secondWithdrawRewardsBlockNumber - withdrawRewardsBlockNumber
      )
    );
  });

  it("it should accrue previous rewards based on previous monthly rate on monthly rewards rate change to 0", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("100", 0);
    await advanceBlocks(4);

    let encodedCall = staking.interface.encodeFunctionData(
      "setMonthlyGOODRewards",
      ["0"] // Give 0.0001 GDAO per block so 17.28 GDAO per month
    );
    await ictrl.genericCall(staking.address, encodedCall, avatar, 0);

    const withdrawBlockNumber = await ethers.provider.getBlockNumber();
    const multiplier = withdrawBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier);
    const [pendingReward] = await staking["getUserPendingReward(address)"](
      founder.address
    );
    expect(pendingReward).to.equal(calculatedReward);
    await advanceBlocks(4);
  });

  function rdiv(x: BigNumber, y: BigNumber) {
    return x.mul(BN.from("10").pow(27)).add(y.div(2)).div(y);
  }
});
