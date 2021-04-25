import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  UniswapFactory
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import ERC20 from "@uniswap/v2-core/build/ERC20.json";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GoodReserve - buy/sell with any token through uniswap", () => {
  let dai: Contract, tokenA: Contract, pair: Contract, uniswapRouter: Contract;
  let cDAI;
  let goodReserve: GoodReserveCDai;
  let goodDollar,
    avatar,
    identity,
    marketMaker: GoodMarketMaker,
    contribution,
    controller,
    founder,
    staker,
    schemeMock,
    signers,
    setDAOAddress,
    nameService;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
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

    const weth = await wethFactory.deploy();
    const factory = await uniswapFactory.deploy(founder.address);
    uniswapRouter = await routerFactory.deploy(factory.address, weth.address);
    dai = await daiFactory.deploy();

    cDAI = await cdaiFactory.deploy(dai.address);

    tokenA = await daiFactory.deploy(); // Another erc20 token for uniswap router test

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
      reserve
    } = await createDAO();

    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);

    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
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
      mmOwner: await marketMaker.owner(),
      founder: founder.address
    });
    goodReserve = reserve as GoodReserveCDai;

    console.log("setting permissions...");

    console.log("initializing marketmaker...");
    await marketMaker.initializeToken(
      cDAI.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );

    await marketMaker.transferOwnership(goodReserve.address);
    // Set addresses
    setDAOAddress("CDAI", cDAI.address)
    setDAOAddress("DAI", dai.address)
    setDAOAddress("UNISWAP_ROUTER",uniswapRouter.address)
    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();
   

    await factory.createPair(tokenA.address, dai.address); // Create tokenA and dai pair
    const pairAddress = factory.getPair(tokenA.address, dai.address);
    pair = new Contract(
      pairAddress,
      JSON.stringify(IUniswapV2Pair.abi),
      staker
    ).connect(founder);

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
    let amount = 99e7;
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
    await tokenA.approve(goodReserve.address, buyAmount);
    // let gdPriceInTokenABefore = await goodReserve["currentPrice(address)"](
    //   tokenA.address
    // );
    let transaction = await (
      await goodReserve.buy(tokenA.address, buyAmount, 0, 0, NULL_ADDRESS)
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
    await goodDollar.approve(goodReserve.address, sellAmount);
    // let gdPriceInTokenABefore = await goodReserve["currentPrice(address)"](
    //   tokenA.address
    // );
    let transaction = await (
      await goodReserve.sell(tokenA.address, sellAmount, 0, 0, NULL_ADDRESS)
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
    let amount = 890734097;
    let mintAmount = ethers.utils.parseEther("100");
    let depositAmount = ethers.utils.parseEther("50");
    let buyAmount = ethers.utils.parseEther("12.5376128385155467"); // Amount to get 10 DAI
    await dai["mint(uint256)"](mintAmount);

    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address);

    await tokenA["mint(uint256)"](mintAmount);

    addLiquidity(depositAmount, depositAmount);

    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(staker.address);
    const tokenABalanceBefore = await tokenA.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await tokenA.approve(goodReserve.address, buyAmount);
    let transaction = await (
      await goodReserve.buy(tokenA.address, buyAmount, 0, 0, staker.address)
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
    await goodDollar.approve(goodReserve.address, sellAmount);
    let transaction = await (
      await goodReserve.sell(tokenA.address, sellAmount, 0, 0, staker.address)
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
    tokenA.approve(goodReserve.address, "0");
    await expect(
      goodReserve.buy(tokenA.address, depositAmount, 0, 0, NULL_ADDRESS)
    ).to.be.revertedWith("You need to approve input token transfer first");
  });

  it("shouldn't be able to sell gd to tokenA through UNISWAP without approve", async () => {
    let sellAmount = BN.from("5");
    goodDollar.approve(goodReserve.address, "0");
    await expect(
      goodReserve.sell(tokenA.address, sellAmount, 0, 0, NULL_ADDRESS)
    ).to.be.reverted;
  });

  it("should increase price after buy when RR is not 100%", async () => {
    //Initialise new market maker due to other one's ownership transfered to goodreserve so we cant change its RR
    const MM = await ethers.getContractFactory("GoodMarketMaker");

    marketMaker = (await upgrades.deployProxy(MM, [
      nameService.address,
      999388834642296,
      1e15
    ])) as GoodMarketMaker;
    await marketMaker.initializeToken(
      cDAI.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "500000" //50% rr
    );

    await marketMaker.transferOwnership(goodReserve.address);
    await setDAOAddress("MARKET_MAKER", marketMaker.address);

    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveRatio = reserveToken.reserveRatio;

    let beforeGdBalance = await goodDollar.balanceOf(founder.address);
    let buyAmount = BN.from("500000000000000000000000"); // 500k dai
    await dai["mint(uint256)"](buyAmount);
    let gdPriceBefore = await goodReserve["currentPrice()"]();

    dai.approve(goodReserve.address, buyAmount);
    await goodReserve["buy(address,uint256,uint256,uint256,address)"](
      dai.address,
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
    goodDollar.approve(goodReserve.address, sellAmount);
    await goodReserve["sell(address,uint256,uint256,uint256,address)"](
      dai.address,
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

  async function addLiquidity(
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await tokenA.transfer(pair.address, token0Amount);
    await dai.transfer(pair.address, token1Amount);
    await pair.mint(founder.address);
  }
});
