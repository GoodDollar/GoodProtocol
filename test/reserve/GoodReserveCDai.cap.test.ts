import { default as hre, ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { GoodMarketMaker, CERC20, GoodReserveCDai } from "../../types";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import { Contract } from "ethers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GoodReserve - Enforce token cap", () => {
  let goodReserve: GoodReserveCDai;
  let goodDollar: Contract,
    avatar,
    controller,
    founder,
    staker,
    granted,
    schemeMock,
    signers,
    setDAOAddress,
    cDai;

  before(async () => {
    [founder, staker, granted, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      nameService,
      setDAOAddress: sda,
      setSchemes,
      marketMaker: mm,
      reserve,
      cdaiAddress
    } = await loadFixture(createDAO);

    cDai = cdaiAddress;
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

    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });

    goodReserve = reserve as GoodReserveCDai;

    console.log("setting permissions...");
  });

  it("should not be able to mint if not minter", async () => {
    await expect(
      goodReserve.mintRewardFromRR(cDai, founder.address, 10)
    ).to.be.revertedWith("GoodReserve: not a minter");
  });

  it("should be able to mint if fund_manager contract and Reserve is minter", async () => {
    let currentPrice = await goodReserve["currentPrice()"]();
    expect(currentPrice).to.be.gt(0, "should have cDai price");
    expect(await goodReserve["currentPriceDAI()"]()).to.be.gt(
      0,
      "should have Dai price"
    );

    await setDAOAddress("FUND_MANAGER", founder.address);

    await goodReserve
      .connect(founder)
      .mintRewardFromRR(cDai, founder.address, 1000); //10000 cdai wei is 1G$
    expect(await goodDollar.balanceOf(founder.address)).to.equal(1000);

    await goodReserve
      .connect(founder)
      .mintRewardFromRR(cDai, founder.address, 10);
    expect(await goodDollar.balanceOf(founder.address)).to.equal(1010);
    currentPrice = await goodReserve["currentPrice()"]();
    expect(currentPrice).to.be.gt(0, "should have cDai price");
  });

  it("should be able to mint after Avatar renounceMinter", async () => {
    expect(await goodDollar.isMinter(avatar)).to.be.true;

    let encodedCall = goodDollar.interface.encodeFunctionData(
      "renounceMinter",
      []
    );
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(goodDollar.address, encodedCall, avatar, 0);

    expect(await goodDollar.isMinter(avatar)).to.be.false;
    await goodReserve
      .connect(founder)
      .mintRewardFromRR(cDai, founder.address, 10);
    expect(await goodDollar.balanceOf(founder.address)).to.equal(1020);

    encodedCall = goodDollar.interface.encodeFunctionData("addMinter", [
      avatar
    ]);

    await ictrl.genericCall(goodDollar.address, encodedCall, avatar, 0);
  });

  it("should not be able to mint if not core contract and GoodReserve is minter", async () => {
    await setDAOAddress("FUND_MANAGER", staker.address);

    let encodedCall = goodDollar.interface.encodeFunctionData("addMinter", [
      goodReserve.address
    ]);
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(goodDollar.address, encodedCall, avatar, 0);

    await expect(
      goodReserve.connect(founder).mintRewardFromRR(cDai, founder.address, 10)
    ).to.be.revertedWith("GoodReserve: not a minter");
  });

  it("should not be able to grant minter role if not Avatar", async () => {
    await expect(
      goodReserve.grantRole(
        await goodReserve.RESERVE_MINTER_ROLE(),
        granted.address
      )
    ).to.be.revertedWith("is missing role");
  });

  it("should be able to grant minter role if Avatar", async () => {
    let encodedCall = goodReserve.interface.encodeFunctionData("grantRole", [
      await goodReserve.RESERVE_MINTER_ROLE(),
      granted.address
    ]);
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(goodReserve.address, encodedCall, avatar, 0);
    expect(
      await goodReserve.hasRole(
        await goodReserve.RESERVE_MINTER_ROLE(),
        granted.address
      )
    ).to.be.true;
  });

  it("should be able to mint if granted RESERVE_MINTER_ROLE role", async () => {
    await goodReserve
      .connect(granted)
      .mintRewardFromRR(cDai, founder.address, 10);
    expect(await goodDollar.balanceOf(founder.address)).to.equal(1030);
  });

  it("should enforce cap", async () => {
    await expect(
      goodReserve
        .connect(granted)
        .mintRewardFromRR(cDai, founder.address, 22 * 1e14)
    ).to.be.revertedWith("GoodReserve: cap enforced");
  });

  it("should be able to revoke minter role if Avatar", async () => {
    let encodedCall = goodReserve.interface.encodeFunctionData("revokeRole", [
      await goodReserve.RESERVE_MINTER_ROLE(),
      granted.address
    ]);
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(goodReserve.address, encodedCall, avatar, 0);
    expect(
      await goodReserve.hasRole(
        await goodReserve.RESERVE_MINTER_ROLE(),
        granted.address
      )
    ).to.be.false;
  });

  it("should not have cap on mintTokens if not registered as GlobalConstraint", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await expect(ictrl.mintTokens(1000000, granted.address, avatar)).to.not
      .reverted; //cap not passed
    expect(await goodDollar.balanceOf(granted.address)).to.equal(1000000);
    await goodDollar.connect(granted).burn(1000000);
  });

  it("should prevent Controller mintToken if registered as GlobalConstraint", async () => {
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.addGlobalConstraint(
      goodReserve.address,
      ethers.constants.HashZero,
      avatar
    );

    await expect(ictrl.mintTokens(10, granted.address, avatar)).to.be.reverted; //cap not passed
  });

  //this test end reserve, keep it last
  it("should not be able to mint if Reserve not given GoodDollar minter role by DAO", async () => {
    await setDAOAddress("FUND_MANAGER", founder.address);
    expect(await goodDollar.isMinter(goodReserve.address)).to.be.true;
    let encodedCall = goodReserve.interface.encodeFunctionData("end");
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(goodReserve.address, encodedCall, avatar, 0);

    expect(await goodDollar.isMinter(goodReserve.address)).to.be.false;

    await expect(goodReserve.mintRewardFromRR(cDai, founder.address, 10)).to.be
      .reverted;
  });
});
