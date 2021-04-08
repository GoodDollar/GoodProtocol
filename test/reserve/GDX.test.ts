import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import { GoodMarketMaker, CERC20, GoodReserveCDai } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GDX - discount on exit contribution", () => {
  let dai;
  let cDAI, cDAI2;
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
    setDAOAddress;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const daiFactory = await ethers.getContractFactory("DAIMock");

    dai = await daiFactory.deploy();

    cDAI = await cdaiFactory.deploy(dai.address);

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      daoCreator,
      nameService,
      setDAOAddress: sda,
      setSchemes,
      marketMaker: mm
    } = await createDAO();

    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;

    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar
    });

    goodDollar = await ethers.getContractAt("GoodDollar", gd);
    contribution = await ethers.getContractAt(
      ContributionCalculation.abi,
      await nameService.getAddress("CONTRIBUTION_CALCULATION")
    );

    marketMaker = mm;

    const reserveFactory = await ethers.getContractFactory("GoodReserveCDai");

    console.log("deployed contribution, deploying reserve...", {
      mmOwner: await marketMaker.owner(),
      founder: founder.address
    });

    goodReserve = (await upgrades.deployProxy(
      reserveFactory,
      [controller, nameService.address, ethers.constants.HashZero],
      {
        initializer: "initialize(address,address, bytes)"
      }
    )) as GoodReserveCDai;

    console.log("setting permissions...");

    //give reserve generic call permission
    await setSchemes([goodReserve.address, schemeMock.address]);

    console.log("initializing marketmaker...");
    await marketMaker.initializeToken(
      cDAI.address,
      "100", //1gd
      "10000", //0.0001 cDai
      "1000000" //100% rr
    );

    await marketMaker.transferOwnership(goodReserve.address);

    await setDAOAddress("CDAI", cDAI.address);

    await setDAOAddress("MARKET_MAKER", marketMaker.address);

    //set contribution to 20%
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
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(contribution.address, encodedCall, avatar, 0);

    await goodReserve.start();
  });

  it("should get GDX for buying G$", async () => {
    let amount = 1e8;
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    await cDAI.approve(goodReserve.address, amount);
    let transaction = await (
      await goodReserve.buy(cDAI.address, amount, 0)
    ).wait();

    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);

    const gdx = await goodReserve["balanceOf(address)"](founder.address);

    expect(gdx).to.equal(gdBalanceAfter); //user should receive same amount of GDX as G$
    expect(gdx).to.gt(0);
  });

  it("should not pay exit contribution if has GDX", async () => {
    let amount = BN.from("10000");
    await goodDollar.approve(goodReserve.address, amount);
    let transaction = await (
      await goodReserve.sell(cDAI.address, amount, 0)
    ).wait();

    const event = transaction.events.find(_ => _.event === "TokenSold");
    expect(event.args.contributionAmount).to.equal(0);
  });

  it("should be able to transfer GDX", async () => {
    let amount = BN.from("10000");

    await goodReserve["transfer(address,uint256)"](staker.address, amount); //transfer gdx
    await goodDollar["transfer(address,uint256)"](staker.address, amount);

    await goodDollar.connect(staker).approve(goodReserve.address, amount);
    let transaction = await (
      await goodReserve.connect(staker).sell(cDAI.address, amount, 0)
    ).wait();

    const event = transaction.events.find(_ => _.event === "TokenSold");
    const gdxAfter = await goodReserve["balanceOf(address)"](staker.address);

    expect(gdxAfter).to.equal(0, "gdx not burned");
    expect(event.args.contributionAmount).to.equal(0);
  });

  it("should pay part of exit contribution if not enough GDX for full amount", async () => {
    let amount = BN.from("10000");

    const gdxBefore = await goodReserve["balanceOf(address)"](founder.address);
    await goodReserve.burn(gdxBefore.sub(amount.div(2))); //keep gdx equal to half of sell amount

    await goodDollar.approve(goodReserve.address, amount);
    let transaction = await (
      await goodReserve.sell(cDAI.address, amount, 0)
    ).wait();

    const event = transaction.events.find(_ => _.event === "TokenSold");
    const gdxAfter = await goodReserve["balanceOf(address)"](founder.address);

    expect(gdxAfter).to.equal(0, "gdx not burned");
    expect(event.args.contributionAmount).to.equal(
      amount
        .div(2)
        .mul(2)
        .div(10)
    ); //20% of 5000 (half of amount)
  });

  it("should airdrop gdx", async () => {
    const rFactory = await ethers.getContractFactory("GoodReserveCDai");

    let reserve = (await rFactory.deploy()) as GoodReserveCDai;
    const airdropBytes = ethers.utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]"],
      [signers.map(_ => _.address), signers.map(_ => 1000)]
    );

    await reserve["initialize(address,address,bytes32)"](
      controller,
      await goodReserve.nameService(),
      ethers.constants.HashZero
    );
    // let ps = signers.map(async s =>
    //   expect(await reserve.balanceOf(s.address)).to.equal(1000)
    // );

    // await Promise.all(ps);
  });

  it("should deploy bancorformula", async () => {
    const ff = await ethers.getContractFactory("BancorFormula");

    await ff.deploy();
  });
});
