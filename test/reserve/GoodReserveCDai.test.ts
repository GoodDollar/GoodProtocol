import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import { GoodMarketMaker, CERC20, GoodReserveCDai } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import { parseUnits } from "@ethersproject/units";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GoodReserve - staking with cDAI mocks", () => {
  let dai: Contract;
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
    exchangeHelper: Contract,
    setDAOAddress,
    nameService;

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
      reserve
    } = await createDAO();

    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);

    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    await setDAOAddress("UNISWAP_ROUTER", signers[0].address);
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

    const reserveFactory = await ethers.getContractFactory("GoodReserveCDai");
    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });
    goodReserve = reserve as GoodReserveCDai;
  });

  it("should get g$ minting permissions", async () => {
    expect(await goodReserve.dao()).to.be.equal(controller);
    expect(await goodReserve.avatar()).to.be.equal(avatar);
  });

  it("should set marketmaker in the reserve by avatar", async () => {
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    // const rFactory = await ethers.getContractFactory("GoodReserveCDai");
    // const ctrl = await ethers.getContractAt(
    //   "Controller",
    //   controller,
    //   schemeMock
    // );
    // const encodedCall = rFactory.interface.encodeFunctionData(
    //   "setMarketMaker",
    //   [marketMaker.address]
    // );
    // await ctrl.genericCall(goodReserve.address, encodedCall, avatar, 0);
    // const newMM = await goodReserve.marketMaker();
    // expect(newMM.toString()).to.be.equal(marketMaker.address);
  });

  it("should set fundManager in the reserve by avatar", async () => {
    await setDAOAddress("FUND_MANAGER", founder.address);
    // const rFactory = await ethers.getContractFactory("GoodReserveCDai");
    // const ctrl = await ethers.getContractAt(
    //   "Controller",
    //   controller,
    //   schemeMock
    // );
    // const encodedCall = rFactory.interface.encodeFunctionData(
    //   "setFundManager",
    //   [founder.address]
    // );
    // await ctrl.genericCall(goodReserve.address, encodedCall, avatar, 0);
    // const newFM = await goodReserve.fundManager();
    // expect(newFM.toString()).to.be.equal(founder.address);
  });

  // it("should returned true for isActive", async () => {
  //   const isActive = await goodReserve.isActive();
  //   expect(isActive.toString()).to.be.equal("true");
  // });

  it("should returned fixed 0.0001 market price", async () => {
    const gdPrice = await goodReserve["currentPrice()"]();
    const cdaiWorthInGD = gdPrice.mul(BN.from("100000000"));
    const gdFloatPrice = gdPrice.toNumber() / 10 ** 8; //cdai 8 decimals
    expect(gdFloatPrice).to.be.equal(0.0001);
    expect(cdaiWorthInGD.toString()).to.be.equal("1000000000000"); //in 8 decimals precision
    expect(cdaiWorthInGD.toNumber() / 10 ** 8).to.be.equal(10000);
  });

  it("should returned market price of 1gd in DAI", async () => {
    const gdPrice = await goodReserve["currentPriceDAI()"]();
    const daiWorthInGD = gdPrice.mul(BN.from("98010000"));
    const gdFloatPrice = gdPrice.toNumber() / 10 ** 18; //dai 18 decimals
    expect(gdFloatPrice).to.be.equal(0.000101010101010101);
    expect(daiWorthInGD.toString()).to.be.equal("9899999999999999010000"); //in 18 decimals precision
    //expect(daiWorthInGD.toNumber() / 10 ** 18).to.be.equal(9899.999999999999010000);
  });

  // it("should not be able to buy gd if the minter is not the reserve", async () => {
  //   let amount = 1e8;
  //   await dai["mint(uint256)"](ethers.utils.parseEther("100"));
  //   dai.approve(cDAI.address, ethers.utils.parseEther("100"));
  //   await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
  //   await cDAI.approve(goodReserve.address, amount);

  //   const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
  //   const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);

  //   let tx = (await goodReserve.buy(cDAI.address, amount, 0)).wait();
  //   const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
  //   const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
  //   expect(tx).to.be.revertedWith("not minter");
  //   expect(gdBalanceAfter.toString()).to.be.equal(gdBalanceBefore.toString());
  //   expect(cDAIBalanceAfter.toString()).to.be.equal(
  //     cDAIBalanceBefore.toString()
  //   );

  //   // //for following tests
  //   // await goodDollar.addMinter(goodReserve.address);
  // });

  xit("should mint UBI correctly for 18 decimals precision and no interest", async () => {
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    const gdPriceBefore = await goodReserve["currentPrice()"]();

    await increaseTime(24 * 60 * 60); //required for reserve ratio advance
    const er = await cDAI.exchangeRateStored();
    const daiAmount = ethers.utils
      .parseEther("0.1")
      .mul(BN.from("10").pow(10))
      .mul(er)
      .div(BN.from("10").pow(28));

    await dai["mint(address,uint256)"](goodReserve.address, daiAmount);
    const tx = await (
      await goodReserve.mintUBI(1, ethers.utils.parseEther("0.1"), cDAI.address)
    ).wait();
    const gdBalanceFund = await goodDollar.balanceOf(founder.address);
    const gdPriceAfter = await goodReserve["currentPrice()"]();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    // expected that minted token will be added to the previous supply
    const mintEvent = tx.events.find(_ => _.event === "UBIMinted");
    console.log(
      gdPriceBefore.toNumber(),
      supplyAfter.toNumber(),
      supplyBefore.toNumber()
    );
    expect(supplyAfter).to.be.equal(
      mintEvent.args.gdInterestMinted
        .add(mintEvent.args.gdExpansionMinted)
        .add(supplyBefore)
    );
    // expected that the new reserve balance will include
    // the new 1e18 cdai which transferred
    expect(reserveBalanceAfter).to.be.equal(
      reserveBalanceBefore.add(BN.from("10").pow(17)).sub(BN.from("1"))
    );
    // the new reserve ratio should be effected from the mintExpansion by:
    // the daily change that was set up in the constructor (999388834642296)
    // requires the time advance simulation above
    expect(rrAfter.toString()).to.be.equal("999388");
    // the price should be the same
    expect(gdPriceAfter).to.be.equal(gdPriceBefore);
    expect(gdBalanceFund).to.be.equal(
      mintEvent.args.gdInterestMinted
        .add(mintEvent.args.gdExpansionMinted)
        .toString()
    );
  });
  /*
  it("should mint UBI correctly for 18 decimals precision and partial interest", async () => {
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    const gdBalanceFundBefore = await goodDollar.balanceOf(founder.address);
    const gdBalanceAvatarBefore = await goodDollar.balanceOf(avatar);
    const gdPriceBefore = await goodReserve["currentPrice()"]();
    const tx = await (
      await goodReserve.mintInterestAndUBI(
        cDAI.address,
        ethers.utils.parseUnits("10000", "gwei"),
        "10000"
      )
    ).wait(); // interest is 0.0001 cDai which equal to 1 gd
    const gdBalanceFundAfter = await goodDollar.balanceOf(founder.address);
    const gdBalanceAvatarAfter = await goodDollar.balanceOf(avatar);
    const gdPriceAfter = await goodReserve["currentPrice()"]();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    let et = BN.from(ethers.utils.parseUnits("10000", "gwei"));
    console.log(
      gdPriceBefore.toNumber(),
      supplyAfter.toNumber(),
      supplyBefore.toNumber()
    );
    const mintEvent = tx.events.find(_ => _.event === "UBIMinted");
    const toMint = mintEvent.args.gdInterestMinted.add(
      mintEvent.args.gdExpansionMinted
    );
    expect(reserveBalanceAfter.toString()).to.be.equal(
      et.add(reserveBalanceBefore).toString(),
      "reserve balance has changed"
    );
    expect(supplyAfter.toString()).to.be.equal(
      toMint.add(supplyBefore).toString(),
      "supply has changed"
    );
    expect(gdPriceAfter.toString()).to.be.equal(
      gdPriceBefore.toString(),
      "price has changed"
    );
    expect(
      (gdBalanceAvatarAfter - gdBalanceAvatarBefore).toString()
    ).to.be.equal("0"); // 1 gd
    expect(gdBalanceFundAfter.sub(gdBalanceFundBefore)).to.be.equal(
      toMint,
      "ubi minted mismatch"
    );
    expect(rrAfter.toString()).to.be.equal("999388");
  });
  */
  // it("should not mint UBI if the reserve is not cDAI", async () => {
  //   let error = await goodReserve
  //     .mintInterestAndUBI(dai.address, ethers.utils.parseEther("1"), "0")
  //     .catch(e => e);
  //   expect(error.message).not.to.be.empty;
  // });

  xit("should not mint UBI if the caller is not the fund manager", async () => {
    let tx = goodReserve
      .connect(staker)
      .mintUBI(1, ethers.utils.parseEther("1"), cDAI.address);
    await expect(tx).to.be.revertedWith("revert GoodReserve: not a minter");
  });

  // it("should set block interval by avatar", async () => {
  //   let encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "setBlockInterval",
  //       type: "function",
  //       inputs: [
  //         {
  //           type: "uint256",
  //           name: "_blockInterval"
  //         }
  //       ]
  //     },
  //     [100]
  //   );
  //   await controller.genericCall(
  //     goodReserve.address,
  //     encodedCall,
  //     avatar,
  //     0
  //   );
  //   const newBI = await goodReserve.blockInterval();
  //   expect(newBI.toString()).to.be.equal("100");
  // });

  // it("should not mint UBI if not in the interval", async () => {
  //   const gdBalanceFundBefore = await goodDollar.balanceOf(founder.address);
  //   const gdBalanceAvatarBefore = await goodDollar.balanceOf(avatar);
  //   const error = await goodReserve
  //     .mintInterestAndUBI(
  //       cDAI.address,
  //       ethers.utils.parseUnits("10000", "gwei"),
  //       "10000"
  //     )
  //     .catch(e => e);
  //   const gdBalanceFundAfter = await goodDollar.balanceOf(founder.address);
  //   const gdBalanceAvatarAfter = await goodDollar.balanceOf(avatar);
  //   expect(error.message).to.have.string("wait for the next interval");
  //   expect(gdBalanceFundAfter).to.be.equal(gdBalanceFundBefore);
  //   expect(gdBalanceAvatarAfter).to.be.equal(gdBalanceAvatarBefore);
  // });

  it("should be able to buy gd with DAI", async () => {
    let amount = 99e8;
    let daiAmount = ethers.utils.parseEther("100");
    await dai["mint(uint256)"](daiAmount);
    await dai.approve(exchangeHelper.address, daiAmount);
    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address);
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const daiBalanceBefore = await dai.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();

    let transaction = await (
      await exchangeHelper.buy([dai.address], daiAmount, 0, 0, NULL_ADDRESS)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const daiBalanceAfter = await dai.balanceOf(founder.address);
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
    expect(daiBalanceBefore.gt(daiBalanceAfter)).to.be.true;
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
    expect(transaction.events.find(_ => _.event === "TokenPurchased")).to.be.not
      .empty;
  });

  it("should be able to buy gd with cDAI through buy", async () => {
    let amount = 1e8;
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await cDAI.approve(exchangeHelper.address, amount);
    let transaction = await (
      await exchangeHelper.buy([cDAI.address], amount, 0, 0, NULL_ADDRESS)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
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
    expect(cDAIBalanceBefore.gt(cDAIBalanceAfter)).to.be.true;
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
    expect(transaction.events.find(_ => _.event === "TokenPurchased")).to.be.not
      .empty;
  });

  it("should be able to buy gd with cDAI", async () => {
    let amount = 1e8;
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await cDAI.approve(exchangeHelper.address, amount);
    let transaction = await (
      await exchangeHelper.buy([cDAI.address], amount, 0, 0, NULL_ADDRESS)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
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
    expect(cDAIBalanceBefore.gt(cDAIBalanceAfter)).to.be.true;
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
    expect(transaction.events.find(_ => _.event === "TokenPurchased")).to.be.not
      .empty;
  });

  it("should be able to buy gd with cDAI with generic amount of cdai tokens", async () => {
    await dai["mint(uint256)"](ethers.utils.parseEther("4895"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("4895"));
    let cdaibefore = await cDAI.balanceOf(founder.address);
    await cDAI["mint(uint256)"](ethers.utils.parseEther("4895"));
    let cdaiafter = await cDAI.balanceOf(founder.address);
    let amount = cdaiafter.sub(cdaibefore).toNumber();
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    await cDAI.approve(exchangeHelper.address, amount);
    let transaction = await (
      await exchangeHelper.buy([cDAI.address], amount, 0, 0, NULL_ADDRESS)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    // actual cdai balance
    expect(
      cDAIBalanceReserveAfter.sub(cDAIBalanceReserveBefore).toString()
    ).to.be.equal(amount.toString());
    // cdai balance according to the market maker
    expect(
      reserveBalanceAfter.sub(reserveBalanceBefore).toString()
    ).to.be.equal(amount.toString());
    expect(supplyAfter.sub(supplyBefore).toString()).to.be.equal(
      gdBalanceAfter.sub(gdBalanceBefore).toString()
    );
    expect(transaction.events.find(_ => _.event === "TokenPurchased")).to.be.not
      .empty;
  });

  it("should be able to buy gd with other non initialized tokens beside cDAI", async () => {
    let amount = ethers.utils.parseEther("1");
    await dai["mint(uint256)"](amount);
    await dai.approve(exchangeHelper.address, amount);
    let tx = exchangeHelper.buy([dai.address], amount, 0, 0, NULL_ADDRESS);
    await expect(tx).to.not.reverted;
  });

  it("should not be able to buy gd without cDAI allowance", async () => {
    let amount = 1e8;
    await cDAI.approve(exchangeHelper.address, "0");
    let error = await exchangeHelper
      .buy([cDAI.address], amount, 0, 0, NULL_ADDRESS)
      .catch(e => e);
    expect(error.message).to.have.string(
      "ERC20: transfer amount exceeds allowance"
    );
  });

  it("should not be able to buy gd without enough cDAI funds", async () => {
    let amount = 1e8;
    const cDAIBalanceBeforeTransfer = await cDAI.balanceOf(founder.address);
    await cDAI.transfer(staker.address, cDAIBalanceBeforeTransfer.toString());
    await cDAI.approve(exchangeHelper.address, amount);
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    let error = await exchangeHelper
      .buy([cDAI.address], amount, 0, 0, NULL_ADDRESS)
      .catch(e => e);
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
    expect(error.message).not.to.be.empty;
    expect(gdBalanceAfter.toString()).to.be.equal(gdBalanceBefore.toString());
    expect(cDAIBalanceAfter.toString()).to.be.equal(
      cDAIBalanceBefore.toString()
    );

    await cDAI
      .connect(staker)
      .transfer(founder.address, cDAIBalanceBeforeTransfer.toString());
  });

  it("should not be able to buy gd when the minimum return is higher than the actual return", async () => {
    let amount = 1e8;
    await cDAI.approve(exchangeHelper.address, amount);
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    let error = await exchangeHelper
      .buy([cDAI.address], amount, 2000000, 0, NULL_ADDRESS)
      .catch(e => e);
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
    expect(error.message).to.have.string(
      "GD return must be above the minReturn"
    );
    expect(gdBalanceAfter.toString()).to.be.equal(gdBalanceBefore.toString());
    expect(cDAIBalanceAfter.toString()).to.be.equal(
      cDAIBalanceBefore.toString()
    );
  });

  it("should be able to sell gd to cDAI without contribution", async () => {
    let amount = BN.from("10000");
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let reserveRatio = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    await goodDollar.approve(exchangeHelper.address, amount);
    let transaction = await (
      await exchangeHelper.sell([cDAI.address], amount, 0, 0, NULL_ADDRESS)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    // according to the initialization settings reserve ratio is 100%. the calculation is:
    // Return = _reserveBalance * (1 - (1 - _sellAmount / _supply) ^ (1000000 / _reserveRatio))
    const bancor = await ethers.getContractAt(
      "BancorFormula",
      await marketMaker.getBancor()
    );
    const expectedReturn = await bancor.calculateSaleReturn(
      supplyBefore.toString(),
      reserveBalanceBefore.toString(),
      reserveRatio.toString(),
      amount
    );
    expect(cDAIBalanceAfter - cDAIBalanceBefore).to.be.equal(expectedReturn);
    expect(cDAIBalanceReserveBefore - cDAIBalanceReserveAfter).to.be.equal(
      expectedReturn
    );
    expect(reserveBalanceBefore.sub(reserveBalanceAfter)).to.be.equal(
      expectedReturn
    );
    // 1e4 gd sold (burn from the supply)
    expect(supplyBefore.sub(supplyAfter)).to.be.equal(amount);
    expect(gdBalanceBefore.gt(gdBalanceAfter)).to.be.true;
    expect(cDAIBalanceAfter.gt(cDAIBalanceBefore)).to.be.true;
    expect(transaction.events.find(_ => _.event === "TokenSold")).to.be.not
      .empty;
  });

  it("should be able to sell gd to cDAI without contribution through sell function", async () => {
    let amount = BN.from("10000");
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let reserveRatio = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    await goodDollar.approve(exchangeHelper.address, amount);
    let transaction = await (
      await exchangeHelper.sell([cDAI.address], amount, 0, 0, NULL_ADDRESS)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    // according to the initialization settings reserve ratio is 100%. the calculation is:
    // Return = _reserveBalance * (1 - (1 - _sellAmount / _supply) ^ (1000000 / _reserveRatio))
    const bancor = await ethers.getContractAt(
      "BancorFormula",
      await marketMaker.getBancor()
    );
    const expectedReturn = await bancor.calculateSaleReturn(
      supplyBefore.toString(),
      reserveBalanceBefore.toString(),
      reserveRatio.toString(),
      amount
    );
    expect(cDAIBalanceAfter - cDAIBalanceBefore).to.be.equal(expectedReturn);
    expect(cDAIBalanceReserveBefore - cDAIBalanceReserveAfter).to.be.equal(
      expectedReturn
    );
    expect(reserveBalanceBefore.sub(reserveBalanceAfter)).to.be.equal(
      expectedReturn
    );
    // 1e4 gd sold (burn from the supply)
    expect(supplyBefore.sub(supplyAfter)).to.be.equal(amount);
    expect(gdBalanceBefore.gt(gdBalanceAfter)).to.be.true;
    expect(cDAIBalanceAfter.gt(cDAIBalanceBefore)).to.be.true;
    expect(transaction.events.find(_ => _.event === "TokenSold")).to.be.not
      .empty;
  });

  it("should be able to sell gd to DAI without contribution through sell function", async () => {
    let amount = BN.from("10000");
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let reserveRatio = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const daiBalanceBefore = await dai.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    await goodDollar.approve(exchangeHelper.address, amount);
    let transaction = await (
      await exchangeHelper.sell([dai.address], amount, 0, 0, NULL_ADDRESS)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const daiBalanceAfter = await dai.balanceOf(founder.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    // according to the initialization settings reserve ratio is 100%. the calculation is:
    // Return = _reserveBalance * (1 - (1 - _sellAmount / _supply) ^ (1000000 / _reserveRatio))
    const bancor = await ethers.getContractAt(
      "BancorFormula",
      await marketMaker.getBancor()
    );
    const expectedReturn = await bancor.calculateSaleReturn(
      supplyBefore.toString(),
      reserveBalanceBefore.toString(),
      reserveRatio.toString(),
      amount
    );

    //  expect(cDAIBalanceAfter - cDAIBalanceBefore).to.be.equal(expectedReturn);
    // expect(cDAIBalanceReserveBefore - cDAIBalanceReserveAfter).to.be.equal(
    //  expectedReturn
    // );
    //expect(reserveBalanceBefore.sub(reserveBalanceAfter)).to.be.equal(
    //  expectedReturn
    // );
    // 1e4 gd sold (burn from the supply)
    //expect(supplyBefore.sub(supplyAfter)).to.be.equal(amount);
    //expect(gdBalanceBefore.gt(gdBalanceAfter)).to.be.true;
    expect(daiBalanceAfter.gt(daiBalanceBefore)).to.be.true;
    expect(transaction.events.find(_ => _.event === "TokenSold")).to.be.not
      .empty;
  });

  it("should set sell contribution ratio by avatar", async () => {
    let nom = ethers.utils.parseUnits("2", 14);
    let denom = ethers.utils.parseUnits("1", 15);
    let ccFactory = await ethers.getContractFactory(
      ContributionCalculation.abi,
      ContributionCalculation.bytecode
    );
    let encodedCall = ccFactory.interface.encodeFunctionData(
      "setContributionRatio",
      [nom, denom]
    );
    const ctrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ctrl.genericCall(contribution.address, encodedCall, avatar, 0);
    const newRatio = await contribution.sellContributionRatio();
    expect(newRatio.toString()).to.be.equal("200000000000000000000000000");
  });

  it("should not be able to set the sell contribution ratio if not avatar", async () => {
    let error = await contribution
      .setContributionRatio(2e14, 1e15)
      .catch(e => e);
    expect(error.message).to.have.string("only Avatar can call this method");
  });

  // it("should not be able to set the contribution contract address if not avatar", async () => {
  //   let error = await goodReserve
  //     .setContributionAddress(NULL_ADDRESS)
  //     .catch(e => e);
  //   expect(error.message).to.have.string("only Avatar can call this method");
  // });

  // it("should set contribution contract address by avatar", async () => {
  //   const currentAddress = await goodReserve.contribution();
  //   let encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "setContributionAddress",
  //       type: "function",
  //       inputs: [
  //         {
  //           type: "address",
  //           name: "_contribution"
  //         }
  //       ]
  //     },
  //     [NULL_ADDRESS]
  //   );
  // const ctrl = await ethers.getContractAt(
  //   "Controller",
  //   controller,
  //   schemeMock
  // );
  //   await ctrl.genericCall(
  //     goodReserve.address,
  //     encodedCall,
  //     avatar,
  //     0
  //   );
  //   let newAddress = await goodReserve.contribution();
  //   expect(newAddress).to.be.equal(NULL_ADDRESS);
  //   encodedCall = web3.eth.abi.encodeFunctionCall(
  //     {
  //       name: "setContributionAddress",
  //       type: "function",
  //       inputs: [
  //         {
  //           type: "address",
  //           name: "_contribution"
  //         }
  //       ]
  //     },
  //     [currentAddress]
  //   );
  // const ctrl = await ethers.getContractAt(
  //   "Controller",
  //   controller,
  //   schemeMock
  // );
  //   await ctrl.genericCall(
  //     goodReserve.address,
  //     encodedCall,
  //     avatar,
  //     0
  //   );
  //   newAddress = await goodReserve.contribution();
  //   expect(newAddress).to.be.equal(currentAddress);
  // });

  it("should calculate the sell contribution", async () => {
    let nom = ethers.utils.parseUnits("2", 14);
    let denom = ethers.utils.parseUnits("1", 15);

    let actual = await contribution.calculateContribution(
      marketMaker.address,
      goodReserve.address,
      founder.address,
      cDAI.address,
      1e4
    );
    expect(actual).to.be.equal(nom.mul(BN.from("10000")).div(denom));
  });

  it("should be able to sell gd to cDAI with contribution of 20%", async () => {
    let amount = 1e4; // 100 gd

    await goodDollar.transfer(staker.address, amount);
    // deduced amount, ie. return minus contribution. reserve ratio is 100%.
    // example without deduction:
    // 1 gd (100) equals to 0.0001 cDai (10000) so 100 gd (10k) equals to 0.01 cDai (1m)
    // since there is 20% contribution the return is 0.008 cDai (800k)
    let expectedReturn = 800000;
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(staker.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(staker.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();

    await goodDollar.connect(staker).approve(exchangeHelper.address, amount);
    let transaction = await (
      await exchangeHelper
        .connect(staker)
        .sell([cDAI.address], amount, 0, 0, NULL_ADDRESS)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(staker.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(staker.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    const priceAfter = await goodReserve["currentPrice()"]();
    expect(cDAIBalanceAfter.sub(cDAIBalanceBefore)).to.be.equal(
      expectedReturn,
      "seller return mismatch"
    );
    expect(cDAIBalanceReserveBefore.sub(cDAIBalanceReserveAfter)).to.be.equal(
      expectedReturn,
      "reserve balance mismatch"
    );
    expect(reserveBalanceBefore.sub(reserveBalanceAfter)).to.be.equal(
      expectedReturn,
      "reserve token data mismatch"
    );
    expect(supplyBefore.sub(supplyAfter)).to.be.equal(amount);
    expect(rrAfter.toString()).to.be.equal(rrBefore.toString());
    expect(gdBalanceBefore.gt(gdBalanceAfter)).to.be.true;
    expect(cDAIBalanceAfter.gt(cDAIBalanceBefore)).to.be.true;
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
    expect(transaction.events.find(_ => _.event === "TokenSold")).to.be.not
      .empty;
  });

  it("should able to sell gd to DAI or cDAI token", async () => {
    let amount = 1e4;
    await goodDollar.approve(exchangeHelper.address, amount);

    let tx = exchangeHelper.sell([dai.address], amount, 0, 0, NULL_ADDRESS);
    await expect(tx).to.not.reverted;
  });

  it("should not be able to sell gd without gd allowance", async () => {
    let amount = 1e4;
    await goodDollar.approve(exchangeHelper.address, "0");
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    let error = await exchangeHelper
      .sell([cDAI.address], amount, 0, 0, NULL_ADDRESS)
      .catch(e => e);
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
    expect(error.message).not.to.be.empty;
    expect(gdBalanceAfter.toString()).to.be.equal(gdBalanceBefore.toString());
    expect(cDAIBalanceAfter.toString()).to.be.equal(
      cDAIBalanceBefore.toString()
    );
  });

  it("should not be able to sell gd without enough gd funds", async () => {
    let amount = 1e4;
    const gdBalanceBeforeTransfer = await goodDollar.balanceOf(founder.address);
    //reset gd holdings
    await goodDollar.transfer(
      staker.address,
      gdBalanceBeforeTransfer.toString()
    );
    await goodDollar.approve(exchangeHelper.address, amount);
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    let error = await exchangeHelper
      .sell([cDAI.address], amount, 0, 0, NULL_ADDRESS)
      .catch(e => e);
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
    expect(error.message).not.to.be.empty;
    expect(gdBalanceAfter.toString()).to.be.equal(gdBalanceBefore.toString());
    expect(cDAIBalanceAfter.toString()).to.be.equal(
      cDAIBalanceBefore.toString()
    );
    //restore gd holdings
    await goodDollar
      .connect(staker)
      .transfer(founder.address, gdBalanceBeforeTransfer.toString());
  });

  it("should not be able to sell gd when the minimum return is higher than the actual return", async () => {
    let amount = 1e4;
    await goodDollar.approve(exchangeHelper.address, amount);
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    let error = await exchangeHelper
      .sell([cDAI.address], amount, 2000000, 0, NULL_ADDRESS)
      .catch(e => e);
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
    expect(error.message).to.have.string(
      "Token return must be above the minReturn"
    );
    expect(gdBalanceAfter.toString()).to.be.equal(gdBalanceBefore.toString());
    expect(cDAIBalanceAfter.toString()).to.be.equal(
      cDAIBalanceBefore.toString()
    );
  });

  it("should return an error if non avatar account is trying to execute recover", async () => {
    let error = await goodReserve.recover(cDAI.address).catch(e => e);
    expect(error.message).to.have.string(
      "revert only avatar can call this method"
    );
  });

  it("should transfer funds when execute recover of token which the reserve has some balance", async () => {
    await dai["mint(address,uint256)"](
      goodReserve.address,
      ethers.utils.parseEther("100")
    );

    let reserveBalance = await dai.balanceOf(goodReserve.address);
    const reserveFactory = await ethers.getContractFactory("GoodReserveCDai");

    let encodedCall = reserveFactory.interface.encodeFunctionData("recover", [
      dai.address
    ]);

    const ctrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );
    await ctrl.genericCall(goodReserve.address, encodedCall, avatar, 0);
    let recoveredBalance = await dai.balanceOf(avatar);
    expect(recoveredBalance).to.be.equal(reserveBalance);
  });

  it("should not be able to destroy if not avatar", async () => {
    let tx = goodReserve.end();
    await expect(tx).to.revertedWith("revert only avatar can call this method");
  });

  it("should be able to buy gd with cDAI and reserve should be correct", async () => {
    let amount = 1e8;

    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    await cDAI.approve(exchangeHelper.address, amount);
    await exchangeHelper.buy([cDAI.address], amount, 0, 0, NULL_ADDRESS);
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    expect(cDAIBalanceReserveAfter.sub(cDAIBalanceReserveBefore)).to.be.equal(
      amount.toString()
    );
    expect(reserveBalanceAfter.sub(reserveBalanceBefore)).to.be.equal(amount);
  });
  it("should be able to buy gd with cDAI directly through reserve", async () => {
    let amount = 1e8;
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    await cDAI.approve(goodReserve.address, ethers.utils.parseEther("10"));
    const founderBalanceBeforeBuy = await goodDollar.balanceOf(founder.address);
    await goodReserve.buy(amount, 0, founder.address);
    const founderBalanceAfterBuy = await goodDollar.balanceOf(founder.address);
    expect(founderBalanceAfterBuy).to.be.gt(founderBalanceBeforeBuy);
  });
  it("should not be able to buy gd through reserve when there is no enough allowance", async () => {
    let amount = 1e8;
    await cDAI.approve(goodReserve.address, 0);
    const tx = await goodReserve.buy(amount, 0, founder.address).catch(e => e);
    expect(tx.message).to.have.string(
      "ERC20: transfer amount exceeds allowance"
    );
  });
  it("should be able to sell gd directly through reserve", async () => {
    const cdaiBalanceBeforeSell = await cDAI.balanceOf(founder.address);
    await goodDollar.approve(goodReserve.address, "100");
    await goodReserve.sell("100", 0, founder.address, staker.address);
    const cdaiBalanceAfterSell = await cDAI.balanceOf(founder.address);
    expect(cdaiBalanceAfterSell).to.be.gt(cdaiBalanceBeforeSell);
  });
  it("should not be able to sell gd through reserve when there is no enough allowance", async () => {
    await goodDollar.approve(goodReserve.address, "0");
    const tx = await goodReserve
      .sell("100", 0, founder.address, staker.address)
      .catch(e => e);
    expect(tx.message).to.be.not.empty;
  });
  it("seller parameter should not matter if caller is not exchange helper", async () => {
    const stakerGDBalanceBeforeSell = await goodDollar.balanceOf(
      staker.address
    );
    await goodDollar.approve(goodReserve.address, "100");
    await goodReserve.sell("100", 0, founder.address, staker.address);
    const stakerGDBalanceAfterSell = await goodDollar.balanceOf(staker.address);
    expect(stakerGDBalanceAfterSell).to.be.equal(stakerGDBalanceBeforeSell);
  });
  it("should be able to buy gd with cDAI and the total gd should be increased", async () => {
    let amount = 1e8;
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let gdSupplyBefore = reserveToken.gdSupply;
    await cDAI.approve(exchangeHelper.address, amount);
    await exchangeHelper.buy([cDAI.address], amount, 0, 0, NULL_ADDRESS);
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let gdSupplyAfter = reserveToken.gdSupply;
    expect(gdSupplyAfter.gt(gdSupplyBefore)).to.be.true;
  });

  it("should be able to retain the precision when buying a low quantity of tokens", async () => {
    let amount = 1e8;
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await cDAI.approve(exchangeHelper.address, amount);
    await exchangeHelper.buy([cDAI.address], amount, 0, 0, NULL_ADDRESS);
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    const priceAfter = await goodReserve["currentPrice()"]();
    expect(Math.floor(priceAfter.toNumber() / 100).toString()).to.be.equal(
      Math.floor(priceBefore.toNumber() / 100).toString()
    );
  });

  it("should be able to sell gd to cDAI and reserve should be correct", async () => {
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalance = reserveToken.reserveSupply;
    let supply = reserveToken.gdSupply;
    let amount = BN.from("10000");
    await goodDollar.transfer(staker.address, amount);
    const cDAIBalanceBefore = await cDAI.balanceOf(staker.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    await goodDollar.connect(staker).approve(exchangeHelper.address, amount);
    const transaction = await (
      await exchangeHelper
        .connect(staker)
        .sell([cDAI.address], amount, 0, 0, NULL_ADDRESS)
    ).wait();

    const cDAIBalanceAfter = await cDAI.balanceOf(staker.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);

    // return = reserveBalance * (1 - (1 - sellAmount / supply) ^ (1000000 / reserveRatio))
    // if reserve ratio is 100% so:
    // return = reserve balance * (1 - (1 - sellAmount / supply))
    // the contribution ratio is 20%
    let expected =
      parseInt(reserveBalance.toString()) *
      (1 -
        (1 - amount.toNumber() / parseInt(supply.toString())) **
          (1000000 / reserveToken.reserveRatio));

    // expected = Math.ceil((0.8 * expected) / 100) * 100; //deduct 20% contribution, allow 2 points precission mismatch (due to bancor pow estimation?), match solidity no floating point
    expected = Math.floor(0.8 * expected);
    expect(cDAIBalanceAfter.sub(cDAIBalanceBefore)).to.be.equal(expected);
    expect(cDAIBalanceReserveBefore.sub(cDAIBalanceReserveAfter)).to.be.equal(
      expected
    );
  });

  it("should be able to buy gd with cDAI for some other address through buy", async () => {
    let amount = 1e8;
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(staker.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(founder.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await cDAI.approve(exchangeHelper.address, amount);
    let transaction = await (
      await exchangeHelper.buy([cDAI.address], amount, 0, 0, staker.address)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(staker.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(founder.address);
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
    expect(cDAIBalanceBefore.gt(cDAIBalanceAfter)).to.be.true;
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
    expect(transaction.events.find(_ => _.event === "TokenPurchased")).to.be.not
      .empty;
  });

  it("should be able to sell gd to cDAI without contribution through sell function for some other address", async () => {
    let amount = BN.from("10000");
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let reserveRatio = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceBefore = await cDAI.balanceOf(staker.address);
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    await goodDollar.approve(exchangeHelper.address, amount);
    let transaction = await (
      await exchangeHelper.sell([cDAI.address], amount, 0, 0, staker.address)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    const cDAIBalanceAfter = await cDAI.balanceOf(staker.address);
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    // according to the initialization settings reserve ratio is 100%. the calculation is:
    // Return = _reserveBalance * (1 - (1 - _sellAmount / _supply) ^ (1000000 / _reserveRatio))
    const bancor = await ethers.getContractAt(
      "BancorFormula",
      await marketMaker.getBancor()
    );
    const expectedReturn = await bancor.calculateSaleReturn(
      supplyBefore.toString(),
      reserveBalanceBefore.toString(),
      reserveRatio.toString(),
      amount
    );
    expect(cDAIBalanceAfter - cDAIBalanceBefore).to.be.equal(expectedReturn);
    expect(cDAIBalanceReserveBefore - cDAIBalanceReserveAfter).to.be.equal(
      expectedReturn
    );
    expect(reserveBalanceBefore.sub(reserveBalanceAfter)).to.be.equal(
      expectedReturn
    );
    // 1e4 gd sold (burn from the supply)
    expect(supplyBefore.sub(supplyAfter)).to.be.equal(amount);
    expect(gdBalanceBefore.gt(gdBalanceAfter)).to.be.true;
    expect(cDAIBalanceAfter.gt(cDAIBalanceBefore)).to.be.true;
    expect(transaction.events.find(_ => _.event === "TokenSold")).to.be.not
      .empty;
  });

  it("should be able to retain the precision when selling a low quantity of tokens", async () => {
    let amount = 1e1;
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    await goodDollar.approve(exchangeHelper.address, amount);
    await exchangeHelper.sell([cDAI.address], amount, 0, 0, NULL_ADDRESS);
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    const priceAfter = await goodReserve["currentPrice()"]();
    expect(Math.floor(priceAfter.toNumber() / 100).toString()).to.be.equal(
      Math.floor(priceBefore.toNumber() / 100).toString()
    );
  });

  //keep this test last as it ends the reserve
  it("should transfer cDAI funds to the given destination and transfer marker maker ownership", async () => {
    expect(await goodReserve.avatar()).to.equal(avatar);

    let avatarBalanceBefore = await cDAI.balanceOf(avatar);
    let reserveBalanceBefore = await cDAI.balanceOf(goodReserve.address);

    const reserveFactory = await ethers.getContractFactory("GoodReserveCDai");

    let encodedCall = reserveFactory.interface.encodeFunctionData("end");

    const ctrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    const tx = await (
      await ctrl.genericCall(goodReserve.address, encodedCall, avatar, 0)
    ).wait();

    let avatarBalanceAfter = await cDAI.balanceOf(avatar);
    let reserveBalanceAfter = await cDAI.balanceOf(goodReserve.address);

    expect(avatarBalanceAfter.sub(avatarBalanceBefore)).to.be.equal(
      reserveBalanceBefore
    );
    expect(reserveBalanceAfter.toString()).to.be.equal("0");
    expect(await goodDollar.isMinter(goodReserve.address)).to.be.false;
    expect(await goodDollar.isMinter(avatar)).to.be.true;
  });
});
