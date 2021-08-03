import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import {
  UBIScheme,
  GoodReserveCDai,
  GoodMarketMaker,
  GoodFundManager,
} from "../../types";
import {
  createDAO,
  deployUBI,
  advanceBlocks,
  increaseTime,
  deployUniswap,
  getStakingFactory,
} from "../helpers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
export const NULL_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const NETWORK = "test";
const MAX_INACTIVE_DAYS = 15;
export const BLOCK_INTERVAL = 30;
async function proposeAndRegister(
  addr,
  registrar,
  proposalId,
  absoluteVote,
  avatarAddress,
  fnd
) {
  const transaction = await registrar.proposeScheme(
    avatarAddress,
    addr,
    NULL_HASH,
    "0x00000010",
    NULL_HASH
  );
  proposalId = transaction.logs[0].args._proposalId;
  const voteResult = await absoluteVote.vote(proposalId, 1, 0, fnd);
  return voteResult.logs.some((e) => e.event === "ExecuteProposal");
}

describe("UBIScheme - network e2e tests", () => {
  let dai,
    cDAI,
    simpleStaking,
    goodReserve,
    goodFundManager,
    goodDollar,
    controller,
    ubi,
    firstClaimPool,
    identity,
    claimer,
    fisherman,
    founder,
    signers,
    schemeMock,
    comp,
    marketMaker: GoodMarketMaker;
  let avatar,
    registrar,
    absoluteVote,
    proposalId,
    setReserve,
    addMinter,
    setDAOAddress,
    nameService,
    initializeToken,
    daiUsdOracle,
    gasFeeOracle,
    daiEthOracle,
    ethUsdOracle;

  before(async function () {
    [founder, claimer, fisherman, ...signers] = await ethers.getSigners();

    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const goodCompoundStakingFactory = await getStakingFactory(
      "GoodCompoundStaking"
    );
    const deployedDAO = await createDAO();
    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      identityDeployed,
      daoCreator,
      nameService: ns,
      setDAOAddress: sda,
      setSchemes,
      marketMaker: mm,
      daiAddress,
      cdaiAddress,
      reserve,
      setReserveToken,
      addWhitelisted,
    } = deployedDAO;

    const uniswap = await deployUniswap();
    await sda("UNISWAP_ROUTER", uniswap.router.address);
    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    avatar = av;
    marketMaker = mm;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    initializeToken = setReserveToken;
    goodReserve = reserve as GoodReserveCDai;
    const tokenUsdOracleFactory = await ethers.getContractFactory(
      "BatUSDMockOracle"
    );
    const compUsdOracleFactory = await ethers.getContractFactory(
      "CompUSDMockOracle"
    );
    const compUsdOracle = await compUsdOracleFactory.deploy();
    daiUsdOracle = await tokenUsdOracleFactory.deploy();
    const daiFactory = await ethers.getContractFactory("DAIMock");
    comp = await daiFactory.deploy();
    await setDAOAddress("COMP", comp.address);
    simpleStaking = await goodCompoundStakingFactory
      .deploy()
      .then(async (contract) => {
        await contract.init(
          dai.address,
          cDAI.address,
          nameService.address,
          "Good DAI",
          "gDAI",
          "172800",
          daiUsdOracle.address,
          compUsdOracle.address,
          []
        );
        return contract;
      });

    goodFundManager = (await upgrades.deployProxy(
      goodFundManagerFactory,
      [nameService.address],
      {
        kind: "uups",
      }
    )) as GoodFundManager;
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address,
    });

    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

    const ubiScheme = await deployUBI(deployedDAO);
    ubi = ubiScheme.ubiScheme;
    firstClaimPool = ubiScheme.firstClaim;
    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);
    await goodReserve.setAddresses();
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const encodedData = goodFundManagerFactory.interface.encodeFunctionData(
      "setStakingReward",
      [
        "1000",
        simpleStaking.address,
        currentBlockNumber - 5,
        currentBlockNumber + 1000,
        false,
      ] // set 10 gd per block
    );

    const gasFeeMockFactory = await ethers.getContractFactory(
      "GasPriceMockOracle"
    );
    gasFeeOracle = await gasFeeMockFactory.deploy();
    const daiEthPriceMockFactory = await ethers.getContractFactory(
      "DaiEthPriceMockOracle"
    );
    daiEthOracle = await daiEthPriceMockFactory.deploy();

    const ethUsdOracleFactory = await ethers.getContractFactory(
      "EthUSDMockOracle"
    );
    ethUsdOracle = await ethUsdOracleFactory.deploy();

    await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    console.log("staking reward set...");
    await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    let amount = 1e8;
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("1000")
    );
    dai.approve(simpleStaking.address, ethers.utils.parseEther("1000"));
    await simpleStaking.stake(ethers.utils.parseEther("1000"), 0, false);
    await cDAI["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("1000", 8)
    );
    await cDAI.approve(goodReserve.address, amount);
    await goodReserve.buy(amount, 0, NULL_ADDRESS);
    let gdbalance = await goodDollar.balanceOf(founder.address);
    await goodDollar.transfer(firstClaimPool.address, gdbalance.toString());
    // transfers funds to the ubi
    await cDAI.increasePriceWithMultiplier("10000"); // Generate some interests
    await goodFundManager.collectInterest([simpleStaking.address]);

    await addWhitelisted(claimer.address, "claimer1");
  });

  it("should award a new user with the award amount on first time execute claim", async () => {
    await increaseTime(86400);
    let claimerBalance1 = await goodDollar.balanceOf(claimer.address);
    let ce = await ubi.connect(claimer).checkEntitlement();
    await ubi.connect(claimer).claim();
    let claimerBalance2 = await goodDollar.balanceOf(claimer.address);
    expect(claimerBalance2.sub(claimerBalance1).toNumber()).to.be.equal(
      ce.toNumber()
    );
  });

  it("should not be able to fish an active user", async () => {
    let error = await ubi
      .connect(fisherman)
      .fish(claimer.address)
      .catch((e) => e);
    await goodDollar.balanceOf(fisherman.address);
    expect(error.message).to.have.string("is not an inactive user");
  });

  it("should be able to fish inactive user", async () => {
    await increaseTime(MAX_INACTIVE_DAYS * 86700);
    let balance1 = await goodDollar.balanceOf(fisherman.address);
    await ubi.connect(fisherman).fish(claimer.address);
    let isFished = await ubi.fishedUsersAddresses(claimer.address);
    let balance2 = await goodDollar.balanceOf(fisherman.address);
    let dailyUbi = await ubi.dailyUbi();
    expect(isFished).to.be.true;
    expect(balance2.toNumber() - balance1.toNumber()).to.be.equal(
      dailyUbi.toNumber()
    );
  });

  it("should not be able to fish the same user twice", async () => {
    let error = await ubi
      .connect(fisherman)
      .fish(claimer.address)
      .catch((e) => e);
    expect(error.message).to.have.string("already fished");
  });

  it("should recieves a claim reward when call claim after being fished", async () => {
    let activeUsersCountBefore = await ubi.activeUsersCount();
    let claimerBalanceBefore = await goodDollar.balanceOf(claimer.address);
    await ubi.connect(claimer).claim();
    let claimerBalanceAfter = await goodDollar.balanceOf(claimer.address);
    let activeUsersCountAfter = await ubi.activeUsersCount();
    expect(
      activeUsersCountAfter.toNumber() - activeUsersCountBefore.toNumber()
    ).to.be.equal(1);
    expect(
      claimerBalanceAfter.toNumber() - claimerBalanceBefore.toNumber()
    ).to.be.equal(1000);
  });

  it("should be able to fish by calling fishMulti", async () => {
    await increaseTime(MAX_INACTIVE_DAYS * 86700);
    let amount = 1e8;
    await dai["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseEther("1000")
    );
    dai.approve(cDAI.address, ethers.utils.parseEther("1000"));
    await cDAI["mint(address,uint256)"](
      founder.address,
      ethers.utils.parseUnits("1000", 8)
    );
    await cDAI.approve(goodReserve.address, amount);
    await goodReserve.buy(amount, 0, NULL_ADDRESS);
    let gdbalance = await goodDollar.balanceOf(founder.address);
    await goodDollar.transfer(
      firstClaimPool.address,
      Math.floor(gdbalance.toNumber() / 2).toString()
    );
    await goodDollar.transfer(
      ubi.address,
      Math.floor(gdbalance.toNumber() / 2).toString()
    );
    let balanceBefore = await goodDollar.balanceOf(fisherman.address);
    await ubi.connect(fisherman).fishMulti([claimer.address]);
    let balanceAfter = await goodDollar.balanceOf(fisherman.address);
    let dailyUbi = await ubi.dailyUbi();
    expect(balanceAfter.toNumber() - balanceBefore.toNumber()).to.be.equal(
      dailyUbi.toNumber()
    );
  });
});
