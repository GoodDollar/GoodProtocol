import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { SuperGoodDollar } from "../../types";
import { createDAO } from "../helpers";
import { BigNumber } from "ethers";

const BN = ethers.BigNumber;

describe("Celo Gas Token", () => {
  let token: SuperGoodDollar, founder;
  let signers;

  const initialState = async () => {};

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();

    let { gd: gooddollar } = await loadFixture(createDAO);

    token = (await ethers.getContractAt(
      "SuperGoodDollar",
      gooddollar
    )) as SuperGoodDollar;
    await token.mint(founder.address, ethers.constants.WeiPerEther.mul(100));
  });

  it("should debit sender for gas fees", async () => {
    await loadFixture(initialState);

    await founder.sendTransaction({
      to: ethers.constants.AddressZero,
      value: ethers.constants.WeiPerEther
    });
    const vm = await ethers.getImpersonatedSigner(ethers.constants.AddressZero);
    let ts = await token.totalSupply();
    let balance = await token.balanceOf(founder.address);
    const fee = ethers.constants.WeiPerEther.div(100);
    await token.connect(vm).debitGasFees(founder.address, BigNumber.from(fee));
    expect(await token.balanceOf(founder.address)).eq(balance.sub(fee));
    expect(await token.totalSupply()).eq(ts.sub(fee));
  });

  it("should credit sender for gas fees", async () => {
    await loadFixture(initialState);

    await founder.sendTransaction({
      to: ethers.constants.AddressZero,
      value: ethers.constants.WeiPerEther
    });
    const vm = await ethers.getImpersonatedSigner(ethers.constants.AddressZero);
    let ts = await token.totalSupply();
    let balance = await token.balanceOf(founder.address);
    const fee = ethers.constants.WeiPerEther.div(100);

    const [recipient, gateway, fund] = signers;
    const [refund, recipientFee, gatewayFee, fundFee] = [
      fee.div(10),
      fee.div(100),
      fee.div(200),
      fee.div(300)
    ];

    await token.connect(vm).debitGasFees(founder.address, BigNumber.from(fee));
    await token
      .connect(vm)
      .creditGasFees(
        founder.address,
        recipient.address,
        gateway.address,
        fund.address,
        refund,
        recipientFee,
        gatewayFee,
        fundFee
      );

    expect(await token.balanceOf(founder.address)).eq(
      balance.sub(fee).add(refund)
    );
    expect(await token.balanceOf(recipient.address)).eq(recipientFee);
    expect(await token.balanceOf(gateway.address)).eq(gatewayFee);
    expect(await token.balanceOf(fund.address)).eq(fundFee);
    expect(await token.totalSupply()).eq(
      ts.sub(fee).add(refund).add(recipientFee).add(gatewayFee).add(fundFee)
    );
  });

  it("should only be callable by VM", async () => {
    await loadFixture(initialState);

    await expect(
      token.debitGasFees(founder.address, BigNumber.from(1))
    ).revertedWith("VM");
    await expect(
      token.creditGasFees(
        founder.address,
        founder.address,
        founder.address,
        founder.address,
        1,
        1,
        1,
        1
      )
    ).revertedWith("VM");
  });
});
