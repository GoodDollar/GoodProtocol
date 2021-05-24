import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  SimpleStaking,
  GReputation
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("GovernanceStaking - staking with GD  and get Rewards in GDAO", () => {
  let dai: Contract;
  let cDAI: Contract;
  let goodReserve: GoodReserveCDai;
  let governanceStaking: Contract;
  let goodFundManager: Contract;
  let grep: GReputation;
  let avatar,
    goodDollar,
    identity,
    marketMaker: GoodMarketMaker,
    contribution,
    controller,
    founder,
    staker,
    staker2,
    schemeMock,
    signers,
    nameService,
    initializeToken,
    setDAOAddress;

  before(async () => {
    [founder, staker, staker2, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      daoCreator,
      nameService: ns,
      setDAOAddress: sda,
      setSchemes,
      marketMaker: mm,
      daiAddress,
      cdaiAddress,
      reserve,
      reputation,
      setReserveToken
    } = await createDAO();
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    initializeToken = setReserveToken;
    goodReserve = reserve as GoodReserveCDai;
    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar
    });
    goodFundManager = await goodFundManagerFactory.deploy(nameService.address);
    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address
    });
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    contribution = await ethers.getContractAt(
      ContributionCalculation.abi,
      await nameService.getAddress("CONTRIBUTION_CALCULATION")
    );

    marketMaker = mm;

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });

    console.log("setting permissions...");
    governanceStaking = await governanceStakingFactory.deploy(
      nameService.address
    );

    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();

    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
  });

  it("Should not mint reward when staking contract is not minter ", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(5);
    const error = await governanceStaking.withdrawStake("100").catch(e => e);
    expect(error.message).to.have.string(
      "GReputation: need minter role or be GDAO contract"
    );
  });

  it("Should be able mint rewards after set GDAO staking contract", async () => {
    await setDAOAddress("GDAO_STAKING", governanceStaking.address);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);

    expect(GDAOBalanceAfterWithdraw).to.gt(GDAOBalanceBeforeWithdraw);
  });

  it("Avatar should be able to change rewards per block", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      [ethers.utils.parseEther("1728000")]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
    const rewardsPerBlock = await governanceStaking.rewardsPerBlock()
    expect(rewardsPerBlock).to.equal(
      ethers.utils.parseEther("1728000").div(BN.from("518400"))
    );
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const withdrawBlockNumber = await ethers.provider.getBlockNumber()
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(GDAOBalanceAfterWithdraw).to.be.equal(GDAOBalanceBeforeWithdraw.add(rewardsPerBlock.mul(withdrawBlockNumber - stakeBlockNumber)))
    encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      [ethers.utils.parseEther("12000000")]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
  });

  it("Should be able to withdraw rewards without withdraw stake", async () => {
    const rewardsPerBlock = await governanceStaking.rewardsPerBlock()
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    const transaction = await (
      await governanceStaking.withdrawRewards()
    ).wait();
    const withdrawBlockNumber = await ethers.provider.getBlockNumber()
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(
      GDAOBalanceAfterWithdraw).to.be.equal(GDAOBalanceBeforeWithdraw.add(rewardsPerBlock.mul(withdrawBlockNumber - stakeBlockNumber)));
    expect(transaction.events.find(_ => _.event === "RewardsWithdraw")).to.be
      .not.empty;
    await governanceStaking.withdrawStake("100");
  });

  it("Should be able to withdraw transferred stakes", async () => {
    await goodDollar.mint(staker.address, "100");
    await goodDollar.connect(staker).approve(governanceStaking.address, "100");
    await governanceStaking.connect(staker).stake("100");
    await advanceBlocks(4);
    await governanceStaking.connect(staker).transfer(founder.address, "100");
    await governanceStaking.connect(staker).withdrawRewards();
    const gdaoBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const gdaoBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(gdaoBalanceAfterWithdraw).to.gt(gdaoBalanceBeforeWithdraw);
  });

  it("should not be able to withdraw after they send their stake to somebody else", async () => {
    let transaction = await governanceStaking
      .connect(staker)
      .withdrawStake("100")
      .catch(e => e);
    expect(transaction.message).to.have.string("Not enough token staked");
  });

  it("it should distribute reward with correct precision", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      ["17280000000000000000"] // Give 0.0001 GDAO per block so 17.28 GDAO per month
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
    const rewardsPerBlock = await governanceStaking.rewardsPerBlock()
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    const stakeBlockNumber = (await ethers.provider.getBlockNumber()) + 1
    await governanceStaking.stake("100");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const withdrawBlockNumber = await ethers.provider.getBlockNumber()
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(GDAOBalanceAfterWithdraw).to.be.equal(GDAOBalanceBeforeWithdraw.add(rewardsPerBlock.mul(withdrawBlockNumber - stakeBlockNumber)));
  });

  it("it should not generate rewards when rewards per block set to 0", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    let encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      ["0"] // Give 0 GDAO per block
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);

    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    const userProductivity = await governanceStaking.getProductivity(founder.address)
    expect(userProductivity[0]).to.be.equal(BN.from("100"))
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("100");
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw)).to.equal(0);
    encodedCall = governanceStakingFactory.interface.encodeFunctionData(
      "setMonthlyRewards",
      [ethers.utils.parseEther("12000000")]
    );
    await ictrl.genericCall(governanceStaking.address, encodedCall, avatar, 0);
  });

  it("it should return productivity values correctly", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    const productivityValue = await governanceStaking.getProductivity(
      founder.address
    );

    expect(productivityValue[0].toString()).to.be.equal("100");
    expect(productivityValue[1].toString()).to.be.equal("100");
    await governanceStaking.withdrawStake("100");
  });

  it("it should return earned rewards with pending ones properly", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await advanceBlocks(5);
    const totalEarned = await governanceStaking.getUserPendingReward(
      founder.address
    );
    expect(totalEarned.toString()).to.be.equal("115740740740740740740");
    await governanceStaking.withdrawStake("100");
  });

  it("Accumulated per share has enough precision when reward << totalproductivity", async () => {
    await goodDollar.mint(founder.address, "100000000000000"); // 1 trillion gd stake
    await goodDollar.approve(governanceStaking.address, "1000000000000");
    await governanceStaking.stake("1000000000000");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(founder.address);
    await governanceStaking.withdrawStake("1000000000000");
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(founder.address);
    expect(
      GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()
    ).to.be.equal("115740740740740740740");
  });

  it("user receive fractional gdao properly when his stake << totalProductivity", async () => {
    await goodDollar.mint(founder.address, "800"); // 8gd
    await goodDollar.mint(staker.address, "200"); // 2gd
    await goodDollar.approve(governanceStaking.address, "800");
    await goodDollar.connect(staker).approve(governanceStaking.address, "200");
    await governanceStaking.stake("800");
    await governanceStaking.connect(staker).stake("200");
    await advanceBlocks(4);
    const GDAOBalanceBeforeWithdraw = await grep.balanceOf(staker.address);
    const FounderGDAOBalanceBeforeWithdraw = await grep.balanceOf(
      founder.address
    );
    await governanceStaking.withdrawStake("800");
    await governanceStaking.connect(staker).withdrawStake("200");
    const GDAOBalanceAfterWithdraw = await grep.balanceOf(staker.address);
    const FounderGDAOBalanceAfterWithdraw = await grep.balanceOf(
      founder.address
    );

    expect(
      FounderGDAOBalanceAfterWithdraw.sub(
        FounderGDAOBalanceBeforeWithdraw
      ).toString()
    ).to.be.equal("115740740740740740740");
    expect(
      GDAOBalanceAfterWithdraw.sub(GDAOBalanceBeforeWithdraw).toString()
    ).to.be.equal("46296296296296296296"); // it gets full amount of rewards for 1 block plus 1/5 of amounts for 5 blocks so 69444444444444444444 + 69444444444444444444
  });

  it("it should be able to tranfer tokens when user approve", async () => {
    await goodDollar.mint(founder.address, "100");
    await goodDollar.approve(governanceStaking.address, "100");
    await governanceStaking.stake("100");
    await governanceStaking.approve(staker.address, "100");
    await governanceStaking
      .connect(staker)
      .transferFrom(founder.address, staker.address, "100");

    expect(await governanceStaking.balanceOf(founder.address)).to.equal(0);
    expect(await governanceStaking.balanceOf(staker.address)).to.equal(100);

    expect((await governanceStaking.users(staker.address)).amount).to.equal(
      100
    );
  });

  it("it should return staker data", async () => {
    await goodDollar.mint(staker2.address, "100");
    await goodDollar.connect(staker2).approve(governanceStaking.address, "100");
    await governanceStaking.connect(staker2).stake("100");

    await advanceBlocks(10);

    expect((await governanceStaking.users(staker2.address)).rewardDebt).to.gt(
      0
    ); //debt should start according to accumulated rewards in contract. debt is the user stake starting point.

    await governanceStaking.connect(staker2).withdrawStake("1");

    expect(await governanceStaking.balanceOf(staker2.address)).to.equal(99);

    expect((await governanceStaking.users(staker2.address)).amount).to.equal(
      99
    );
    expect((await governanceStaking.users(staker2.address)).rewardDebt).to.gt(
      0
    ); //should have withdrawn rewards after withdraw stake
    expect(
      (await governanceStaking.users(staker2.address)).rewardEarn
    ).to.equal(0); //should have 0 pending rewards after withdraw stake

    await advanceBlocks(10);
    await goodDollar.connect(staker2).approve(governanceStaking.address, "200");

    await governanceStaking.connect(staker2).stake("1"); //should calculate user pending rewards

    expect(
      (await governanceStaking.users(staker2.address)).rewardEarn
    ).to.be.equal(
      0 //should have 0 rewardEarned because every action, like the above stake withdraws gdao rewards
    );
    await advanceBlocks(2); // pass some blocks
    const userPendingReward = await governanceStaking.getUserPendingReward(
      staker2.address
    );
    expect(userPendingReward).to.be.gt(0);
  });

  it("it should return zero rewards when totalProductiviy is zero", async () => {
    let userPendingRewards = await governanceStaking.getUserPendingReward(
      staker.address
    );
    expect(userPendingRewards).to.be.gt(0);
    await governanceStaking.connect(staker).withdrawRewards();
    userPendingRewards = await governanceStaking.getUserPendingReward(
      staker.address
    );
    expect(userPendingRewards).to.be.gt(0); //withdrawrewards mines a block so pending will still not be 0.

    await governanceStaking.connect(staker).withdrawStake(0);
    userPendingRewards = await governanceStaking.getUserPendingReward(
      staker.address
    );
    expect(userPendingRewards).to.be.equal(0);
  });

  it("it should calculate accumulated rewards per share correctly", async () => {
    const governanceStakingFactory = await ethers.getContractFactory(
      "GovernanceStaking"
    );
    const simpleGovernanceStaking = await governanceStakingFactory.deploy(
      nameService.address
    );
    await setDAOAddress("GDAO_STAKING", simpleGovernanceStaking.address);
    await goodDollar.mint(founder.address, "200");
    await goodDollar.mint(staker.address, "200");

    await goodDollar.approve(simpleGovernanceStaking.address, "200");
    await goodDollar
      .connect(staker)
      .approve(simpleGovernanceStaking.address, "200");

    await simpleGovernanceStaking.stake("100");
    let accumulatedRewardsPerShare = await simpleGovernanceStaking.totalRewardsPerShare();
    expect(accumulatedRewardsPerShare).to.equal(0); //first has no accumulated rewards yet, since no blocks have passed since staking

    await simpleGovernanceStaking.stake("100");
    accumulatedRewardsPerShare = await simpleGovernanceStaking.totalRewardsPerShare();
    expect(await simpleGovernanceStaking.rewardsPerBlock()).to.equal(
      ethers.utils
        .parseEther("2000000") //2M reputation
        .div(await simpleGovernanceStaking.FUSE_MONTHLY_BLOCKS())
    );
    let totalProductiviy = BN.from("100");
    //totalRewardsPerShare is in 1e27 , divid by  1e9 to get 1e18 decimals
    expect(accumulatedRewardsPerShare.div(BN.from(1e9))).to.equal(
      ethers.utils
        .parseEther("2000000")
        .mul(BN.from(1e2)) //G$ is 2 decimals, dividing reduces decimals by 2, so we first increase to 1e20 decimals
        .div(await simpleGovernanceStaking.FUSE_MONTHLY_BLOCKS())
        .div(totalProductiviy)
        .mul(BN.from("1")),
      "1 block"
    ); //1 block passed with actual staking

    totalProductiviy = totalProductiviy.add(BN.from("100")); //second stake
    await simpleGovernanceStaking.connect(staker).stake("100");
    let accumulatedRewardsPerShare2 = await simpleGovernanceStaking.totalRewardsPerShare();

    //shouldnt be naive accumlattion of 2 blocks, since total productivity has changed between blocks
    expect(accumulatedRewardsPerShare2.div(BN.from(1e9))).to.not.equal(
      ethers.utils
        .parseEther("2000000")
        .mul(BN.from(1e2)) //G$ is 2 decimals, dividing reduces decimals by 2, so we first increase to 1e20 decimals
        .div(await simpleGovernanceStaking.FUSE_MONTHLY_BLOCKS())
        .div(totalProductiviy)
        .mul(BN.from("2")),
      "2 blocks"
    ); //2 blocks passed but now we have 200 total productivity before 3rd stake

    console.log(
      accumulatedRewardsPerShare2.toString(),
      accumulatedRewardsPerShare.toString()
    );

    //accumulated so far plus block accumulation
    expect(accumulatedRewardsPerShare2.div(BN.from(1e9))).to.equal(
      ethers.utils
        .parseEther("2000000")
        .mul(BN.from(1e2)) //G$ is 2 decimals, dividing reduces decimals by 2, so we first increase to 1e20 decimals
        .div(await simpleGovernanceStaking.FUSE_MONTHLY_BLOCKS())
        .div(totalProductiviy)
        .add(accumulatedRewardsPerShare.div(BN.from(1e9))),
      "2 blocks correct"
    );
    await setDAOAddress("GDAO_STAKING", governanceStaking.address);
  });

  it("Staking tokens should be 2 decimals", async () => {
    const decimals = await governanceStaking.decimals();
    expect(decimals.toString()).to.be.equal("2");
  });

  it("Stake amount should be positive", async () => {
    const tx = await governanceStaking.stake("0").catch(e => e);
    expect(tx.message).to.have.string(
      "You need to stake a positive token amount"
    );
  });

  it("It should approve stake amount in order to stake", async () => {
    const tx = await governanceStaking
      .stake(ethers.utils.parseEther("10000000"))
      .catch(e => e);
    expect(tx.message).not.to.be.empty;
  });

  it("Withdraw 0 should withdraw everything", async () => {
    await expect(governanceStaking.withdrawStake("0")).to.revertedWith(
      "positive amount"
    );
  });

  it("Should use overriden _transfer that handles productivity when using transferFrom which is defined in super erc20 contract", async () => {
    const tx = await governanceStaking
      .transferFrom(
        founder.address,
        staker.address,
        ethers.utils.parseEther("10000000")
      )
      .catch(e => e);
    expect(tx.message).to.have.string("INSUFFICIENT_PRODUCTIVITY");
  });
});
