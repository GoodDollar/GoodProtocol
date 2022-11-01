import hre, { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { IGoodDollar, IIdentityV2, IIdentity, IdentityV2 } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime } from "../helpers";

const BN = ethers.BigNumber;

describe("Identity", () => {
  let identity: IdentityV2, founder: SignerWithAddress;
  let user1 = ethers.Wallet.createRandom().connect(ethers.provider);
  let user2 = ethers.Wallet.createRandom().connect(ethers.provider);
  let signers;

  let avatar, gd: IGoodDollar, Controller, id: IIdentity;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();

    let {
      controller,
      avatar: av,
      gd: gooddollar,
      identity: idv2
    } = await loadFixture(createDAO);

    identity = (await ethers.getContractAt("IdentityV2", idv2)) as IdentityV2;
    Controller = controller;
    avatar = av;
    // await daoCreator.setSchemes(
    //   avatar,
    //   [identity],
    //   [ethers.constants.HashZero],
    //   ["0x0000001F"],
    //   ""
    // );

    gd = (await ethers.getContractAt(
      "IGoodDollar",
      gooddollar,
      founder
    )) as IGoodDollar;
  });

  it("should set DAO by creator", async () => {
    let f = await ethers.getContractFactory("IdentityV2");
    let newid = (await upgrades.deployProxy(
      f,
      [signers[0].address, ethers.constants.AddressZero],
      { kind: "uups" }
    )) as IdentityV2;
    expect(await newid.dao()).eq(ethers.constants.AddressZero);
    await expect(
      newid.connect(signers[0]).initDAO(await identity.nameService())
    ).not.reverted;
    expect(await newid.dao()).not.eq(ethers.constants.AddressZero);
  });

  it("should not be able to set DAO by non-creator", async () => {
    let f = await ethers.getContractFactory("IdentityV2");
    let newid = (await upgrades.deployProxy(
      f,
      [signers[0].address, ethers.constants.AddressZero],
      { kind: "uups" }
    )) as IdentityV2;
    expect(await newid.dao()).eq(ethers.constants.AddressZero);
    await expect(newid.initDAO(await identity.nameService())).reverted;
  });

  it("should blacklist address", async () => {
    let blacklisted = signers[1];
    await identity.addBlacklisted(blacklisted.address);
    expect(await identity.isBlacklisted(blacklisted.address)).true;

    await identity.removeBlacklisted(blacklisted.address);
    expect(await identity.isBlacklisted(blacklisted.address)).false;
  });

  it("should add, check and remove whitelisted", async () => {
    let whitelisted = signers[1];
    await identity.addWhitelisted(whitelisted.address);
    expect(await identity.isWhitelisted(whitelisted.address)).true;
    const id = await identity.identities(whitelisted.address);
    expect(id.whitelistedOnChainId).gt(0);

    await identity.removeWhitelisted(whitelisted.address);
    expect(await identity.isWhitelisted(whitelisted.address)).false;
  });

  it("should increment and decrement whitelisteds when adding whitelisted", async () => {
    let whitelisted = signers[1];
    const oldWhitelistedCount = (await identity.whitelistedCount()) as any;

    await identity.addWhitelisted(whitelisted.address);

    const diffWhitelistedCount = (
      (await identity.whitelistedCount()) as any
    ).sub(oldWhitelistedCount);
    expect(diffWhitelistedCount.toString()).to.be.equal("1");

    await identity.removeWhitelisted(whitelisted.address);

    const whitelistedCount = (await identity.whitelistedCount()) as any;
    expect(whitelistedCount.toString()).to.be.equal(
      oldWhitelistedCount.toString()
    );
  });

  it("should revert when non admin tries to add whitelisted", async () => {
    let whitelisted = signers[1];
    await expect(
      identity.connect(signers[2]).addWhitelisted(whitelisted.address)
    ).revertedWith("AccessControl: account");
  });

  it("should revert when non admin tries to add blacklist", async () => {
    let blacklisted = signers[1];
    await expect(
      identity.connect(signers[2]).addBlacklisted(blacklisted.address)
    ).revertedWith("AccessControl: account");
  });

  it("should revert when non admin tries to set the authentication period", async () => {
    await expect(identity.connect(signers[2]).setAuthenticationPeriod(10))
      .reverted;
  });

  it("should let admin set auth period", async () => {});

  it("should revert when non admin tries to authentice a user", async () => {
    let authuser = signers[0].address;
    await expect(
      identity.connect(signers[2]).authenticate(authuser)
    ).revertedWith("AccessControl: account");
  });

  it("should authenticate the user with the correct timestamp", async () => {
    let authuser = signers[0].address;
    await identity.addWhitelisted(authuser);
    await identity.authenticate(authuser);
    let dateAuthenticated1 = await identity.lastAuthenticated(authuser);
    await increaseTime(10);
    await identity.authenticate(authuser);
    let dateAuthenticated2 = await identity.lastAuthenticated(authuser);
    expect(dateAuthenticated2.toNumber() - dateAuthenticated1.toNumber()).gt(0);
  });

  it("should add identity admin", async () => {
    let outsider = signers[5].address;
    await identity.grantRole(await identity.IDENTITY_ADMIN_ROLE(), outsider);
    expect(
      await identity.hasRole(await identity.IDENTITY_ADMIN_ROLE(), outsider)
    ).true;
  });

  it("should remove identity admin", async () => {
    let outsider = signers[5].address;
    await identity.revokeRole(await identity.IDENTITY_ADMIN_ROLE(), outsider);

    expect(
      await identity.hasRole(await identity.IDENTITY_ADMIN_ROLE(), outsider)
    ).false;
  });

  it("should revert when adding to whitelisted twice", async () => {
    let whitelisted = signers[1];
    await identity.addWhitelisted(whitelisted.address);
    await expect(identity.addWhitelisted(whitelisted.address)).reverted;

    await identity.removeWhitelisted(whitelisted.address);
  });

  it("should not increment whitelisted counter when adding whitelisted", async () => {
    let whitelisted = signers[1];
    await identity.addWhitelisted(whitelisted.address);
    let whitelistedCount = await identity.whitelistedCount();

    await expect(identity.addWhitelisted(whitelisted.address)).reverted;

    let whitelistedCountNew = await identity.whitelistedCount();
    expect(whitelistedCountNew).to.be.equal(whitelistedCount).gt(0);

    await identity.removeWhitelisted(whitelisted.address);
  });

  it("should renounce whitelisted", async () => {
    let whitelisted = signers[1];
    await identity.addWhitelisted(whitelisted.address);
    expect(await identity.isWhitelisted(whitelisted.address)).true;
    await identity.connect(whitelisted).renounceWhitelisted();
    expect(await identity.isWhitelisted(whitelisted.address)).false;
  });

  it("should add with did", async () => {
    let whitelisted = signers[1];

    await identity.addWhitelistedWithDID(whitelisted.address, "testString");

    const id = await identity.identities(whitelisted.address);

    expect(id.did).to.be.equal("testString");
  });

  it("should not allow adding with used did", async () => {
    let whitelisted2 = signers[2];

    await expect(
      identity.addWhitelistedWithDID(whitelisted2.address, "testString")
    ).revertedWith("DID already registered");
  });

  it("should not allow adding non contract to contracts", async () => {
    let outsider = signers[0];
    await expect(identity.addContract(outsider.address)).revertedWith(
      "Given address is not a contract"
    );
  });

  it("should add contract to contracts", async () => {
    await identity.addContract(gd.address);
    const wasAdded = await identity.isDAOContract(gd.address);
    expect(wasAdded).to.be.true;
  });

  it("should allow to connect account", async () => {});
  it("should not allow to connect account already whitelisted", async () => {});
  it("should allow to disconnect account by owner or connected", async () => {});
  it("should not allow to disconnect account by owner or by connected", async () => {});
  it("should not allow to connect to an already connected account", async () => {});
  it("should return same root for multiple connected accounts", async () => {});

  it("should add whitelisted with orgchain and dateauthenticated", async () => {});

  it("should default to old identity isWhitelisted, isBlacklisted, isContract", async () => {});
  it("should not default,if set, to old identity isWhitelisted, isBlacklisted, isContract", async () => {});
  it("should remove whitelisted,blacklisted,contract from old identity", async () => {});
});
