import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { GoodReserveCDai, DistributionHelper } from "../../types";
import { createDAO, increaseTime } from "../helpers";
import { Contract } from "ethers";
import { FormatTypes } from "@ethersproject/abi";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GoodReserve - Distribution Helper", () => {
  let goodReserve: GoodReserveCDai;
  let goodDollar: Contract,
    genericCall,
    avatar,
    founder,
    signers,
    dai,
    cDAI,
    setDAOAddress;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      setDAOAddress: sda,
      setSchemes,
      reserve,
      daiAddress,
      cdaiAddress,
      genericCall: gc
    } = await loadFixture(createDAO);

    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);

    genericCall = gc;
    avatar = av;
    setDAOAddress = sda;

    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      avatar
    });

    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });

    goodReserve = reserve as GoodReserveCDai;

    console.log("setting permissions...");
  });

  const fixture = async (wallets, provider) => {
    let encodedCall = goodReserve.interface.encodeFunctionData("grantRole", [
      await goodReserve.PAUSER_ROLE(),
      avatar
    ]);
    await genericCall(goodReserve.address, encodedCall);

    encodedCall = goodReserve.interface.encodeFunctionData("pause");
    await genericCall(goodReserve.address, encodedCall);

    return { goodReserve };
  };

  it("should allow avatar to unpause", async () => {
    const { goodReserve } = await loadFixture(fixture);
    const encodedCall = goodReserve.interface.encodeFunctionData("unpause");

    expect(await goodReserve.paused()).to.equal(true);
    await genericCall(goodReserve.address, encodedCall);

    expect(await goodReserve.paused()).to.equal(false);
  });

  it("should not be able to buy when paused", async () => {
    let amount = 1e8;
    const { goodReserve } = await loadFixture(fixture);
    await dai["mint(uint256)"](ethers.utils.parseEther("100"));
    await dai.approve(cDAI.address, ethers.utils.parseEther("100"));
    await cDAI["mint(uint256)"](ethers.utils.parseEther("100"));
    await cDAI.approve(goodReserve.address, ethers.utils.parseEther("10"));
    await expect(goodReserve.buy(amount, 0, founder.address)).revertedWith(
      /paused/
    );
  });

  it("should not be able to sell when paused", async () => {
    const { goodReserve } = await loadFixture(fixture);
    await expect(
      goodReserve.sell(1, 0, founder.address, founder.address)
    ).revertedWith(/paused/);
  });

  it("should not be able to mint when paused", async () => {
    const { goodReserve } = await loadFixture(fixture);
    await setDAOAddress("FUND_MANAGER", founder.address);

    await expect(
      goodReserve
        .connect(founder)
        .mintRewardFromRR(cDAI.address, founder.address, 1000)
    ).revertedWith(/paused/); //10000 cdai wei is 1G$
  });
});
