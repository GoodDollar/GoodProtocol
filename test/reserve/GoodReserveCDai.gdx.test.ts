import { default as hre, ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber, Signer } from "ethers";
import { expect } from "chai";
import { GoodMarketMaker, CERC20, GoodReserveCDai } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";

const BN = ethers.BigNumber;
const RANDOM_GDX_MERKLEROOT1 =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GDX Token", () => {
  let dai;
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
    genericCall,
    setDAOAddress,
    runAsAvatarOnly;

  before(async () => {
    [founder, staker, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();

    let {
      controller: ctrl,
      avatar: av,
      reserve,
      gd,
      identity,
      daoCreator,
      nameService,
      setDAOAddress: sda,
      setSchemes,
      marketMaker: mm,
      daiAddress,
      cdaiAddress,
      genericCall: gn,
      runAsAvatarOnly: raao
    } = await loadFixture(createDAO);

    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);

    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    goodReserve = reserve as GoodReserveCDai;
    genericCall = gn;
    runAsAvatarOnly = raao;

    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar,
      goodReserve: goodReserve.address
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

    console.log("setting permissions...");

    //give reserve generic call permission
    await setSchemes([goodReserve.address]);

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

    await genericCall(contribution.address, encodedCall);
  });

  it("should have only role of admin assigned to avatar", async () => {
    expect(
      await goodReserve.hasRole(
        await goodReserve.MINTER_ROLE(),
        founder.address
      )
    ).to.be.false;

    expect(
      await goodReserve.hasRole(
        await goodReserve.DEFAULT_ADMIN_ROLE(),
        founder.address
      )
    ).to.be.false;

    expect(
      await goodReserve.hasRole(
        await goodReserve.PAUSER_ROLE(),
        founder.address
      )
    ).to.be.false;

    expect(
      await goodReserve.hasRole(
        await goodReserve.MINTER_ROLE(),
        goodReserve.address
      )
    ).to.be.false;

    expect(
      await goodReserve.hasRole(
        await goodReserve.DEFAULT_ADMIN_ROLE(),
        goodReserve.address
      )
    ).to.be.false;

    expect(
      await goodReserve.hasRole(
        await goodReserve.PAUSER_ROLE(),
        goodReserve.address
      )
    ).to.be.false;

    expect(await goodReserve.hasRole(await goodReserve.MINTER_ROLE(), avatar))
      .to.be.false;

    expect(
      await goodReserve.hasRole(await goodReserve.DEFAULT_ADMIN_ROLE(), avatar)
    ).to.be.true;

    expect(await goodReserve.hasRole(await goodReserve.PAUSER_ROLE(), avatar))
      .to.be.false;
  });

  it("should get GDX for buying G$", async () => {
    let amount = 1e8;
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    await cDAI.approve(goodReserve.address, amount);
    let transaction = await (
      await goodReserve.buy(amount, 0, NULL_ADDRESS)
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
      await goodReserve.sell(amount, 0, NULL_ADDRESS, NULL_ADDRESS)
    ).wait();

    const event = transaction.events.find(_ => _.event === "TokenSold");
    expect(event.args.contributionAmount).to.equal(0);
  });
  it("GDX should be 2 decimals", async () => {
    expect(await goodReserve.decimals()).to.be.equal(BN.from("2"));
  });
  it("should be able to transfer GDX", async () => {
    let amount = BN.from("10000");

    await goodReserve["transfer(address,uint256)"](staker.address, amount); //transfer gdx
    await goodDollar["transfer(address,uint256)"](staker.address, amount);

    await goodDollar.connect(staker).approve(goodReserve.address, amount);
    let transaction = await (
      await goodReserve
        .connect(staker)
        .sell(amount, 0, founder.address, NULL_ADDRESS)
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
      await goodReserve.sell(amount, 0, NULL_ADDRESS, NULL_ADDRESS)
    ).wait();

    const event = transaction.events.find(_ => _.event === "TokenSold");
    const gdxAfter = await goodReserve["balanceOf(address)"](founder.address);

    expect(gdxAfter).to.equal(0, "gdx not burned");
    expect(event.args.contributionAmount).to.equal(
      amount.div(2).mul(2).div(10)
    ); //20% of 5000 (half of amount)
  });

  it("should airdrop gdx", async () => {
    const rFactory = await ethers.getContractFactory("GoodReserveCDai");

    let reserve = (await rFactory.deploy()) as GoodReserveCDai;
    const airdropBytes = ethers.utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]"],
      [signers.map(_ => _.address), signers.map(_ => 1000)]
    );

    await reserve["initialize(address,bytes32)"](
      await goodReserve.nameService(),
      ethers.constants.HashZero
    );
    // let ps = signers.map(async s =>
    //   expect(await reserve.balanceOf(s.address)).to.equal(1000)
    // );

    // await Promise.all(ps);
  });

  it("should have airdrop merkle root set", async () => {
    expect(await goodReserve.gdxAirdrop()).to.be.equal(
      "0x26ef809f3f845395c0bc66ce1eea85146516cb99afd030e2085b13e79514e94c"
    );
  });

  xit("should set GDX airdrop by avatar", async () => {
    await runAsAvatarOnly(
      goodReserve,
      "setGDXAirdrop(bytes32)",
      RANDOM_GDX_MERKLEROOT1
    );
    expect(await goodReserve.gdxAirdrop()).to.equal(RANDOM_GDX_MERKLEROOT1);

    const originalGDXAirdrop =
      "0x26ef809f3f845395c0bc66ce1eea85146516cb99afd030e2085b13e79514e94c";
    const encodedCall = goodReserve.interface.encodeFunctionData(
      "setGDXAirdrop",
      [originalGDXAirdrop]
    );
    await genericCall(goodReserve.address, encodedCall);
  });

  //check sample proof generated by gdxAirdropCalculation.ts script
  xit("should be able to claim gdx", async () => {
    await goodReserve.claimGDX(
      "0x0EeBBbbf6f97e73dd1d59e4F17666B36Ea12dD85",
      1436983746,
      [
        "0x2f685e41aa5a2a212deba60ee842fca8ba073b1ea6f83bfa010fd94cb1513557",
        "0x99ffe11f552dce1827efc32d54b6be5aa79b288cc1fdb3c3848edb4dd842b117",
        "0xf0db8914b45ce55ea25be091e1fe4d897db4cff19e1b1680c37061a30a95c102",
        "0xc6e2cbda2531c708550b3856fc208355b184483e19ad6d8877a541c441ad3fef",
        "0x355c34cc000364d5a1cebe4835197936bc5966e3e8ac116a8fa20a8d2714f7c5",
        "0xd515f7a623c1a18396a6aececcdcae32818b64faa0f536103b3a32e8c5ae7643"
      ]
    );
    expect(
      await goodReserve["balanceOf(address)"](
        "0x0EeBBbbf6f97e73dd1d59e4F17666B36Ea12dD85"
      )
    ).to.equal(1436983746);
    expect(
      await goodReserve.isClaimedGDX(
        "0x0EeBBbbf6f97e73dd1d59e4F17666B36Ea12dD85"
      )
    ).to.be.true;
  });

  xit("should not be able to claim gdx twice", async () => {
    const tx = goodReserve.claimGDX(
      "0x0EeBBbbf6f97e73dd1d59e4F17666B36Ea12dD85",
      1436983746,
      [
        "0x2f685e41aa5a2a212deba60ee842fca8ba073b1ea6f83bfa010fd94cb1513557",
        "0x99ffe11f552dce1827efc32d54b6be5aa79b288cc1fdb3c3848edb4dd842b117",
        "0xf0db8914b45ce55ea25be091e1fe4d897db4cff19e1b1680c37061a30a95c102",
        "0xc6e2cbda2531c708550b3856fc208355b184483e19ad6d8877a541c441ad3fef",
        "0x355c34cc000364d5a1cebe4835197936bc5966e3e8ac116a8fa20a8d2714f7c5",
        "0xd515f7a623c1a18396a6aececcdcae32818b64faa0f536103b3a32e8c5ae7643"
      ]
    );
    await expect(tx).to.be.revertedWith("already claimed gdx");
  });
});
