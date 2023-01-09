import hre, { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { IGoodDollar, IIdentityV2, IIdentity, IdentityV2 } from "../../types";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const BN = ethers.BigNumber;

describe("Identity", () => {
  let identity: IdentityV2, founder: SignerWithAddress;
  let user1 = ethers.Wallet.createRandom().connect(ethers.provider);
  let user2 = ethers.Wallet.createRandom().connect(ethers.provider);
  let signers: Array<SignerWithAddress>;
  let genericCall;

  let avatar, gd: IGoodDollar, Controller, id: IIdentity;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();
    let {
      controller,
      avatar: av,
      gd: gooddollar,
      identity: idv2,
      genericCall: gc
    } = await loadFixture(createDAO);

    genericCall = gc;
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

  it("should let owner set auth period", async () => {
    const encoded = identity.interface.encodeFunctionData(
      "setAuthenticationPeriod",
      [10]
    );
    await genericCall(identity.address, encoded);
    expect(await identity.authenticationPeriod()).eq(10);
  });

  it("should revert when non admin tries to pause", async () => {
    await expect(identity.connect(signers[2]).pause(true)).reverted;
  });

  it("should let admin pause", async () => {
    await expect(identity.pause(true)).not.reverted;
    await expect(identity.pause(false)).not.reverted;
  });

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

  const connectedFixture = async () => {
    const toconnect = signers[10];
    const toconnect2 = signers[11];
    let whitelisted = signers[1];
    const curBlock = await ethers.provider.getBlockNumber();
    const deadline = curBlock + 10;

    const signed = await toconnect._signTypedData(
      {
        name: "Identity",
        version: "1.0.0",
        chainId: 4447,
        verifyingContract: identity.address
      },
      {
        ConnectIdentity: [
          { name: "whitelisted", type: "address" },
          { name: "connected", type: "address" },
          { name: "deadline", type: "uint256" }
        ]
      },
      {
        whitelisted: whitelisted.address,
        connected: toconnect.address,
        deadline
      }
    );

    const signed2 = await toconnect2._signTypedData(
      {
        name: "Identity",
        version: "1.0.0",
        chainId: 4447,
        verifyingContract: identity.address
      },
      {
        ConnectIdentity: [
          { name: "whitelisted", type: "address" },
          { name: "connected", type: "address" },
          { name: "deadline", type: "uint256" }
        ]
      },
      {
        whitelisted: whitelisted.address,
        connected: toconnect2.address,
        deadline
      }
    );

    await identity
      .connect(whitelisted)
      .connectAccount(toconnect.address, signed, deadline);
    await identity
      .connect(whitelisted)
      .connectAccount(toconnect2.address, signed2, deadline);
    return { signed };
  };

  it("should allow to connect account", async () => {
    const toconnect = signers[10];
    let whitelisted = signers[1];

    expect(await identity.getWhitelistedRoot(toconnect.address)).eq(
      ethers.constants.AddressZero
    );

    await loadFixture(connectedFixture);

    expect(await identity.getWhitelistedRoot(whitelisted.address)).eq(
      whitelisted.address
    );

    expect(await identity.getWhitelistedRoot(toconnect.address)).eq(
      whitelisted.address
    );
  });

  it("should require valid deadline", async () => {
    const toconnect = signers[10];
    let whitelisted = signers[1];

    await expect(
      identity
        .connect(whitelisted)
        .connectAccount(
          toconnect.address,
          "0x",
          await ethers.provider.getBlockNumber()
        )
    ).revertedWith("invalid deadline");

    await expect(
      identity.connect(whitelisted).connectAccount(toconnect.address, "0x", 0)
    ).revertedWith("invalid deadline");
  });

  it("should not allow to replay signature", async () => {
    const toconnect = signers[10];
    let whitelisted = signers[1];
    const { signed } = await loadFixture(connectedFixture);
    await expect(
      identity.connect(whitelisted).disconnectAccount(toconnect.address)
    ).not.reverted;

    await expect(
      identity
        .connect(whitelisted)
        .connectAccount(
          toconnect.address,
          signed,
          (await ethers.provider.getBlockNumber()) + 10
        )
    ).revertedWith("invalid signature");
  });

  it("should not allow to connect account already whitelisted", async () => {
    await loadFixture(connectedFixture);

    await identity.addWhitelisted(signers[2].address);
    let whitelisted = signers[1];

    await expect(
      identity
        .connect(whitelisted)
        .connectAccount(signers[2].address, "0x", 20000000)
    ).revertedWith("invalid account");
  });

  it("should allow to disconnect account by owner or connected", async () => {
    await loadFixture(connectedFixture);

    const connected = signers[10];
    const whitelisted = signers[1];
    await identity.connect(connected).disconnectAccount(connected.address);
    expect(await identity.getWhitelistedRoot(connected.address)).eq(
      ethers.constants.AddressZero
    );
    await loadFixture(connectedFixture);
    await identity.connect(whitelisted).disconnectAccount(connected.address);
    expect(await identity.getWhitelistedRoot(connected.address)).eq(
      ethers.constants.AddressZero
    );
  });

  it("should not allow to disconnect account not by owner or by connected", async () => {
    await loadFixture(connectedFixture);

    const connected = signers[10];
    const whitelisted = signers[1];
    await expect(identity.disconnectAccount(connected.address)).revertedWith(
      "unauthorized"
    );
  });

  it("should not allow to connect to an already connected account", async () => {
    await loadFixture(connectedFixture);

    await identity.addWhitelisted(signers[2].address);
    expect(await identity.isWhitelisted(signers[2].address)).true;
    const connected = signers[10];

    await expect(
      identity
        .connect(signers[2])
        .connectAccount(connected.address, "0x", 200000)
    ).revertedWith("already connected");
  });

  it("should return same root for multiple connected accounts", async () => {
    await loadFixture(connectedFixture);

    const connected = signers[10];
    const connected2 = signers[11];
    const whitelisted = signers[1];
    expect(await identity.getWhitelistedRoot(connected.address))
      .eq(await identity.getWhitelistedRoot(connected2.address))
      .eq(whitelisted.address);
  });

  it("should add whitelisted with orgchain and dateauthenticated", async () => {
    await loadFixture(connectedFixture);
    const toWhitelist = signers[2];

    const ts = (Date.now() / 1000 - 100000).toFixed(0);
    await identity.addWhitelistedWithDIDAndChain(
      toWhitelist.address,
      "xxx",
      1234,
      ts
    );
    const record = await identity.identities(toWhitelist.address);
    expect(record.whitelistedOnChainId).eq(1234);
    expect(record.dateAuthenticated).eq(ts);
  });

  const oldidFixture = async () => {
    const newid = (await upgrades.deployProxy(
      await ethers.getContractFactory("IdentityV2"),
      [founder.address, identity.address]
    )) as IdentityV2;

    await identity.grantRole(
      await identity.IDENTITY_ADMIN_ROLE(),
      newid.address
    );
    await identity.addBlacklisted(signers[4].address);
    await identity.addContract(identity.address);
    await identity.removeWhitelisted(signers[3].address);
    await identity.addWhitelistedWithDID(signers[3].address, "testolddid");
    return { newid };
  };

  it("should default to old identity isWhitelisted, isBlacklisted, isContract", async () => {
    const { newid } = await loadFixture(oldidFixture);
    expect(await (await identity.identities(signers[3].address)).did).eq(
      "testolddid"
    );
    expect(await (await newid.identities(signers[3].address)).did).eq("");

    expect(await identity.addrToDID(signers[3].address)).eq("testolddid");
    expect(await newid.addrToDID(signers[3].address)).eq("testolddid");
    expect(await newid.isBlacklisted(signers[4].address)).true;
    expect(await newid.isWhitelisted(signers[3].address)).true;
    expect(await newid.isDAOContract(identity.address)).true;
  });

  it("should remove whitelisted,blacklisted,contract from old identity", async () => {
    const { newid } = await loadFixture(oldidFixture);
    await newid.removeBlacklisted(signers[4].address);
    await newid.removeWhitelisted(signers[3].address);
    await newid.removeContract(identity.address);

    expect(await newid.addrToDID(signers[3].address)).eq("");
    expect(await newid.isBlacklisted(signers[4].address)).false;
    expect(await newid.isWhitelisted(signers[3].address)).false;
    expect(await newid.isDAOContract(identity.address)).false;

    expect(await identity.isBlacklisted(signers[4].address)).false;
    expect(await identity.isWhitelisted(signers[3].address)).false;
    expect(await identity.isDAOContract(identity.address)).false;
  });

  it("should not set did if set in oldidentity", async () => {
    const { newid } = await loadFixture(oldidFixture);

    await expect(
      newid
        .connect(signers[1])
        ["setDID(address,string)"](signers[1].address, "testolddid")
    ).revertedWith("DID already registered oldIdentity");
  });

  it("should set did if set in oldidentity by same owner", async () => {
    const { newid } = await loadFixture(oldidFixture);

    await expect(
      newid
        .connect(signers[3])
        ["setDID(address,string)"](signers[3].address, "testolddid")
    ).not.reverted;
    expect(await newid.addrToDID(signers[3].address)).eq("testolddid");
  });
  it("should set did if set in oldidentity by different owner but updated in new identity", async () => {
    const { newid } = await loadFixture(oldidFixture);

    await expect(
      newid
        .connect(signers[3])
        ["setDID(address,string)"](signers[3].address, "newdid")
    ).not.reverted;
    expect(await newid.addrToDID(signers[3].address)).eq("newdid");

    await expect(
      newid
        .connect(signers[1])
        ["setDID(address,string)"](signers[1].address, "testolddid")
    ).not.reverted;
    expect(await newid.addrToDID(signers[1].address)).eq("testolddid");
  });

  it("should let admin setDID", async () => {
    await expect(
      identity["setDID(address,string)"](signers[1].address, "admindid")
    ).not.reverted;
    expect(await identity.addrToDID(signers[1].address)).eq("admindid");
    await expect(
      identity
        .connect(signers[2])
        ["setDID(address,string)"](signers[1].address, "admindid")
    ).reverted;
  });

  it("should be registered for v1 compatability", async () => {
    expect(await identity.isRegistered()).true;
  });
});
