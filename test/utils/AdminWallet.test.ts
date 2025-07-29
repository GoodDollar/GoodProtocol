import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { createDAO } from "../helpers";
import { Contract } from "ethers";
import { AdminWallet } from "../../types";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("AdminWallet", () => {
  let signers,
    adminWallet: AdminWallet,
    newUser,
    newUser2,
    admin,
    admin2,
    toWhitelist,
    toppingTimes,
    toppingAmount,
    founder,
    whitelisted,
    stranger,
    stranger2,
    blacklisted,
    identity,
    gooddollar;

  before(async () => {
    signers = await ethers.getSigners();
    founder = signers[0];
    [
      whitelisted,
      stranger,
      stranger2,
      blacklisted,
      newUser,
      newUser2,
      admin,
      admin2,
      toWhitelist
    ] = signers.slice(10);
    let { identity: id, nameService, gd } = await loadFixture(createDAO);
    identity = await ethers.getContractAt("IdentityV3", id);
    gooddollar = await ethers.getContractAt("GoodDollar", gd);
    adminWallet = (await upgrades.deployProxy(
      await ethers.getContractFactory("AdminWallet"),
      [[], nameService.address, signers[0].address, 1e10],
      { kind: "uups" }
    )) as AdminWallet;

    await identity.grantRole(
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("identity_admin")),
      adminWallet.address
    );

    toppingTimes = await adminWallet.toppingTimes();
    toppingAmount = await adminWallet.toppingAmount();
    const startBalance = await ethers.provider.getBalance(newUser.address);
    await Promise.all(
      [newUser, newUser2, admin, admin2, toWhitelist].map(acc =>
        acc.sendTransaction({
          to: ethers.constants.AddressZero,
          value: startBalance.sub(ethers.BigNumber.from("21000000000000")),
          gasLimit: 21000,
          gasPrice: 1e9
        })
      )
    );
  });

  it("should have zero balance for test accouts", async () => {
    await Promise.all(
      [newUser, newUser2, admin, admin2, toWhitelist].map(async acc => {
        expect(await ethers.provider.getBalance(acc.address)).eq(0);
      })
    );
  });

  it("should transfer to admins", async () => {
    await signers[0].sendTransaction({
      to: admin.address,
      value: toppingAmount / 4
    });
  });

  it("should fill wallet", async () => {
    await signers[0].sendTransaction({
      to: adminWallet.address,
      value: ethers.utils.parseUnits("50", "ether")
    });
  });

  it("should have owner", async () => {
    expect(
      await adminWallet.hasRole(ethers.constants.HashZero, signers[0].address)
    ).to.eq(true);
  });

  it("should not top admin list when empty", async () => {
    await expect(adminWallet["topAdmins(uint256)"](0)).revertedWith(
      /Admin list is empty/
    );
  });

  it("should add admins", async () => {
    await adminWallet.addAdmins(
      [whitelisted, admin, admin2].map(_ => _.address)
    );
    expect(await adminWallet.isAdmin(whitelisted.address)).true;
    expect(await adminWallet.isAdmin(admin.address)).to.true;
    expect(await adminWallet.isAdmin(admin2.address)).to.true;
  });

  it("should top admins", async () => {
    const oldBalance = await ethers.provider.getBalance(admin2.address);
    expect(oldBalance).to.be.equal("0");

    await adminWallet["topAdmins(uint256,uint256)"](0, 1); //test topping with indexes
    await adminWallet["topAdmins(uint256,uint256)"](1, 2);
    expect(await ethers.provider.getBalance(whitelisted.address)).gt(0);
    expect(await ethers.provider.getBalance(admin.address)).gt(0);
    expect(await ethers.provider.getBalance(admin2.address)).eq(0);
    await adminWallet["topAdmins(uint256)"](0);
    const newBalance = await ethers.provider.getBalance(admin2.address);
    const adminTopAmount = await adminWallet
      .adminToppingAmount()
      .then(_ => _.toString());
    expect(newBalance).to.be.equal(adminTopAmount);
  });

  it("should reimburse gas for admins", async () => {
    const expectedTopping = await adminWallet
      .adminToppingAmount()
      .then(_ => _.toString());
    const adminWalletBalance = await ethers.provider.getBalance(
      adminWallet.address
    );
    expect(expectedTopping).to.be.equal(
      ethers.utils.parseUnits("90000000", "gwei")
    );
    expect(adminWalletBalance).gt(1);
    let oldBalance = await ethers.provider.getBalance(admin2.address);
    let toTransfer = oldBalance.div(2);
    if (toTransfer.gt(0))
      await admin2.sendTransaction({
        to: founder.address,
        value: toTransfer
      });
    oldBalance = await ethers.provider.getBalance(admin2.address);
    expect(oldBalance).to.be.lte(toTransfer);

    await adminWallet
      .connect(admin2)
      ["whitelist(address,string)"](
        toWhitelist.address,
        "did:test" + Math.random()
      );
    const newBalance = await ethers.provider.getBalance(admin2.address);
    expect(newBalance).to.be.gte(expectedTopping);
  });

  it("should remove single admin", async () => {
    await adminWallet.removeAdmins([whitelisted.address]);
    expect(await adminWallet.isAdmin(whitelisted.address)).to.false;
  });

  it("should allow admin to whitelist and remove whitelist", async () => {
    expect(await identity.isWhitelisted(whitelisted.address)).to.false;
    await adminWallet
      .connect(admin)
      ["whitelist(address,string)"](whitelisted.address, "did:test");

    expect(await identity.isWhitelisted(whitelisted.address)).to.true;
    await adminWallet.connect(admin).removeWhitelist(whitelisted.address);
    expect(await identity.isWhitelisted(whitelisted.address)).to.false;
  });

  it("should not allow non-admin to whitelist and remove whitelist", async () => {
    expect(await identity.isWhitelisted(whitelisted.address)).to.false;
    await expect(
      adminWallet
        .connect(stranger)
        ["whitelist(address,string)"](whitelisted.address, "did:test")
    ).revertedWith(/Caller is not admin/);
    expect(await identity.isWhitelisted(whitelisted.address)).to.false;
    await adminWallet
      .connect(admin)
      ["whitelist(address,string)"](whitelisted.address, "did:test");
    expect(await identity.isWhitelisted(whitelisted.address)).to.true;
    await expect(
      adminWallet.connect(stranger).removeWhitelist(whitelisted.address)
    ).revertedWith(/Caller is not admin/);
    expect(await identity.isWhitelisted(whitelisted.address)).to.true;
  });

  it("should allow admin to blacklist and remove blacklist", async () => {
    expect(await identity.isBlacklisted(blacklisted.address)).to.false;
    await adminWallet.connect(admin).blacklist(blacklisted.address);

    expect(await identity.isBlacklisted(blacklisted.address)).to.true;
    await adminWallet.connect(admin).removeBlacklist(blacklisted.address);
    expect(await identity.isBlacklisted(blacklisted.address)).to.false;
  });

  it("should not allow non-admin to blacklist and remove blacklist", async () => {
    expect(await identity.isBlacklisted(blacklisted.address)).to.false;
    await expect(
      adminWallet.connect(stranger).blacklist(blacklisted.address)
    ).revertedWith(/Caller is not admin/);
    expect(await identity.isBlacklisted(blacklisted.address)).to.false;
    await adminWallet.connect(admin).blacklist(blacklisted.address);
    expect(await identity.isBlacklisted(blacklisted.address)).to.true;
    await expect(
      adminWallet.connect(stranger).removeBlacklist(blacklisted.address)
    ).revertedWith(/Caller is not admin/);
    expect(await identity.isBlacklisted(blacklisted.address)).to.true;
    await adminWallet.connect(admin).removeBlacklist(blacklisted.address);
    expect(await identity.isBlacklisted(blacklisted.address)).to.false;
  });

  it("should not allow to top wallet if user balance is too high", async () => {
    const walletBalance = await ethers.provider.getBalance(adminWallet.address);
    await expect(
      adminWallet.connect(admin).topWallet(whitelisted.address)
    ).revertedWith(/hasBalance/);
  });

  it("should not allow to top wallet if user gd balance unchanged", async () => {
    expect(await ethers.provider.getBalance(newUser.address)).eq(0);
    await expect(
      adminWallet.connect(admin).topWallet(newUser.address)
    ).revertedWith(/User has not used G\$/);
  });

  it("should allow to top wallet if user gd balance changed", async () => {
    expect(await ethers.provider.getBalance(newUser.address)).eq(0);
    await gooddollar.mint(newUser.address, 1);
    await adminWallet.connect(admin).topWallet(newUser.address);
    expect(await ethers.provider.getBalance(newUser.address)).gt(0);
    await newUser.sendTransaction({
      to: adminWallet.address,
      value: toppingAmount * 0.9
    });
  });

  it("should not allow to top wallet more than three times", async () => {
    await gooddollar.mint(newUser.address, 1);
    await adminWallet.connect(admin).topWallet(newUser.address);
    await newUser.sendTransaction({
      to: adminWallet.address,
      value: toppingAmount * 0.9
    });
    await founder.sendTransaction({
      to: admin2.address,
      value: toppingAmount / 5
    });
    await gooddollar.mint(newUser.address, 1);
    await adminWallet.connect(admin).topWallet(newUser.address);
    await newUser.sendTransaction({
      to: adminWallet.address,
      value: toppingAmount * 0.9
    });

    await gooddollar.mint(newUser.address, 1);
    await expect(
      adminWallet.connect(admin).topWallet(newUser.address)
    ).revertedWith(/User wallet has been topped too many times today/);
  });

  it("should whitelist user", async () => {
    expect(await identity.isWhitelisted(stranger2.address)).to.false;
    await adminWallet
      .connect(admin2)
      ["whitelist(address,string)"](stranger2.address, "did:test3");
    expect(await identity.isWhitelisted(stranger2.address)).to.true;
  });

  it("should not allow whitelisting with existing did", async () => {
    await expect(
      adminWallet
        .connect(admin2)
        ["whitelist(address,string)"](stranger.address, "did:test")
    ).revertedWith(/DID already registered/);
  });

  it("should not allow anyone to upgrade", async () => {
    await expect(
      adminWallet.connect(admin2).upgradeTo(adminWallet.address)
    ).revertedWith(/not owner/);
  });

  it("should allow owner to upgrade", async () => {
    const newver = await (
      await ethers.getContractFactory("AdminWallet")
    ).deploy();
    await expect(adminWallet.connect(founder).upgradeTo(newver.address)).not
      .reverted;

    await upgrades.forceImport(
      adminWallet.address,
      await ethers.getContractFactory("AdminWallet"),
      { kind: "uups" }
    );
    await expect(
      upgrades.upgradeProxy(
        adminWallet.address,
        await ethers.getContractFactory("AdminWallet")
      )
    ).not.throws;
  });
});
