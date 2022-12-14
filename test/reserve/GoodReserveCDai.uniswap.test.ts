import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber, Contract } from "ethers";
import { expect } from "chai";
import { GoodMarketMaker, GoodReserveCDai } from "../../types";
import { createDAO, deployUniswap } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";

const MaxUint256 = ethers.constants.MaxUint256;
const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GoodReserve - buy/sell with any token through uniswap", () => {
  let dai: Contract,
    tokenA: Contract,
    tokenB: Contract,
    pair: Contract,
    ABpair: Contract,
    wethPair: Contract,
    uniswapRouter: Contract,
    comp;
  let cDAI;
  let goodReserve: Contract;
  let goodDollar,
    avatar,
    identity,
    marketMaker: GoodMarketMaker,
    exchangeHelper: Contract,
    contribution,
    controller,
    founder,
    staker,
    schemeMock,
    signers,
    setDAOAddress,
    nameService,
    initializeToken;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();

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
      setReserveToken,
      COMP
    } = await loadFixture(createDAO);

    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const daiFactory = await ethers.getContractFactory("DAIMock");
    const routerFactory = new ethers.ContractFactory(
      UniswapV2Router02.abi,
      UniswapV2Router02.bytecode,
      founder
    );
    const uniswapFactory = new ethers.ContractFactory(
      UniswapV2Factory.abi,
      UniswapV2Factory.bytecode,
      founder
    );
    const wethFactory = new ethers.ContractFactory(
      WETH9.abi,
      WETH9.bytecode,
      founder
    );

    dai = await daiFactory.deploy();

    cDAI = await cdaiFactory.deploy(dai.address);

    tokenA = await daiFactory.deploy(); // Another erc20 token for uniswap router test

    tokenB = await daiFactory.deploy(); // another erc20 for uniswap router test

    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);
    comp = COMP;
    const uniswap = await deployUniswap(comp, dai);
    uniswapRouter = uniswap.router;
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    initializeToken = setReserveToken;

    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar
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
    goodReserve = reserve;

    await setDAOAddress("UNISWAP_ROUTER", uniswapRouter.address);
    const exchangeHelperFactory = await ethers.getContractFactory(
      "ExchangeHelper"
    );
    exchangeHelper = await upgrades.deployProxy(
      exchangeHelperFactory,
      [nameService.address],
      { kind: "uups" }
    );
    await exchangeHelper.setAddresses();
    await setDAOAddress("EXCHANGE_HELPER", exchangeHelper.address);
    await uniswap.factory.createPair(tokenA.address, dai.address); // Create tokenA and dai pair
    await uniswap.factory.createPair(tokenA.address, tokenB.address);
    const pairAddress = uniswap.factory.getPair(tokenA.address, dai.address);
    const ABpairaddress = uniswap.factory.getPair(
      tokenA.address,
      tokenB.address
    );
    pair = new Contract(
      pairAddress,
      JSON.stringify(IUniswapV2Pair.abi),
      staker
    ).connect(founder);
    ABpair = new Contract(
      ABpairaddress,
      JSON.stringify(IUniswapV2Pair.abi),
      staker
    ).connect(founder);

    wethPair = uniswap.daiPairContract;
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", founder.address);
  });

  it("should returned fixed 0.0001 market price", async () => {
    const gdPrice = await goodReserve["currentPrice()"]();
    const cdaiWorthInGD = gdPrice.mul(BN.from("100000000"));
    const gdFloatPrice = gdPrice.toNumber() / 10 ** 8; //cdai 8 decimals
    expect(gdFloatPrice).to.be.equal(0.0001);
    expect(cdaiWorthInGD.toString()).to.be.equal("1000000000000"); //in 8 decimals precision
    expect(cdaiWorthInGD.toNumber() / 10 ** 8).to.be.equal(10000);
  });

  // it("should returned price of gd in tokenA", async () => {
  //   let mintAmount = ethers.utils.parseEther("100");
  //   let depositAmount = ethers.utils.parseEther("50");
  //   await dai["mint(uint256)"](mintAmount);
  //   await tokenA["mint(uint256)"](mintAmount);
  //   await addLiquidity(depositAmount, depositAmount);
  //   const gdPrice = await goodReserve["currentPrice(address)"](tokenA.address);
  //   const gdFloatPrice = gdPrice.toNumber() / 10 ** 18; //dai 18 decimals
  //   expect(gdFloatPrice).to.be.equal(0.000100706867869197);

  //   await pair.transfer(pair.address, pair.balanceOf(founder.address));
  //   await pair.burn(founder.address);
  // });

  it("should be able to buy gd with tokenA through UNISWAP", async () => {
    let daiAmount = ethers.utils.parseEther("10");
    const cdaiRateStored = await cDAI.exchangeRateStored();
    let amount = daiAmount
      .div(BigNumber.from(10).pow(10))
      .mul(BigNumber.from(10).pow(28))
      .div(cdaiRateStored);
    let mintAmount = ethers.utils.parseEther("100");
    let depositAmount = ethers.utils.parseEther("50");
    let buyAmount = ethers.utils.parseEther("12.5376128385155467"); // Amount to get 10 DAI
    await dai["mint(uint256)"](mintAmount);

    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address);

    await tokenA["mint(uint256)"](mintAmount);

    await addLiquidity(depositAmount, depositAmount);
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const tokenABalanceBefore = await tokenA.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await tokenA.approve(exchangeHelper.address, buyAmount);
    // let gdPriceInTokenABefore = await goodReserve["currentPrice(address)"](
    //   tokenA.address
    // );
    let transaction = await (
      await exchangeHelper.buy(
        [tokenA.address, dai.address],
        buyAmount,
        0,
        0,
        NULL_ADDRESS
      )
    ).wait();
    // let gdPriceInTokenAAfter = await goodReserve["currentPrice(address)"](
    //   tokenA.address
    // );

    // expect(gdPriceInTokenAAfter.gt(gdPriceInTokenABefore));
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const tokenABalanceAfter = await tokenA.balanceOf(founder.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    const priceAfter = await goodReserve["currentPrice()"]();
    expect(
      (cDAIBalanceReserveAfter - cDAIBalanceReserveBefore).toString()
    ).to.be.equal(amount.toString());
    expect(
      reserveBalanceAfter.sub(reserveBalanceBefore).toString()
    ).to.be.equal(amount.toString());
    expect(supplyAfter.sub(supplyBefore).toString()).to.be.equal(
      gdBalanceAfter.sub(gdBalanceBefore).toString()
    );
    expect(rrAfter.toString()).to.be.equal(rrBefore.toString());
    expect(gdBalanceAfter.gt(gdBalanceBefore)).to.be.true;
    expect(tokenABalanceBefore.gt(tokenABalanceAfter)).to.be.true;
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
    expect(transaction.events.find(_ => _.event === "TokenPurchased")).to.be.not
      .empty;
  });

  it("should be able to sell gd to tokenA through UNISWAP", async () => {
    let amount = -10000;
    let mintAmount = ethers.utils.parseEther("100");

    let sellAmount = BN.from("100");

    await dai["mint(uint256)"](mintAmount);
    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address);

    await tokenA["mint(uint256)"](mintAmount);

    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);

    const tokenABalanceBefore = await tokenA.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await goodDollar.approve(exchangeHelper.address, sellAmount);
    // let gdPriceInTokenABefore = await goodReserve["currentPrice(address)"](
    //   tokenA.address
    // );
    let transaction = await (
      await exchangeHelper.sell(
        [dai.address, tokenA.address],
        sellAmount,
        0,
        0,
        NULL_ADDRESS
      )
    ).wait();
    // let gdPriceInTokenAAfter = await goodReserve["currentPrice(address)"](
    //   tokenA.address
    // );

    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const tokenABalanceAfter = await tokenA.balanceOf(founder.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);

    const priceAfter = await goodReserve["currentPrice()"]();
    expect(cDAIBalanceReserveBefore.gt(cDAIBalanceReserveAfter)).to.be.true;
    // expect(gdPriceInTokenABefore.gt(gdPriceInTokenAAfter));
    expect(
      reserveBalanceAfter.sub(reserveBalanceBefore).toString()
    ).to.be.equal(amount.toString());
    expect(supplyAfter.sub(supplyBefore).toString()).to.be.equal(
      gdBalanceAfter.sub(gdBalanceBefore).toString()
    );
    expect(tokenABalanceAfter.gt(tokenABalanceBefore)).to.be.true;
    expect(rrAfter.toString()).to.be.equal(rrBefore.toString());
    expect(gdBalanceBefore.gt(gdBalanceAfter)).to.be.true;

    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());

    expect(transaction.events.find(_ => _.event === "TokenSold")).to.be.not
      .empty;
  });

  it("should be able to buy gd with tokenA through UNISWAP for some other address", async () => {
    let daiAmount = ethers.utils.parseEther("10");
    const cdaiRateStored = await cDAI.exchangeRateStored();
    let amount = daiAmount
      .div(BigNumber.from(10).pow(10))
      .mul(BigNumber.from(10).pow(28))
      .div(cdaiRateStored);
    let mintAmount = ethers.utils.parseEther("100");
    let depositAmount = ethers.utils.parseEther("50");
    let buyAmount = ethers.utils.parseEther("14.109529451802348229"); // Amount to get 10 DAI
    await dai["mint(uint256)"](mintAmount);

    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address);

    await tokenA["mint(uint256)"](mintAmount);
    await addLiquidity(depositAmount, depositAmount);

    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(staker.address);
    const tokenABalanceBefore = await tokenA.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await tokenA.approve(exchangeHelper.address, buyAmount);
    let transaction = await (
      await exchangeHelper.buy(
        [tokenA.address, dai.address],
        buyAmount,
        0,
        0,
        staker.address
      )
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(staker.address);
    const tokenABalanceAfter = await tokenA.balanceOf(founder.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    const priceAfter = await goodReserve["currentPrice()"]();
    expect(
      (cDAIBalanceReserveAfter - cDAIBalanceReserveBefore).toString()
    ).to.be.equal(amount.toString());
    expect(
      reserveBalanceAfter.sub(reserveBalanceBefore).toString()
    ).to.be.equal(amount.toString());
    expect(supplyAfter.sub(supplyBefore).toString()).to.be.equal(
      gdBalanceAfter.sub(gdBalanceBefore).toString()
    );
    expect(rrAfter.toString()).to.be.equal(rrBefore.toString());
    expect(gdBalanceAfter.gt(gdBalanceBefore)).to.be.true;
    expect(tokenABalanceBefore.gt(tokenABalanceAfter)).to.be.true;
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
    expect(transaction.events.find(_ => _.event === "TokenPurchased")).to.be.not
      .empty;
  });

  it("should be able to sell gd to tokenA through UNISWAP for some other address", async () => {
    let amount = -1000;
    let mintAmount = ethers.utils.parseEther("100");

    let sellAmount = BN.from("10");

    await dai["mint(uint256)"](mintAmount);

    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address);

    await tokenA["mint(uint256)"](mintAmount);

    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);

    const tokenABalanceBefore = await tokenA.balanceOf(staker.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await goodDollar.approve(exchangeHelper.address, sellAmount);
    let transaction = await (
      await exchangeHelper.sell(
        [dai.address, tokenA.address],
        sellAmount,
        0,
        0,
        staker.address
      )
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const tokenABalanceAfter = await tokenA.balanceOf(staker.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);

    const priceAfter = await goodReserve["currentPrice()"]();
    expect(cDAIBalanceReserveBefore.gt(cDAIBalanceReserveAfter)).to.be.true;
    expect(
      reserveBalanceAfter.sub(reserveBalanceBefore).toString()
    ).to.be.equal(amount.toString());
    expect(supplyAfter.sub(supplyBefore).toString()).to.be.equal(
      gdBalanceAfter.sub(gdBalanceBefore).toString()
    );
    expect(tokenABalanceAfter.gt(tokenABalanceBefore)).to.be.true;
    expect(rrAfter.toString()).to.be.equal(rrBefore.toString());
    expect(gdBalanceBefore.gt(gdBalanceAfter)).to.be.true;

    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());

    expect(transaction.events.find(_ => _.event === "TokenSold")).to.be.not
      .empty;
  });

  it("shouldn't be able to buy gd with tokenA through UNISWAP without approve", async () => {
    let depositAmount = ethers.utils.parseEther("5");
    tokenA.approve(exchangeHelper.address, "0");
    await expect(
      exchangeHelper.buy(
        [tokenA.address, dai.address],
        depositAmount,
        0,
        0,
        NULL_ADDRESS
      )
    ).to.be.revertedWith("ERC20: insufficient allowance");
  });

  it("shouldn't be able to sell gd to tokenA through UNISWAP without approve", async () => {
    let sellAmount = BN.from("5");
    goodDollar.approve(exchangeHelper.address, "0");
    await expect(
      exchangeHelper.sell(
        [dai.address, tokenA.address],
        sellAmount,
        0,
        0,
        NULL_ADDRESS
      )
    ).to.be.reverted;
  });

  it("should increase price after buy when RR is not 100%", async () => {
    await initializeToken(
      cDAI.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "500000" //50% rr
    );

    let reserveToken = await marketMaker.reserveTokens(cDAI.address);

    let beforeGdBalance = await goodDollar.balanceOf(founder.address);
    let buyAmount = BN.from("500000000000000000000000"); // 500k dai
    await dai["mint(uint256)"](buyAmount);
    let gdPriceBefore = await goodReserve["currentPrice()"]();

    dai.approve(exchangeHelper.address, buyAmount);
    await exchangeHelper["buy(address[],uint256,uint256,uint256,address)"](
      [dai.address],
      buyAmount,
      0,
      0,
      NULL_ADDRESS
    );

    let gdPriceAfter = await goodReserve["currentPrice()"]();
    let laterGdBalance = await goodDollar.balanceOf(founder.address);
    expect(beforeGdBalance.lt(laterGdBalance)); // GD balance of founder should increase

    expect(gdPriceAfter.gt(gdPriceBefore)); // GD price should increase
  });

  it("should increase price after sell when RR is not 100%", async () => {
    let reserveTokenBefore = await marketMaker.reserveTokens(cDAI.address);
    let reserveRatioBefore = reserveTokenBefore.reserveRatio;
    let sellAmount = BN.from("5000000"); // Sell 50k GD
    let gdPriceBefore = await goodReserve["currentPrice()"]();
    let daiBalanceBefore = await dai.balanceOf(founder.address);
    goodDollar.approve(exchangeHelper.address, sellAmount);
    await exchangeHelper["sell(address[],uint256,uint256,uint256,address)"](
      [dai.address],
      sellAmount,
      0,
      0,
      NULL_ADDRESS
    );
    let reserveTokenAfter = await marketMaker.reserveTokens(cDAI.address);
    let reserveRatioAfter = reserveTokenAfter.reserveRatio;
    let gdPriceAfter = await goodReserve["currentPrice()"]();
    let daiBalanceAfter = await dai.balanceOf(founder.address);
    expect(gdPriceAfter.lt(gdPriceBefore)); // GD price should decrease
    expect(daiBalanceAfter.gt(daiBalanceBefore)); // DAI balance of founder should increase
    expect(reserveRatioBefore).to.be.equal(reserveRatioAfter); // RR should stay same
  });

  it("should be able to buy GD with ETH", async () => {
    let mintAmount = ethers.utils.parseEther("100");
    const ETHAmount = ethers.utils.parseEther("5");

    await dai["mint(uint256)"](mintAmount);
    let buyAmount = ethers.utils.parseEther("10");

    const gdBalanceBeforeSwap = await goodDollar.balanceOf(founder.address);
    let transaction = await (
      await exchangeHelper.buy(
        [ethers.constants.AddressZero, dai.address],
        buyAmount,
        0,
        0,
        founder.address,
        { value: buyAmount }
      )
    ).wait();
    const gdBalanceAfterSwap = await goodDollar.balanceOf(founder.address);
    expect(gdBalanceAfterSwap.gt(gdBalanceBeforeSwap)).to.be.true; // Gd balance after swap should greater than before swap
  });

  it("should be able to sell GD for ETH", async () => {
    const sellAmount = BN.from("1000"); // 10gd
    const ethBalanceBeforeSwap = await ethers.provider.getBalance(
      founder.address
    );
    await goodDollar.approve(exchangeHelper.address, sellAmount);
    let transaction = await (
      await exchangeHelper.sell(
        [dai.address, NULL_ADDRESS],
        sellAmount,
        0,
        0,
        founder.address
      )
    ).wait();
    const ethBalanceAfterSwap = await ethers.provider.getBalance(
      founder.address
    );
    expect(ethBalanceAfterSwap.gt(ethBalanceBeforeSwap));
  });

  it("should not be able to buy Gd with token when path is invalid", async () => {
    const buyAmount = ethers.utils.parseEther("10");
    const depositAmount = ethers.utils.parseEther("10000");
    await tokenB["mint(uint256)"](buyAmount.add(depositAmount));
    await tokenA["mint(uint256)"](depositAmount);
    await tokenA.transfer(ABpair.address, depositAmount);
    await tokenB.transfer(ABpair.address, depositAmount);
    await ABpair.mint(founder.address);

    await tokenB.approve(exchangeHelper.address, buyAmount);
    const tx = await exchangeHelper
      .buy([tokenB.address, dai.address], buyAmount, 0, 0, NULL_ADDRESS)
      .catch(e => e);
    expect(tx.message).to.be.not.empty;
  });
  it("it should able to buy gd with multiple swaps through UNISWAP", async () => {
    const buyAmount = ethers.utils.parseEther("10");
    await tokenB["mint(uint256)"](buyAmount);
    const gdBalanceBeforeBuy = await goodDollar.balanceOf(founder.address);
    await exchangeHelper.buy(
      [tokenB.address, tokenA.address, dai.address],
      buyAmount,
      0,
      0,
      NULL_ADDRESS
    );
    const gdBalanceAfterBuy = await goodDollar.balanceOf(founder.address);
    expect(gdBalanceAfterBuy).to.be.gt(gdBalanceBeforeBuy);
  });
  it("it should be able to sell GD with multiple swaps through UNISWAP", async () => {
    const sellAmount = "100";
    await goodDollar.approve(exchangeHelper.address, sellAmount);
    const tokenBBalanceBeforeSell = await tokenB.balanceOf(founder.address);
    await exchangeHelper.sell(
      [dai.address, tokenA.address, tokenB.address],
      sellAmount,
      0,
      0,
      NULL_ADDRESS
    );
    const tokenBBalanceAfterSell = await tokenB.balanceOf(founder.address);
    expect(tokenBBalanceAfterSell).to.be.gt(tokenBBalanceBeforeSell);
  });

  async function addLiquidity(
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await tokenA.transfer(pair.address, token0Amount);
    await dai.transfer(pair.address, token1Amount);
    await pair.mint(founder.address);
  }

  async function addETHLiquidity(
    token0Amount: BigNumber,
    WETHAmount: BigNumber
  ) {
    await dai.approve(uniswapRouter.address, MaxUint256);
    await uniswapRouter.addLiquidityETH(
      dai.address,
      token0Amount,
      token0Amount,
      WETHAmount,
      founder.address,
      MaxUint256,
      {
        value: WETHAmount
      }
    );
  }
});
