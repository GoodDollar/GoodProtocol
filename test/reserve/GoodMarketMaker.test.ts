import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import { GoodMarketMaker, CERC20 } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime } from "../helpers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;

let cdai: CERC20;

describe("GoodMarketMaker - calculate gd value at reserve", () => {
  let goodDollar,
    controller,
    avatar,
    formula,
    marketMaker: GoodMarketMaker,
    dai,
    cdai,
    founder,
    staker,
    signers;

  const deployDAIMock = async () => {
    let [signer] = await ethers.getSigners();
    let cdai = await hre.artifacts.readArtifact("cERC20");
    let dai = ((await deployMockContract(
      signer,
      cdai.abi
    )) as unknown) as CERC20;
    dai.mock.decimals.returns(18);

    return dai.address;
  };

  const deploycDAIMock = async () => {
    let [signer] = await ethers.getSigners();
    let cdai = await hre.artifacts.readArtifact("cERC20");
    let dai = await deployMockContract(signer, cdai.abi);
    dai.mock.decimals.returns(8);
    return dai.address;
  };

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    cdai = await deploycDAIMock();
    dai = await deployDAIMock();

    let {
      controller: ctrl,
      avatar: av,
      gd: goodDollar,
      identity,
      daoCreator,
      nameService,
      marketMaker: mm
    } = await createDAO();
    avatar = av;
    marketMaker = mm;
    controller = ctrl;
    console.log("deployed dao", { goodDollar, identity, controller, avatar });

    //give founder generic call permission
    await daoCreator.setSchemes(
      avatar,
      [founder.address],
      [ethers.constants.HashZero],
      ["0x0000001F"],
      ""
    );

    console.log("starting tests...", { owner: await marketMaker.owner() });
  });

  it("should initialize a token with 0 ratio and the ratio should calculate as 100% by default", async () => {
    let dai = await deployDAIMock();
    await marketMaker.initializeToken(
      dai,
      "100",
      "10000",
      "0" //0% rr
    );
    let newreserveratio = await marketMaker.calculateNewReserveRatio(dai);
    expect(newreserveratio.toString()).to.be.equal("1000000"); // no need to expand at day 0
    await increaseTime(24 * 60 * 60);
    newreserveratio = await marketMaker.calculateNewReserveRatio(dai);
    expect(newreserveratio.toString()).to.be.equal("999388", "first expansion"); // result of initial expansion rate * 100% ratio
    await increaseTime(24 * 60 * 60 * 0.5); //expansion should happen at full day intervals
    newreserveratio = await marketMaker.calculateNewReserveRatio(dai);
    expect(newreserveratio.toString()).to.be.equal("999388", "day and half");
    await increaseTime(24 * 60 * 60 * 0.5); //expansion should happen at full day intervals
    newreserveratio = await marketMaker.calculateNewReserveRatio(dai);
    expect(newreserveratio.toString()).to.be.equal(
      "998778",
      "second expansion"
    );
  });

  it("should update token reserve ratio after first 24 hours", async () => {
    let dai1 = await deployDAIMock();
    await marketMaker.initializeToken(
      dai1,
      "100",
      "10000",
      "0" //0% rr
    );
    await increaseTime(24 * 60 * 60);
    await marketMaker.expandReserveRatio(dai1);
    const rr = await marketMaker.reserveTokens(dai1);
    expect(rr["1"].toString()).to.be.equal("999388"); // result of initial expansion rate * 100% ratio
  });

  it("should initialize token with price", async () => {
    const expansion = await marketMaker.initializeToken(
      cdai,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );
    const price = await marketMaker.currentPrice(cdai);
    expect(price.toString()).to.be.equal("10000"); //1gd is equal 0.0001 cDAI = 100000 wei;
    const onecDAIReturn = await marketMaker.buyReturn(
      cdai,
      "100000000" //1cDai
    );
    expect(onecDAIReturn.toNumber() / 100).to.be.equal(10000); //0.0001 cdai is 1 gd, so for 1eth you get 10000 gd (divide by 100 to account for 2 decimals precision)
  });

  it("should update reserve ratio by days passed", async () => {
    const expansion = await marketMaker.reserveRatioDailyExpansion();
    // 20% yearly. set up in the constructor
    expect(expansion.toString()).to.be.equal("999388834642296000000000000");
    await increaseTime(24 * 60 * 60);
    await marketMaker.expandReserveRatio(cdai);
    const daytwoRR = await marketMaker.reserveTokens(cdai);
    // after interval expansion
    expect(daytwoRR["1"].toString()).to.be.equal("999388");
    await increaseTime(24 * 60 * 60);
    await marketMaker.expandReserveRatio(cdai);
    const daythreeRR = await marketMaker.reserveTokens(cdai);
    // after interval expansion
    expect(daythreeRR["1"].toString()).to.be.equal("998777");
    await increaseTime(24 * 60 * 60 * 7);
    //after extra 7 days.
    await marketMaker.expandReserveRatio(cdai);
    expect(
      await marketMaker
        .reserveTokens(cdai)
        .then(_ => _["reserveRatio"].toString())
    ).to.be.equal("994511"); // 998777 * 0.999388834642296000000000000^7
  });

  it("should calculate mint UBI correctly for 8 decimals precision", async () => {
    const gdPrice = await marketMaker.currentPrice(cdai);
    const toMint = await marketMaker.calculateMintInterest(cdai, "100000000");
    const expectedTotalMinted = 10 ** 8 / gdPrice.toNumber(); //1cdai divided by gd price;
    expect(expectedTotalMinted).to.be.equal(10000); //1k GD since price is 0.0001 cdai for 1 gd
    expect(toMint.toString()).to.be.equal(
      (expectedTotalMinted * 100).toString()
    ); //add 2 decimals precision
  });

  it("should not return a sell contribution if the given gd is less than the given contribution amount", async () => {
    let dai = await deployDAIMock();

    const MM = await ethers.getContractFactory("GoodMarketMaker");
    const marketMaker1 = await upgrades.deployProxy(MM, [
      await marketMaker.nameService(),
      999388834642296,
      1e15
    ]);
    await marketMaker1.initializeToken(
      dai,
      "100", //1gd
      ethers.utils.parseEther("0.0001"),
      "800000" //80% rr
    );
    const res = marketMaker1.sellWithContribution(
      dai,
      ethers.utils.parseEther("1"),
      ethers.utils.parseEther("2")
    );
    expect(res).to.be.revertedWith(
      "GD amount is lower than the contribution amount"
    );
  });

  it("should be able to calculate and update bonding curve gd balance based on oncoming cDAI and the price stays the same", async () => {
    const priceBefore = await marketMaker.currentPrice(cdai);
    await marketMaker.mintInterest(cdai, BN.from(1e8));
    expect(
      Math.floor(
        (await marketMaker.currentPrice(cdai).then(_ => _.toNumber())) / 100
      ).toString()
    ).to.be.equal(Math.floor(priceBefore.toNumber() / 100).toString());
  });

  it("should not be able to mint interest by a non owner", async () => {
    let res = marketMaker.connect(staker).mintInterest(cdai, BN.from(1e8));

    expect(res).to.be.revertedWith("revert Ownable: caller is not the owner");
  });

  it("should not be able to mint expansion by a non owner", async () => {
    let res = marketMaker.connect(staker).mintExpansion(cdai);
    expect(res).to.be.revertedWith("revert Ownable: caller is not the owner");
  });

  it("should mint 0 gd tokens if the add token supply is 0", async () => {
    let reserveTokenBefore = await marketMaker.reserveTokens(cdai);
    let gdSupplyBefore = reserveTokenBefore.gdSupply;
    await marketMaker.mintInterest(cdai, "0");
    let reserveTokenAfter = await marketMaker.reserveTokens(cdai);
    let gdSupplyAfter = reserveTokenAfter.gdSupply;
    expect(gdSupplyAfter.toString()).to.be.equal(gdSupplyBefore.toString());
  });

  it("should be able to update the reserve ratio only by the owner", async () => {
    let res = marketMaker.connect(staker).expandReserveRatio(cdai);
    expect(res).to.be.revertedWith("revert Ownable: caller is not the owner");
  });

  it("should be able to mint interest only by the owner", async () => {
    let res = marketMaker.connect(staker).mintInterest(cdai, BN.from(1e8));
    expect(res).to.be.revertedWith("revert Ownable: caller is not the owner");
  });

  it("should be able to mint expansion only by the owner", async () => {
    let res = marketMaker.connect(staker).mintExpansion(cdai);
    expect(res).to.be.revertedWith("revert Ownable: caller is not the owner");
  });

  it("should be able to calculate minted gd based on expansion of reserve ratio, the price stays the same", async () => {
    let reserveTokenBefore = await marketMaker.reserveTokens(cdai);
    let reserveRatioBefore = reserveTokenBefore.reserveRatio;
    await increaseTime(24 * 60 * 60);
    const priceBefore = await marketMaker.currentPrice(cdai);
    const toMint = await marketMaker.calculateMintExpansion(cdai);
    expect(toMint.toString()).not.to.be.equal("0");
    const newRR = await marketMaker.calculateNewReserveRatio(cdai);
    expect(reserveRatioBefore.toString()).not.to.be.equal(newRR.toString());
    const priceAfter = await marketMaker.currentPrice(cdai);
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
  });

  it("should be able to calculate and update gd supply based on expansion of reserve ratio, the price stays the same", async () => {
    let reserveTokenBefore = await marketMaker.reserveTokens(cdai);
    let gdSupplyBefore = reserveTokenBefore.gdSupply;
    let reserveRatioBefore = reserveTokenBefore.reserveRatio;
    const priceBefore = await marketMaker.currentPrice(cdai);
    await marketMaker.mintExpansion(cdai);
    let reserveTokenAfter = await marketMaker.reserveTokens(cdai);
    let gdSupplyAfter = reserveTokenAfter.gdSupply;
    let reserveRatioAfter = reserveTokenAfter.reserveRatio;
    const priceAfter = await marketMaker.currentPrice(cdai);
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
    expect(gdSupplyBefore.toString()).not.to.be.equal(gdSupplyAfter.toString());
    expect(reserveRatioBefore.toString()).not.to.be.equal(
      reserveRatioAfter.toString()
    );
  });

  it("should have new return amount when RR is not 100%", async () => {
    const expansion = await marketMaker.initializeToken(
      dai,
      "100", //1gd
      ethers.utils.parseEther("0.0001"), //0.0001 dai
      "800000" //80% rr
    );
    const price = await marketMaker.currentPrice(dai);
    expect(price.toString()).to.be.equal("100000000000000"); //1gd is equal 0.0001 dai = 1000000000000000 wei;
    const oneDAIReturn = await marketMaker.buyReturn(
      dai,
      ethers.utils.parseEther("1") //1Dai
    );
    //bancor formula to calcualte return
    //gd return = gdsupply * ((1+tokenamount/tokensupply)^rr -1)
    const expectedReturn = 1 * ((1 + 1 / 0.0001) ** 0.8 - 1);
    expect(oneDAIReturn.toNumber() / 100).to.be.equal(
      Math.floor(expectedReturn * 100) / 100
    );
  });

  it("should calculate mint UBI correctly for 18 decimals precision", async () => {
    const gdPrice = await marketMaker.currentPrice(dai);
    const toMint = await marketMaker.calculateMintInterest(
      dai,
      ethers.utils.parseEther("1")
    );
    const expectedTotalMinted = 10 ** 18 / gdPrice.toNumber();
    // according to the sell formula the gd price should be 10^14 so 10^18 / 10^14 = 10^4
    // Return = _reserveBalance * (1 - (1 - _sellAmount / _supply) ^ (1000000 / _reserveRatio))
    expect(expectedTotalMinted).to.be.equal(10000);
    expect(toMint.toString()).to.be.equal(
      (expectedTotalMinted * 100).toString()
    );
  });

  it("should calculate sell return with cDAI", async () => {
    const gDReturn = await marketMaker.sellReturn(
      cdai,
      10 //0.1 gd
    );
    let reserveToken = await marketMaker.reserveTokens(cdai);
    let reserveBalance = reserveToken.reserveSupply.toNumber();
    let sellAmount = 10;
    let supply = reserveToken.gdSupply.toNumber();
    let rr = reserveToken.reserveRatio;
    // sell formula (as in calculateSaleReturn):
    // return = reserveBalance * (1 - (1 - sellAmount / supply) ^ (1000000 / reserveRatio))
    const expectedReturn =
      reserveBalance * (1 - (1 - sellAmount / supply) ** (1000000 / rr));
    expect(gDReturn.toNumber()).to.be.equal(Math.floor(expectedReturn));
  });

  it("should calculate sell return with DAI", async () => {
    const gDReturn = await marketMaker.sellReturn(
      dai,
      10 //0.1 gd
    );
    let reserveToken = await marketMaker.reserveTokens(dai);
    let reserveBalance = reserveToken.reserveSupply.toNumber();
    let sellAmount = 10;
    let supply = reserveToken.gdSupply.toNumber();
    let rr = reserveToken.reserveRatio;
    // sell formula (as in calculateSaleReturn):
    // return = reserveBalance * (1 - (1 - sellAmount / supply) ^ (1000000 / reserveRatio))
    const expectedReturn =
      reserveBalance * (1 - (1 - sellAmount / supply) ** (1000000 / rr));
    expect(gDReturn.toNumber()).to.be.equal(Math.floor(expectedReturn));
  });

  it("should be able to update balances based on buy return calculation", async () => {
    let reserveToken = await marketMaker.reserveTokens(dai);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    let amount = ethers.utils.parseEther("1");
    let transaction = await (
      await marketMaker.buy(
        dai,
        ethers.utils.parseEther("1") //1Dai
      )
    ).wait();
    reserveToken = await marketMaker.reserveTokens(dai);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    expect(transaction.events[0].event).to.be.equal("BalancesUpdated");
    expect(reserveBalanceAfter.sub(reserveBalanceBefore)).to.be.equal(
      BN.from(amount)
    );
    expect(supplyAfter.sub(supplyBefore)).to.be.equal(
      transaction.events[0].args.returnAmount
    );
    expect(rrAfter.toString()).to.be.equal(rrBefore.toString());
  });

  it("should be able to update balances based on sell return calculation", async () => {
    let reserveToken = await marketMaker.reserveTokens(dai);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    let amount = 100;
    let transaction = await (
      await marketMaker.sellWithContribution(dai, 100, 0)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(dai);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    expect(transaction.events[0].event).to.be.equal("BalancesUpdated");
    expect(
      reserveBalanceAfter
        .add(transaction.events[0].args.returnAmount)
        .toString()
    ).to.be.equal(reserveBalanceBefore.toString());
    expect(supplyBefore.sub(supplyAfter)).to.be.equal(BN.from(amount));
    expect(rrAfter.toString()).to.be.equal(rrBefore.toString());
  });

  it("should be able to update balances based on sell with contribution return calculation", async () => {
    let reserveToken = await marketMaker.reserveTokens(dai);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    let amount = 100;
    let transaction = await (
      await marketMaker.sellWithContribution(dai, 100, 80)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(dai);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    expect(transaction.events[0].event).to.be.equal("BalancesUpdated");
    expect(
      reserveBalanceAfter
        .add(transaction.events[0].args.returnAmount)
        .toString()
    ).to.be.equal(reserveBalanceBefore.toString());
    expect(supplyBefore.sub(supplyAfter)).to.be.equal(BN.from(amount));
    expect(rrAfter.toString()).to.be.equal(rrBefore.toString());
  });

  it("should not be able to calculate the buy return in gd and update the bonding curve params by a non-owner account", async () => {
    let res = marketMaker
      .connect(staker)
      .buy(dai, ethers.utils.parseEther("1"));
    expect(res).to.be.revertedWith("revert Ownable: caller is not the owner");
  });

  it("should not be able to calculate the sell return in reserve token and update the bonding curve params by a non-owner account", async () => {
    let res = marketMaker.connect(staker).sellWithContribution(dai, 100, 0);
    expect(res).to.be.revertedWith("revert Ownable: caller is not the owner");
  });

  it("should not be able to calculate the sellWithContribution return in reserve token and update the bonding curve params by a non-owner account", async () => {
    let res = marketMaker.connect(staker).sellWithContribution(dai, 100, 80);
    expect(res).to.be.revertedWith("revert Ownable: caller is not the owner");
  });

  it("should be able to buy only with active token", async () => {
    let reserveToken = await marketMaker.reserveTokens(cdai);
    let gdSupplyBefore = reserveToken.gdSupply;
    let reserveSupplyBefore = reserveToken.reserveSupply;
    let reserveRatioBefore = reserveToken.reserveRatio;
    await marketMaker.initializeToken(
      cdai,
      "0",
      reserveSupplyBefore.toString(),
      reserveRatioBefore.toString()
    );
    let res = marketMaker.buy(cdai, ethers.utils.parseEther("1"));
    expect(res).to.be.revertedWith("Reserve token not initialized");
    await marketMaker.initializeToken(
      cdai,
      gdSupplyBefore,
      reserveSupplyBefore.toString(),
      reserveRatioBefore.toString()
    );
  });

  it("should be able to sell only with active token", async () => {
    let res = marketMaker.sellWithContribution(
      NULL_ADDRESS,
      ethers.utils.parseEther("1"),
      0
    );

    expect(res).to.be.revertedWith("Reserve token not initialized");
  });

  it("should be able to sellWithContribution only with active token", async () => {
    let res = marketMaker.sellWithContribution(
      NULL_ADDRESS,
      ethers.utils.parseEther("1"),
      ethers.utils.parseEther("1")
    );
    expect(res).to.be.revertedWith("Reserve token not initialized");
  });

  it("should be able to sell gd only when the amount is lower than the total supply", async () => {
    let reserveToken = await marketMaker.reserveTokens(cdai);
    let gdSupply = reserveToken.gdSupply;
    let res = marketMaker.sellWithContribution(
      cdai,
      gdSupply.add(BN.from(1)),
      0
    );
    expect(res).to.be.revertedWith("GD amount is higher than the total supply");
  });

  it("should set reserve ratio daily expansion by owner", async () => {
    let denom = BN.from(1e15);
    const MM = await ethers.getContractFactory("GoodMarketMaker");
    const ctrl = await ethers.getContractAt("Controller", controller, founder);

    let currentReserveRatioDailyExpansion = await marketMaker.reserveRatioDailyExpansion();
    await marketMaker.setReserveRatioDailyExpansion(1, 1e15);

    let newReserveRatioDailyExpansion = await marketMaker.reserveRatioDailyExpansion();
    expect(newReserveRatioDailyExpansion).to.be.equal(BN.from("1000000000000"));

    await marketMaker.setReserveRatioDailyExpansion(999388834642296, 1e15);

    let reserveRatioDailyExpansion = await marketMaker.reserveRatioDailyExpansion();
    expect(reserveRatioDailyExpansion).to.be.equal(
      BN.from("999388834642296000000000000")
    );
  });

  it("should be able to set the reserve ratio daily expansion only by the owner", async () => {
    let res = marketMaker
      .connect(staker)
      .setReserveRatioDailyExpansion(1, 1e15);
    expect(res).to.be.revertedWith("revert Ownable: caller is not the owner");
  });

  it("should calculate amount of gd to mint based on incoming cDAI without effecting bonding curve price", async () => {
    const priceBefore = await marketMaker.currentPrice(dai);
    const toMint = await marketMaker.calculateMintInterest(
      dai,
      BN.from("1000000000000000000")
    );
    const totalMinted = 1e18 / priceBefore.toNumber();
    expect(toMint.toString()).to.be.equal(
      Math.floor(totalMinted * 100).toString()
    );
    const priceAfter = await marketMaker.currentPrice(dai);
    expect(priceBefore.toString()).to.be.equal(priceAfter.toString());
  });

  it("should not change the reserve ratio when calculate how much decrease it for the reservetoken", async () => {
    let reserveTokenBefore = await marketMaker.reserveTokens(cdai);
    let reserveRatioBefore = reserveTokenBefore.reserveRatio;
    await marketMaker.calculateNewReserveRatio(cdai);
    let reserveTokenAfter = await marketMaker.reserveTokens(cdai);
    let reserveRatioAfter = reserveTokenAfter.reserveRatio;
    expect(reserveRatioBefore.toString()).to.be.equal(
      reserveRatioAfter.toString()
    );
  });

  it("should not change the gd supply when calculate how much gd to mint based on added token supply from interest", async () => {
    let reserveTokenBefore = await marketMaker.reserveTokens(cdai);
    let gdSupplyBefore = reserveTokenBefore.gdSupply;
    await marketMaker.calculateMintInterest(cdai, "100000000");
    let reserveTokenAfter = await marketMaker.reserveTokens(cdai);
    let gdSupplyAfter = reserveTokenAfter.gdSupply;
    expect(gdSupplyAfter.toString()).to.be.equal(gdSupplyBefore.toString());
  });

  it("should not change the gd supply when calculate how much gd to mint based on expansion change", async () => {
    let reserveTokenBefore = await marketMaker.reserveTokens(cdai);
    let gdSupplyBefore = reserveTokenBefore.gdSupply;
    await marketMaker.calculateMintExpansion(cdai);
    let reserveTokenAfter = await marketMaker.reserveTokens(cdai);
    let gdSupplyAfter = reserveTokenAfter.gdSupply;
    expect(gdSupplyAfter.toString()).to.be.equal(gdSupplyBefore.toString());
  });
});
