import { default as hre, ethers, waffle } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber, Contract, Signer } from "ethers";
import { expect } from "chai";
import { GoodReserveCDai, GReputation, GoodDollarStaking } from "../../types";
import { createDAO, advanceBlocks } from "../helpers";
import { FormatTypes } from "ethers/lib/utils";
import { getFounders } from "../../scripts/getFounders";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("GoodDollarStaking - check GOOD rewards based on GovernanceStaking.test.js", () => {
  let dai: Contract;
  let cDAI: Contract;
  let goodReserve: GoodReserveCDai;
  let grep: GReputation;
  let avatar,
    goodDollar,
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
      reputation
    } = await loadFixture(createDAO);
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

    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    // await goodReserve.setAddresses();
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
    await staking.stake("100");
    await advanceBlocks(5);
    await expect(
      staking.withdrawStake(await staking.balanceOf(founder.address))
    ).to.not.reverted;
    expect(await grep.balanceOfLocal(founder.address)).to.eq(0);
  });

  it("Should be able to mint rewards after set GDAO staking contract", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    await staking.stake("100");
    await advanceBlocks(5);

    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake(await staking.amountToShares("100"));
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
    await staking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake(await staking.balanceOf(founder.address));
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
    await staking.stake("100");
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
    await staking.connect(staker).stake("100");
    await advanceBlocks(4);
    await staking
      .connect(staker)
      .transfer(founder.address, await staking.balanceOf(staker.address));
    await staking.connect(staker).withdrawRewards();
    const gdaoBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake(await staking.balanceOf(founder.address));
    const gdaoBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    expect(gdaoBalanceAfterWithdraw).to.gt(gdaoBalanceBeforeWithdraw);
  });

  it("should not be able to withdraw after they send their stake to somebody else", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(staker.address, "100");
    await goodDollar.connect(staker).approve(staking.address, "100");
    await staking.connect(staker).stake("100");
    await advanceBlocks(4);
    await staking
      .connect(staker)
      .transfer(founder.address, await staking.balanceOf(staker.address));

    await expect(staking.connect(staker).withdrawStake(1)).revertedWith(
      "no balance"
    );
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
    await staking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake(await staking.balanceOf(founder.address));
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
    await staking.stake("100");
    const userProductivity = await staking["getStaked(address)"](
      founder.address
    );
    expect(userProductivity[0]).to.be.equal("1000000");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake(await staking.balanceOf(founder.address));
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(founder.address);
    expect(GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw)).to.equal(0);
  });

  it("it should return productivity values correctly", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    await staking.stake("100");
    const productivityValue = await staking["getStaked(address)"](
      founder.address
    );

    expect(productivityValue[0].toString())
      .eq(productivityValue[1].toString())
      .to.equal(await staking.sharesOf(founder.address));
    await staking.withdrawStake(await staking.balanceOf(founder.address));
  });

  it("it should return earned rewards with pending ones properly for a short period", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(staking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("100");
    await advanceBlocks(5);
    const [totalEarnedGOOD] = await staking["getUserPendingReward(address)"](
      founder.address
    );
    const pendingRewardBlockNumber = await ethers.provider.getBlockNumber();
    const multiplier = pendingRewardBlockNumber - stakeBlockNumber;
    const calculatedPendingReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    expect(totalEarnedGOOD).to.be.equal(calculatedPendingReward);
    await staking.withdrawStake(await staking.balanceOf(founder.address));
  });

  it("Accumulated per share has enough precision when reward << totalproductivity", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.mint(founder.address, "100000000000000"); // 1 trillion gd stake
    await goodDollar.approve(staking.address, "1000000000000");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("1000000000000");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    await staking.withdrawStake(await staking.sharesOf(founder.address));
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
    await staking.stake("800");
    const secondStakerStakeBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;
    await staking.connect(staker).stake("200");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(staker.address);
    const FounderGDAOBalanceBeforeWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    const founderShares = await staking.sharesOf(founder.address);
    const stakerShares = await staking.sharesOf(staker.address);

    const totalShares = await staking.sharesSupply();
    await staking.withdrawStake(founderShares);

    const founderWithdrawBlockNumber = await ethers.provider.getBlockNumber();
    await staking.connect(staker).withdrawStake(stakerShares);
    const GDAOBalanceAfterWithdraw = await grep.balanceOfLocal(staker.address);
    const FounderGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      founder.address
    );

    const founderCalculatedRewards = rewardsPerBlock.add(
      rewardsPerBlock
        .mul(founderShares)
        .mul(founderWithdrawBlockNumber - secondStakerStakeBlockNumber)
        .div(totalShares)
    ); // Founder should get full rewards for one block plus his relative share of the rewards
    const stakerCalculatedRewards = rewardsPerBlock
      .mul(stakerShares)
      .mul(founderWithdrawBlockNumber - secondStakerStakeBlockNumber)
      .div(totalShares)
      .add(rewardsPerBlock)
      .add(1); // Staker should get his relative share of rewards initially then when Founder withdraw their stake Staker would own %100 of rewards and would get full amount
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
    await staking.stake("100");
    const sharesBalance = await staking.balanceOf(founder.address);
    await staking.approve(staker.address, sharesBalance);
    const stakerProductivityBeforeTransfer = await staking.getStaked(
      staker.address
    );

    await staking
      .connect(staker)
      .transferFrom(founder.address, staker.address, sharesBalance);
    const stakerProductivity = await staking.getStaked(staker.address);

    expect(await staking.balanceOf(founder.address)).to.equal(0);
    expect(await staking.balanceOf(staker.address)).to.equal(sharesBalance);

    expect((await staking.goodStakerInfo(staker.address)).amount).to.equal(
      sharesBalance
    );
    expect(stakerProductivityBeforeTransfer[0]).to.be.equal(0);
    expect(stakerProductivity[0]).to.be.equal(sharesBalance);
  });

  it("it should return staker data", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await goodDollar.mint(staker2.address, "200");
    await goodDollar.connect(staker2).approve(staking.address, "200");
    await staking.connect(staker2).stake("100");

    await advanceBlocks(10);
    await staking.connect(staker2).stake("100"); //perform some action so GOOD rewardDebt is updated

    expect((await staking.goodStakerInfo(staker2.address)).rewardDebt).to.gt(0); //debt should start according to accumulated rewards in contract. debt is the user stake starting point.

    const sharesToWithdraw = await staking.amountToShares(1);
    const sharesBalance = await staking.balanceOf(staker2.address);
    await staking.connect(staker2).withdrawStake(sharesToWithdraw);

    expect(await staking.balanceOf(staker2.address)).to.equal(
      sharesBalance.sub(sharesToWithdraw)
    );

    expect((await staking.goodStakerInfo(staker2.address)).amount).to.equal(
      sharesBalance.sub(sharesToWithdraw)
    );
    expect((await staking.goodStakerInfo(staker2.address)).rewardDebt).to.gt(0); //should have withdrawn rewards after withdraw stake
    expect((await staking.goodStakerInfo(staker2.address)).rewardEarn).to.equal(
      0
    ); //should have 0 pending rewards after withdraw stake

    await advanceBlocks(10);
    await goodDollar.connect(staker2).approve(staking.address, "200");

    await staking.connect(staker2).stake("1"); //should calculate user pending rewards

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
    await staking.connect(staker).stake("100");
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

    await staking
      .connect(staker)
      .withdrawStake(await staking.sharesOf(staker.address));
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

    await staking.stake("100");
    let accumulatedRewardsPerShare = (
      await staking["totalRewardsPerShare()"]()
    )[0];
    expect(accumulatedRewardsPerShare).to.equal(0); //first has no accumulated rewards yet, since no blocks have passed since staking

    let totalProductiviy = await staking.sharesSupply();

    await staking.stake("100");
    accumulatedRewardsPerShare = (await staking["totalRewardsPerShare()"]())[0];
    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    expect(rewardsPerBlock).to.equal(
      ethers.utils
        .parseEther("2000000") //2M reputation
        .div(await staking.getChainBlocksPerMonth())
    );
    console.log({ rewardsPerBlock, totalProductiviy });

    //totalRewardsPerShare is in 1e27 , divid by  1e9 to get 1e18 decimals
    expect(accumulatedRewardsPerShare.div(BN.from(1e9))).to.not.equal(
      ethers.utils
        .parseEther("2000000")
        .mul(BN.from(1e2)) //G$ is 2 decimals, dividing reduces decimals by 2, so we first increase to 1e20 decimals
        .div(await staking.getChainBlocksPerMonth())
        .div(totalProductiviy)
        .mul(BN.from("1"))
        .mul(BN.from("10000000000000000")), //increase precision to 1e18 from totalProductivity G$ 2 decimals;

      "1 blocks"
    ); //2 blocks passed but now we have 200 total productivity before 3rd stake

    totalProductiviy = await staking.sharesSupply();
    await staking.connect(staker).stake("100");
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

    const calculatedAccRewards = rdiv(
      ethers.utils
        .parseEther("2000000")
        .div(await staking.getChainBlocksPerMonth()),
      totalProductiviy
    );
    //accumulated so far plus block accumulation
    expect(accumulatedRewardsPerShare2).to.equal(
      calculatedAccRewards.add(accumulatedRewardsPerShare).sub(1), //add rewards from previous block
      "2 blocks correct"
    );
  });

  it("Staking tokens should be 18 decimals", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const decimals = await staking.decimals();
    expect(decimals.toString()).to.be.equal("18");
  });

  it("Stake amount should be positive", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await expect(staking.stake("0")).revertedWith("Cannot stake 0");
  });

  it("It should approve stake amount in order to stake", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    await expect(staking.stake(ethers.utils.parseEther("10000000"))).to
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
    await staking.connect(staker2).stake("200");
    await advanceBlocks(1000);
    await staking
      .connect(staker2)
      .withdrawStake(await staking.sharesOf(staker2.address));
    expect(await staking.getSavings(staker2.address)).to.equal(0);
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
    await staking.stake("100");
    await advanceBlocks(5);
    const gdaoBalanceBeforeGetRewards = await grep.balanceOfLocal(
      founder.address
    );
    await staking.stake("100");
    const getRewardsBlockNumber = await ethers.provider.getBlockNumber();
    const gdaoBalanceAfterGetRewards = await grep.balanceOfLocal(
      founder.address
    );
    const multiplier = getRewardsBlockNumber - stakeBlockNumber;
    const calculatedReward = rewardsPerBlock.mul(multiplier); // We calculate user rewards since it's the only staker so gets whole rewards so rewardsPerBlock * multipler(block that passed between stake and withdraw)
    await staking.withdrawStake(await staking.sharesOf(founder.address));
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
    await staking.stake(stakingAmount);
    const stakerOneGDAOBalanceAfterStake = await grep.balanceOfLocal(
      founder.address
    );
    await staking.connect(staker).stake(stakingAmount.div(10));
    const stakerTwoGDAOBalanceAfterStake = await grep.balanceOfLocal(
      staker.address
    );
    await staking.connect(signers[0]).stake(stakingAmount.div(4));

    const stakerThreeGDAOBalanceAfterStake = await grep.balanceOfLocal(
      signers[0].address
    );
    const stakerFourStakeBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;
    await staking.connect(signers[1]).stake(stakingAmount.div(5));

    const stakerFourGDAOBalanceAfterStake = await grep.balanceOfLocal(
      signers[1].address
    );
    await advanceBlocks(10);

    const totalShares = await staking.sharesSupply();
    const founderShares = await staking.sharesOf(founder.address);
    await staking.withdrawStake(founderShares);
    const stakerOneWithdrawBlockNumber = await ethers.provider.getBlockNumber();
    const stakerOneGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      founder.address
    );

    const stakerShares = await staking.sharesOf(staker.address);
    await staking.connect(staker).withdrawStake(stakerShares);
    const stakerTwoGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      staker.address
    );

    const signer0Shares = await staking.sharesOf(signers[0].address);
    await staking.connect(signers[0]).withdrawStake(signer0Shares);
    const stakerThreeGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      signers[0].address
    );

    const signer1Shares = await staking.sharesOf(signers[1].address);

    await staking.connect(signers[1]).withdrawStake(signer1Shares);
    const stakerFourGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      signers[1].address
    );
    const stakerOneRewardsCalculated = rewardsPerBlock
      .add(
        rewardsPerBlock.mul(founderShares).div(founderShares.add(stakerShares))
      )
      .add(
        rewardsPerBlock
          .mul(founderShares)
          .div(founderShares.add(stakerShares).add(signer0Shares))
      )
      .add(
        rewardsPerBlock
          .mul(founderShares)
          .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
          .div(totalShares)
      )
      .add(BN.from("2"));

    const stakerTwoRewardsCalculated = rewardsPerBlock
      .mul(stakerShares)
      .div(founderShares.add(stakerShares))
      .add(
        rewardsPerBlock
          .mul(stakerShares)
          .div(founderShares.add(stakerShares).add(signer0Shares))
      )
      .add(
        rewardsPerBlock
          .mul(stakerShares)
          .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
          .div(totalShares)
      )
      .add(
        rewardsPerBlock
          .mul(stakerShares)
          .div(stakerShares.add(signer0Shares).add(signer1Shares))
      )
      .add(BN.from("1"));

    const stakerThreeRewardsCalculated = rewardsPerBlock
      .mul(signer0Shares)
      .div(founderShares.add(stakerShares).add(signer0Shares))
      .add(
        rewardsPerBlock
          .mul(signer0Shares)
          .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
          .div(totalShares)
      )
      .add(
        rewardsPerBlock
          .mul(signer0Shares)
          .div(stakerShares.add(signer0Shares).add(signer1Shares))
      )
      .add(
        rewardsPerBlock.mul(signer0Shares).div(signer0Shares.add(signer1Shares))
      )
      .add(BN.from("2"));

    const stakerFourRewardsCalculated = rewardsPerBlock
      .mul(signer1Shares)
      .mul(stakerOneWithdrawBlockNumber - stakerFourStakeBlockNumber)
      .div(totalShares)
      .add(
        rewardsPerBlock
          .mul(signer1Shares)
          .div(stakerShares.add(signer0Shares).add(signer1Shares))
      )
      .add(
        rewardsPerBlock.mul(signer1Shares).div(signer0Shares.add(signer1Shares))
      )
      .add(rewardsPerBlock)
      .add(BN.from("1"));
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

  it("it should get staking reward even when stake amount is low", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);

    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    const stakingAmount = BN.from("10000");
    await goodDollar.mint(founder.address, stakingAmount);
    await goodDollar.mint(staker.address, stakingAmount);
    await goodDollar.approve(staking.address, stakingAmount);
    await goodDollar.connect(staker).approve(staking.address, stakingAmount);
    await staking.stake(stakingAmount);
    const stakerOneGDAOBalanceAfterStake = await grep.balanceOfLocal(
      founder.address
    );
    const stakerTwoStakeBlockNumber =
      (await ethers.provider.getBlockNumber()) + 1;
    await staking.connect(staker).stake(2);
    const stakerTwoGDAOBalanceAfterStake = await grep.balanceOfLocal(
      staker.address
    );
    await advanceBlocks(10);

    const staker1Shares = await staking.sharesOf(founder.address);
    const staker2Shares = await staking.sharesOf(staker.address);
    await staking
      .connect(staker)
      .withdrawStake(await staking.sharesOf(staker.address));
    const stakerTwoWithdrawBlockNumber = await ethers.provider.getBlockNumber();

    await staking.withdrawStake(await staking.sharesOf(founder.address));

    const stakerOneGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      founder.address
    );
    const stakerTwoGDAOBalanceAfterWithdraw = await grep.balanceOfLocal(
      staker.address
    );
    const calculatedRewardsStakerOne = rewardsPerBlock
      .add(
        rewardsPerBlock
          .mul(staker1Shares)
          .mul(stakerTwoWithdrawBlockNumber - stakerTwoStakeBlockNumber)
          .div(staker1Shares.add(staker2Shares))
      )
      .add(rewardsPerBlock);

    const calculatedRewardsStakerTwo = rewardsPerBlock
      .mul(staker2Shares)
      .mul(stakerTwoWithdrawBlockNumber - stakerTwoStakeBlockNumber)
      .div(staker1Shares.add(staker2Shares))
      .add(BN.from("1"));

    expect(stakerOneGDAOBalanceAfterWithdraw).to.be.equal(
      stakerOneGDAOBalanceAfterStake.add(calculatedRewardsStakerOne)
    );
    expect(stakerTwoGDAOBalanceAfterWithdraw).to.be.equal(
      stakerTwoGDAOBalanceAfterStake.add(calculatedRewardsStakerTwo).sub(1)
    );
  });

  it("it should mint rewards properly when withdrawRewards", async () => {
    const { staking } = await waffle.loadFixture(fixture_ready);
    await goodDollar.mint(founder.address, "200");
    const rewardsPerBlock = (await staking.getRewardsPerBlock())[0];
    await goodDollar.approve(staking.address, "200");

    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1;
    await staking.stake("200");
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
    await staking.stake("100");
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
