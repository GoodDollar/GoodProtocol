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

describe("StakersDistribution - staking with GD  and get Rewards in GDAO", () => {
  let dai: Contract;
  let cDAI: Contract;
  let goodReserve: GoodReserveCDai;
  let stakersDistribution: Contract;
  let goodFundManager: Contract;
  let simpleStaking: Contract;
  let grep: GReputation;
  let avatar,
    goodDollar,
    identity,
    marketMaker: GoodMarketMaker,
    contribution,
    controller,
    founder,
    staker,
    schemeMock,
    signers,
    nameService,
    initializeToken,
    setDAOAddress,
    daiEthOracle,
    ethUsdOracle,
    gasFeeOracle,
    daiUsdOracle;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const stakersDistributiongFactory = await ethers.getContractFactory(
      "StakersDistribution"
    );
    const simpleStakingFactory = await ethers.getContractFactory(
      "GoodCompoundStaking"
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
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
    const tokenUsdOracleFactory = await ethers.getContractFactory(
        "BatUSDMockOracle"
      );
      daiUsdOracle = await tokenUsdOracleFactory.deploy();
      simpleStaking = await simpleStakingFactory.deploy(
        dai.address,
        cDAI.address,
        BLOCK_INTERVAL,
        nameService.address,
        "Good DAI",
        "gDAI",
        "200",
        daiUsdOracle.address,
        "100000"
      );
      const ictrl = await ethers.getContractAt(
        "Controller",
        controller,
        schemeMock
      );
  
      const encodedData = goodFundManagerFactory.interface.encodeFunctionData(
        "setStakingReward",
        ["1000", simpleStaking.address, "1", "1000", false] // set 10 gd per block
      );
      await ictrl.genericCall(goodFundManager.address, encodedData, avatar, 0);
    stakersDistribution = await upgrades.deployProxy(
      stakersDistributiongFactory,
      [nameService.address]
    );

    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();
    const gasFeeMockFactory = await ethers.getContractFactory(
      "GasPriceMockOracle"
    );
    gasFeeOracle = await gasFeeMockFactory.deploy();
    const daiEthPriceMockFactory = await ethers.getContractFactory(
      "DaiEthPriceMockOracle"
    );

    const ethUsdOracleFactory = await ethers.getContractFactory(
      "EthUSDMockOracle"
    );
    daiEthOracle = await daiEthPriceMockFactory.deploy();
    ethUsdOracle = await ethUsdOracleFactory.deploy();
    await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
    await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
    await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
    await setDAOAddress("GDAO_STAKERS",stakersDistribution.address)
   
  });

  it("it should have 2M monthly Reputation distribution", async () => {
    const monthlyReputationDistribution = await stakersDistribution.monthlyReputationDistribution();
    expect(monthlyReputationDistribution).to.be.equal(
      ethers.utils.parseEther("2000000")
    );
  });

  it("it should have 0 monthly rewards since staking amount was zero while initializing stakersDistribution",async()=>{
    const rewardsPerBlock = await stakersDistribution.rewardsPerBlock(simpleStaking.address)
    expect(rewardsPerBlock).to.be.equal(0)
  })

  it("It should update monthly rewards according to staking amount of staking contract after one month passed from initialized",async() =>{
      const stakingAmount = ethers.utils.parseEther("1000")
      const rewardsPerBlockBeforeStake = await stakersDistribution.rewardsPerBlock(simpleStaking.address)
     
      await dai["mint(address,uint256)"](staker.address,stakingAmount.mul(2))
      await dai.connect(staker).approve(simpleStaking.address,stakingAmount.mul(2))
      await simpleStaking.connect(staker).stake(stakingAmount,0)
      await increaseTime(86700 * 30)
      await simpleStaking.connect(staker).stake(stakingAmount,0)
      const rewardsPerBlockAfterStake = await stakersDistribution.rewardsPerBlock(simpleStaking.address)
      await simpleStaking.connect(staker).withdrawStake(stakingAmount.mul(2))
      const rewardsPerBlockAfterWithdraw = await stakersDistribution.rewardsPerBlock(simpleStaking.address)
      const chainBlockPerMonth = await stakersDistribution.getChainBlocksPerMonth()
      expect(rewardsPerBlockBeforeStake).to.be.equal(BN.from("0"))
      expect(rewardsPerBlockAfterStake).to.be.equal(ethers.utils.parseEther("2000000").div(chainBlockPerMonth))
      expect(rewardsPerBlockAfterStake).to.be.equal(rewardsPerBlockAfterWithdraw)
  })

  it("it should not be set monthly reputation when not Avatar",async()=>{
    const transaction = stakersDistribution.setMonthlyReputationDistribution("1000000").catch(e=>e)
  })

  
});
