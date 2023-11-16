import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import {
  GoodReserveCDai,
  DistributionBridgeMock,
  IGoodDollar
} from "../../types";
import { createDAO } from "../helpers";

export const NULL_ADDRESS = ethers.constants.AddressZero;

xdescribe("BuyAndBridgeHelper ", () => {
  let goodReserve: GoodReserveCDai;
  let goodDollar: IGoodDollar,
    deployedDAO,
    genericCall,
    avatar,
    founder,
    signers,
    setDAOAddress,
    nameService,
    cDai;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();

    deployedDAO = await loadFixture(createDAO);

    nameService = deployedDAO.nameService;
    genericCall = deployedDAO.genericCall;
    cDai = deployedDAO.cdaiAddress;
    avatar = deployedDAO.avatar;
    setDAOAddress = deployedDAO.setDAOAddress;
    const gd = deployedDAO.gd;
    const identity = deployedDAO.identity;

    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      avatar,
      cDai
    });

    goodDollar = (await ethers.getContractAt("IGoodDollar", gd)) as IGoodDollar;

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });

    goodReserve = deployedDAO.reserve as GoodReserveCDai;
  });

  const fixture = async () => {
    const df = await ethers.getContractFactory("DistributionHelperTestHelper");
    const rf = await ethers.getContractFactory("DistributionBridgeMock");

    await setDAOAddress("UNISWAP_ROUTER", signers[0].address);

    const exchangeHelperFactory = await ethers.getContractFactory(
      "ExchangeHelper"
    );
    const bnbFactory = await ethers.getContractFactory("BuyAndBridgeHelper");

    const exchangeHelper = await upgrades.deployProxy(
      exchangeHelperFactory,
      [nameService.address],
      { kind: "uups" }
    );

    await setDAOAddress("EXCHANGE_HELPER", exchangeHelper.address);

    const bridge = (await rf.deploy()) as DistributionBridgeMock;

    await setDAOAddress("MULTICHAIN_ROUTER", bridge.address);
    await setDAOAddress("BRIDGE_CONTRACT", bridge.address);
    await exchangeHelper.setAddresses();
    const bnb = await bnbFactory.deploy(exchangeHelper.address);

    return { exchangeHelper: bnb, bridge };
  };

  it("should have contracts updated", async () => {
    const { exchangeHelper, bridge } = await loadFixture(fixture);

    expect(await exchangeHelper.gd()).equal(goodDollar.address);
    expect(await exchangeHelper.fuseBridge()).equal(bridge.address);
    expect(await exchangeHelper.multiChainBridge()).equal(bridge.address);
    expect(await exchangeHelper.anyGoodDollar()).equal(
      ethers.constants.AddressZero
    );
  });

  it("should buy and bridge to Fuse", async () => {
    const { exchangeHelper, bridge } = await loadFixture(fixture);
    let daiAmount = ethers.utils.parseEther("100");
    const dai = await ethers.getContractAt("DAIMock", deployedDAO.daiAddress);

    // const cdaiRateStored = await cDAI.exchangeRateStored();
    await dai["mint(uint256)"](daiAmount);
    await dai.approve(exchangeHelper.address, daiAmount);

    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const daiBalanceBefore = await dai.balanceOf(founder.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    const gdxBalanceBefore = await goodReserve.balanceOf(founder.address);

    let transaction = await (
      await exchangeHelper.buyAndBridge(
        {
          buyPath: [dai.address],
          tokenAmount: daiAmount,
          minReturn: 0,
          minDAIAmount: 0,
          targetAddress: NULL_ADDRESS
        },
        122
      )
    ).wait();
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const daiBalanceAfter = await dai.balanceOf(founder.address);
    const helperBalanceAfter = await dai.balanceOf(exchangeHelper.address);
    const priceAfter = await goodReserve["currentPrice()"]();
    const gdxBalanceAfter = await goodReserve.balanceOf(founder.address);
    const bridgeBalanceAfter = await goodDollar.balanceOf(bridge.address);
    const helperGdBalanceAfter = await goodDollar.balanceOf(
      exchangeHelper.address
    );

    expect(helperGdBalanceAfter).eq(0); //G$s should be at the fuse bridge
    expect(helperBalanceAfter).equal(0);
    expect(bridgeBalanceAfter).gt(0); //G$s should be at the fuse bridge

    expect(gdBalanceAfter.eq(gdBalanceBefore)).to.be.true; //should not receive any G$s
    expect(gdxBalanceAfter.gt(gdxBalanceBefore)).to.be.true; //should receive the GDX
    expect(daiBalanceBefore.gt(daiBalanceAfter)).to.be.true;
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());

    const events = await bridge.queryFilter(bridge.filters.OnToken());
    expect(events[0].args.sender).to.equal(exchangeHelper.address);
    expect(events[0].args.amount).gt(0);
    expect(events[0].args.data).to.equal(founder.address.toLowerCase());
  });

  xit("should buy and bridge to Celo", async () => {
    const { exchangeHelper, bridge } = await loadFixture(fixture);
    let daiAmount = ethers.utils.parseEther("100");
    const dai = await ethers.getContractAt("DAIMock", deployedDAO.daiAddress);

    // const cdaiRateStored = await cDAI.exchangeRateStored();
    await dai["mint(uint256)"](daiAmount);
    await dai.approve(exchangeHelper.address, daiAmount);

    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const daiBalanceBefore = await dai.balanceOf(founder.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    const gdxBalanceBefore = await goodReserve.balanceOf(founder.address);

    let transaction = await (
      await exchangeHelper.buyAndBridge(
        {
          buyPath: [dai.address],
          tokenAmount: daiAmount,
          minReturn: 0,
          minDAIAmount: 0,
          targetAddress: NULL_ADDRESS
        },
        42220
      )
    ).wait();
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const daiBalanceAfter = await dai.balanceOf(founder.address);
    const helperBalanceAfter = await dai.balanceOf(exchangeHelper.address);

    const priceAfter = await goodReserve["currentPrice()"]();
    const gdxBalanceAfter = await goodReserve.balanceOf(founder.address);
    const bridgeBalanceAfter = await goodDollar.balanceOf(bridge.address);
    const helperGdBalanceAfter = await goodDollar.balanceOf(
      exchangeHelper.address
    );

    expect(helperGdBalanceAfter).gt(0); //in case of the mock it doesnt call transferFrom, so bought G$s stay in helper when testing multichain
    expect(helperBalanceAfter).equal(0);
    expect(bridgeBalanceAfter).eq(0); //in case of multichain the G$s stay with the helper

    expect(gdBalanceAfter.eq(gdBalanceBefore)).to.be.true; //should not receive any G$s
    expect(gdxBalanceAfter.gt(gdxBalanceBefore)).to.be.true; //should receive the GDX
    expect(daiBalanceBefore.gt(daiBalanceAfter)).to.be.true;
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());

    const events = await bridge.queryFilter(bridge.filters.AnySwap());
    expect(events[0].args.token).to.equal(await exchangeHelper.anyGoodDollar());
    expect(events[0].args.recipient).to.equal(founder.address);
    expect(events[0].args.amount).gt(0);
    expect(events[0].args.chainId).to.equal(42220);
  });

  it("should fail to buy with unsupported target chain", async () => {
    const { exchangeHelper, bridge } = await loadFixture(fixture);
    expect(await exchangeHelper.CELO()).equal(42220);
    expect(await exchangeHelper.FUSE()).equal(122);
    let daiAmount = ethers.utils.parseEther("100");
    const dai = await ethers.getContractAt("DAIMock", deployedDAO.daiAddress);

    // const cdaiRateStored = await cDAI.exchangeRateStored();
    await dai["mint(uint256)"](daiAmount);
    await dai.approve(exchangeHelper.address, daiAmount);

    await expect(
      exchangeHelper.buyAndBridge(
        {
          buyPath: [dai.address],
          tokenAmount: daiAmount,
          minReturn: 0,
          minDAIAmount: 0,
          targetAddress: NULL_ADDRESS
        },
        12
      )
    ).revertedWith(/chain/);
  });

  it("should fail only in tests on uniswap call when buying with ether", async () => {
    const { exchangeHelper, bridge } = await loadFixture(fixture);
    expect(await exchangeHelper.CELO()).equal(42220);
    expect(await exchangeHelper.FUSE()).equal(122);
    let daiAmount = ethers.utils.parseEther("100");
    const dai = await ethers.getContractAt("DAIMock", deployedDAO.daiAddress);

    // const cdaiRateStored = await cDAI.exchangeRateStored();
    await dai["mint(uint256)"](daiAmount);
    await dai.approve(exchangeHelper.address, daiAmount);

    await expect(
      exchangeHelper.buyAndBridge(
        {
          buyPath: [NULL_ADDRESS, dai.address],
          tokenAmount: daiAmount,
          minReturn: 0,
          minDAIAmount: 0,
          targetAddress: NULL_ADDRESS
        },
        122,
        { value: daiAmount }
      )
    ).revertedWith(/Transaction reverted: function/);
  });
});
