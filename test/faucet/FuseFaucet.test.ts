import hre, { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { FuseFaucet, IGoodDollar, IIdentity } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO } from "../helpers";

const BN = ethers.BigNumber;

describe("FuseFaucet", () => {
  let faucet: FuseFaucet, founder: SignerWithAddress;
  let user1 = ethers.Wallet.createRandom().connect(ethers.provider);
  let user2 = ethers.Wallet.createRandom().connect(ethers.provider);
  let signers;

  let avatar, gd: IGoodDollar, Controller, id: IIdentity, ns;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();

    const FuseFaucetF = await ethers.getContractFactory("FuseFaucet");

    let { daoCreator, controller, avatar: av, gd: gooddollar, identity, nameService } = await loadFixture(createDAO);

    Controller = controller;
    avatar = av;
    ns = nameService.address;

    // await daoCreator.setSchemes(
    //   avatar,
    //   [identity],
    //   [ethers.constants.HashZero],
    //   ["0x0000001F"],
    //   ""
    // );

    faucet = (await upgrades.deployProxy(FuseFaucetF, [identity], {
      kind: "transparent"
    })) as FuseFaucet;

    gd = (await ethers.getContractAt("IGoodDollar", gooddollar, founder)) as IGoodDollar;
    id = (await ethers.getContractAt("IIdentity", identity, founder)) as IIdentity;

    await founder.sendTransaction({
      value: ethers.utils.parseEther("1"),
      to: faucet.address
    });
  });

  it("v1 should be upgradeable via old proxy method (for fuse)", async () => {
    const FaucetV1 = await ethers.getContractFactory("FuseFaucet");
    const faucet = await upgrades.deployProxy(FaucetV1, [id.address], {
      kind: "transparent"
    });
    const res = await upgrades.upgradeProxy(faucet.address, await ethers.getContractFactory("FuseFaucetV2"), {
      kind: "transparent",
      unsafeAllowRenames: true,
      call: { fn: "upgrade", args: [signers[1].address, founder.address, ns] }
    });
    expect(res).not.empty;
    await expect(res.upgrade(signers[0].address, signers[0].address, ns)).revertedWith("wrong upgrade version");
    expect(await res.owner()).equal(founder.address);
    expect(await res.relayer()).equal(signers[1].address);
  });

  it("should have balance", async () => {
    const balance = await ethers.provider.getBalance(faucet.address);
    expect(balance).to.equal(ethers.utils.parseEther("1"));
  });

  it("should let new user top once", async () => {
    expect(await faucet.canTop(user1.address)).to.true;
    const tx = await (await faucet.topWallet(user1.address)).wait();
    const balance = await ethers.provider.getBalance(user1.address);
    expect(balance).to.equal(await faucet.toppingAmount());
  });

  it("should not let new user top more than once", async () => {
    await user1.sendTransaction({
      to: ethers.constants.AddressZero,
      value: ethers.utils.parseUnits("400000", "gwei")
    });
    expect(await faucet.canTop(user1.address)).to.false;
    await expect(faucet.topWallet(user1.address)).to.revertedWith("User not whitelisted or not first time");
  });

  it("should not refund gas when reverted", async () => {
    const balance = await ethers.provider.getBalance(founder.address);
    const faucetBalance = await ethers.provider.getBalance(faucet.address);
    expect(await faucet.canTop(user1.address)).to.false;
    await expect(faucet.topWallet(user1.address)).to.revertedWith("User not whitelisted or not first time");
    const balanceAfter = await ethers.provider.getBalance(founder.address);
    const faucetBalanceAfter = await ethers.provider.getBalance(faucet.address);
    expect(faucetBalanceAfter).to.eq(faucetBalance);
    expect(balanceAfter).to.lt(balance);
  });

  it("should let user top again once identified", async () => {
    await id.addWhitelistedWithDID(user1.address, "did:1");
    expect(await faucet.canTop(user1.address)).to.true;
    const tx = await (await faucet.topWallet(user1.address)).wait();
    console.log(tx.gasUsed.toString());
    const balance = await ethers.provider.getBalance(user1.address);
    expect(balance).to.equal(await faucet.toppingAmount());
  });

  it("should not let identified user top over daily limit", async () => {
    await user1.sendTransaction({
      to: ethers.constants.AddressZero,
      value: ethers.utils.parseUnits("400000", "gwei")
    });
    const tx = await (await faucet.topWallet(user1.address)).wait();
    await user1.sendTransaction({
      to: ethers.constants.AddressZero,
      value: ethers.utils.parseUnits("400000", "gwei")
    });
    expect(await faucet.canTop(user1.address)).to.false;
    await expect(faucet.topWallet(user1.address)).to.revertedWith("max daily toppings");
  });

  // it("should not top if wallet not half empty", async () => {
  //   expect(await faucet.canTop(founder.address)).to.false;
  //   await expect(faucet.topWallet(founder.address)).to.revertedWith(
  //     "User balance above minimum"
  //   );
  // });

  it("should not let user top over weekly limit", async () => {
    for (let i = 0; i < 5; i++) {
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24]);
      await (await faucet.topWallet(user1.address)).wait();
      await user1.sendTransaction({
        to: ethers.constants.AddressZero,
        value: ethers.utils.parseUnits("5000000", "gwei")
      });
    }
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24]);

    expect(await faucet.canTop(user1.address)).to.false;
    await expect(faucet.topWallet(user1.address)).to.revertedWith(
      "User wallet has been topped too many times this week"
    );

    //should be able to top again after some days passed
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 3]);
    await ethers.provider.send("evm_mine", []);

    expect(await faucet.canTop(user1.address)).to.true;
  });

  it("should reimburse gas costs", async () => {
    const balance = await ethers.provider.getBalance(founder.address);
    const tx = await (await faucet.topWallet(user2.address, { gasPrice: 1e9 })).wait();
    // const gasCosts = tx.gasUsed.mul(1e9);
    // const afterRefund = gasCosts.sub(await faucet["gasRefund()"]());
    const balanceAfter = await ethers.provider.getBalance(founder.address);
    const diff = balance.sub(balanceAfter).toNumber();
    expect(diff).to.lt(10000);
  });
});
