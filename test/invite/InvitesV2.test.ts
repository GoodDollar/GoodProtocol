import hre, { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { InvitesV2, IGoodDollar, IIdentity, IdentityV2 } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import IdentityABI from "@gooddollar/goodcontracts/build/contracts/Identity.json";

import { createDAO } from "../helpers";

const BN = ethers.BigNumber;

describe("InvitesV2", () => {
  let invites: InvitesV2, founder: SignerWithAddress;
  let inviter1,
    inviter2,
    invitee1,
    invitee2,
    invitee3,
    invitee4,
    invitee5,
    invitee6,
    invitee7,
    invitee8;

  let avatar,
    gd: IGoodDollar,
    Controller,
    id: IdentityV2,
    setDAOAddress,
    setSchemes;

  const initialState = async () => {};
  before(async () => {
    [
      founder,
      inviter1,
      inviter2,
      invitee1,
      invitee2,
      invitee3,
      invitee4,
      invitee5,
      invitee6,
      invitee7,
      invitee8
    ] = await ethers.getSigners();

    const InvitesV2 = await ethers.getContractFactory("InvitesV2");

    let {
      controller,
      avatar: av,
      gd: gooddollar,
      identity,
      nameService,
      setDAOAddress: sda,
      setSchemes: sc
    } = await loadFixture(createDAO);

    Controller = controller;
    avatar = av;
    setDAOAddress = sda;
    setSchemes = sc;

    invites = (await upgrades.deployProxy(
      InvitesV2,
      [nameService.address, gooddollar, 500, founder.address],
      {
        kind: "uups"
      }
    )) as InvitesV2;

    gd = (await ethers.getContractAt(
      "IGoodDollar",
      gooddollar,
      founder
    )) as IGoodDollar;
    id = (await ethers.getContractAt(
      "IdentityV2",
      identity,
      founder
    )) as IdentityV2;

    await gd["mint(address,uint256)"](invites.address, BN.from(5000));
    await loadFixture(initialState);
    // await gd.transfer(invites.address, BN.from(5000));
  });

  it("should have balance", async () => {
    const balance = await gd.balanceOf(invites.address);
    expect(balance).to.equal(5000);
  });

  it("should have version", async () => {
    expect(await invites.active()).to.be.true;
    const version = await invites.version();
    expect(version).to.be.equal("2.1");
  });

  it("should let anyone join", async () => {
    await invites
      .connect(inviter1)
      .join(ethers.utils.hexZeroPad("0xfa", 32), ethers.constants.HashZero);
    let inviter = await invites.users(inviter1.address);
    expect(inviter.inviteCode).to.equal(ethers.utils.hexZeroPad("0xfa", 32));
  });

  it("should allow to join only once", async () => {
    await expect(
      invites
        .connect(inviter1)
        .join(
          ethers.utils.hexZeroPad("0xfa", 32),
          ethers.utils.hexZeroPad("0x01", 32)
        )
    ).to.revertedWith("user already joined");
  });

  it("should not allow code reuse", async () => {
    // const invites = await Invites.deployed();
    await expect(
      invites
        .connect(inviter2)
        .join(ethers.utils.hexZeroPad("0xfa", 32), ethers.constants.HashZero)
    ).to.revertedWith("invite code already in use");
  });

  it("should mark inviter", async () => {
    await invites
      .connect(invitee1)
      .join(
        ethers.utils.hexZeroPad("0xaa", 32),
        ethers.utils.hexZeroPad("0xfa", 32)
      );
    let invitee = await invites.users(invitee1.address);
    let inviterInvitees = await invites.getInvitees(inviter1.address);
    expect(invitee.invitedBy).to.be.equal(inviter1.address);
    expect(inviterInvitees).to.include(invitee1.address);
  });

  it("should not pay bounty for non whitelisted invitee", async () => {
    await expect(
      invites.connect(inviter1).bountyFor(invitee1.address)
    ).to.revertedWith("user not elligble for bounty yet");
  });

  it("should allow to pay bounty for non whitelisted inviter", async () => {
    await id.addWhitelistedWithDID(invitee1.address, Math.random() + "");
    expect(await id.isWhitelisted(invitee1.address)).to.be.true;
    expect(await id.isWhitelisted(inviter1.address)).to.be.false;
    expect(await id.getWhitelistedOnChainId(invitee1.address)).eq(4447);
    expect(await invites.canCollectBountyFor(invitee1.address)).to.be.true;
    await expect(invites.callStatic.bountyFor(invitee1.address)).not.reverted;
  });

  it("should pay bounty for whitelisted invitee and inviter", async () => {
    const bounty = (await invites.levels(0)).bounty.toNumber();
    await id
      .addWhitelistedWithDID(inviter1.address, Math.random() + "")
      .catch(e => e);
    const startBalance = await gd
      .balanceOf(inviter1.address)
      .then(_ => _.toNumber());
    expect(await id.isWhitelisted(inviter1.address)).to.be.true;
    let pending = await invites.getPendingInvitees(inviter1.address);
    expect(pending.length, "pending").to.be.equal(1);
    const inviteeBalance = await gd
      .balanceOf(invitee1.address)
      .then(_ => _.toNumber());
    await invites.connect(inviter1).bountyFor(invitee1.address);

    let invitee = await invites.users(invitee1.address);
    let inviter = await invites.users(inviter1.address);
    const endBalance = await gd
      .balanceOf(inviter1.address)
      .then(_ => _.toNumber());

    pending = await invites.getPendingInvitees(inviter1.address);
    const txFee = await gd.getFees(bounty).then(_ => _["0"].toNumber()); //gd might have a tx fee
    const txFee2 = await gd.getFees(bounty / 2).then(_ => _["0"].toNumber()); //gd might have a tx fee

    expect(pending.length, "pending").to.be.equal(0);
    expect(invitee.bountyPaid).to.be.true;
    expect(inviter.totalApprovedInvites.toNumber()).to.be.equal(1);
    expect(inviter.totalEarned.toNumber()).to.be.equal(bounty);
    expect(
      endBalance - startBalance + txFee,
      "inviter rewards not matching bounty"
    ).to.be.equal(bounty);
    expect(
      (await gd.balanceOf(invitee1.address).then(_ => _.toNumber())) -
        inviteeBalance,
      "invitee rewrad should be bounty/2"
    ).to.be.equal(bounty / 2 - txFee2); //test that invitee  got half bonus
  });

  it("should update global stats", async () => {
    const bounty = (await invites.levels(0)).bounty.toNumber();
    const stats = await invites.stats();
    expect(stats.totalApprovedInvites.toNumber()).to.be.equal(
      1,
      "approved invites"
    );
    expect(stats.totalInvited.toNumber()).to.be.equal(1, "total  invited");
    expect(stats.totalBountiesPaid.toNumber()).to.be.equal(bounty);
  });

  it("should not pay bounty twice", async () => {
    await expect(
      invites.connect(inviter2).bountyFor(invitee1.address)
    ).to.revertedWith("user not elligble for bounty yet");
  });

  it("should not fail in collectBounties for invalid invitees", async () => {
    await invites
      .connect(invitee7)
      .join(
        ethers.utils.hexZeroPad("0x01", 32),
        ethers.utils.hexZeroPad("0xfa", 32)
      );
    await invites
      .connect(invitee8)
      .join(
        ethers.utils.hexZeroPad("0x02", 32),
        ethers.utils.hexZeroPad("0xfa", 32)
      );

    let pending = await invites.getPendingInvitees(inviter1.address);
    expect(pending.length, "pending").to.be.equal(2);
    await expect(invites.connect(inviter1).collectBounties()).to.not.reverted;
    let user1 = await invites.users(invitee7.address);
    let user2 = await invites.users(invitee8.address);
    pending = await invites.getPendingInvitees(inviter1.address);
    expect(
      await invites.getPendingBounties(inviter1.address).then(_ => _.toNumber())
    ).to.be.equal(0);
    expect(user1.bountyPaid).to.be.false;
    expect(user2.bountyPaid).to.be.false;
    expect(pending.length, "pending").to.be.equal(2);
  });

  it("should collectBounties for inviter", async () => {
    await id.addWhitelistedWithDID(invitee7.address, Math.random() + "");
    await id.addWhitelistedWithDID(invitee8.address, Math.random() + "");
    expect(
      await invites.getPendingBounties(inviter1.address).then(_ => _.toNumber())
    ).to.be.equal(2);
    const res = await invites.connect(inviter1).collectBounties();

    let user1 = await invites.users(invitee7.address);
    let user2 = await invites.users(invitee8.address);
    let pending = await invites.getPendingInvitees(inviter1.address);
    expect(
      await invites.getPendingBounties(inviter1.address).then(_ => _.toNumber())
    ).to.be.equal(0);
    expect(pending.length, "pending").to.be.equal(0);
    expect(user1.bountyPaid, "user1").to.be.true;
    expect(user2.bountyPaid, "user2").to.be.true;
  });

  it("should not set level not by owner", async () => {
    await expect(
      invites.connect(inviter1).setLevel(0, 1, 5, 1)
    ).to.revertedWith("Only owner or avatar can perform this action");
  });

  it("should set level by owner", async () => {
    await invites.setLevel(0, 1, 5, 1);
    let lvl = await invites.levels(0);
    expect(lvl.toNext.toNumber()).to.be.equal(1);
    expect(lvl.daysToComplete.toNumber()).to.be.equal(1);
    await invites.setLevel(1, 0, 10, 2);
    lvl = await invites.levels(1);
    expect(lvl.toNext.toNumber()).to.be.equal(0);
    expect(lvl.daysToComplete.toNumber()).to.be.equal(2);
    expect(lvl.bounty.toNumber()).to.be.equal(10);
  });

  it("should update inviter level", async () => {
    await invites
      .connect(inviter1)
      .join(ethers.utils.hexZeroPad("0xfa", 32), ethers.constants.HashZero)
      .then(_ => _.wait())
      .catch(e => e);

    await id
      .addWhitelistedWithDID(inviter1.address, Math.random() + "")
      .catch(e => e);
    await invites.setLevel(0, 1, 5, 1); //1 inviter to level up
    await invites.setLevel(1, 0, 10, 2); // 10 bounty for second level

    await invites
      .connect(invitee4)
      .join(
        ethers.utils.hexZeroPad("0x03", 32),
        ethers.utils.hexZeroPad("0xfa", 32)
      );
    await invites
      .connect(invitee5)
      .join(
        ethers.utils.hexZeroPad("0x04", 32),
        ethers.utils.hexZeroPad("0xfa", 32)
      );
    await id
      .addWhitelistedWithDID(invitee4.address, Math.random() + "")
      .catch(e => e);
    await id
      .addWhitelistedWithDID(invitee5.address, Math.random() + "")
      .catch(e => e);
    const res1 = await (await invites.bountyFor(invitee4.address)).wait();

    const log1 = res1.events.find(_ => _.event === "InviterBounty");
    expect(log1.event).to.be.equal("InviterBounty");
    expect(log1.args.inviterLevel.toNumber()).to.be.equal(1);
    expect(log1.args.earnedLevel).to.be.equal(true);
    expect(log1.args.bountyPaid.toNumber()).to.be.equal(5);

    let inviter = await invites.users(inviter1.address);
    expect(inviter.level.toNumber()).to.be.equal(1);
    const res2 = await (
      await invites.connect(inviter1).collectBounties()
    ).wait();
    const log2 = res2.events.find(_ => _.event === "InviterBounty");
    expect(log2.event).to.be.equal("InviterBounty");
    expect(log2.args.inviterLevel.toNumber()).to.be.equal(1);
    expect(log2.args.earnedLevel).to.be.equal(false);
    expect(log2.args.bountyPaid.toNumber()).to.be.equal(10);
  });

  it("should allow to set inviter later and pay bounty", async () => {
    await invites
      .connect(invitee6)
      .join(ethers.utils.hexZeroPad("0xfd", 32), ethers.constants.HashZero);
    await invites
      .connect(invitee6)
      .join(
        ethers.utils.hexZeroPad("0xfd", 32),
        ethers.utils.hexZeroPad("0xfa", 32)
      );
    const invitee = await invites.users(invitee6.address);
    expect(invitee.invitedBy).to.equal(inviter1.address);
    await id
      .addWhitelistedWithDID(invitee6.address, Math.random() + "")
      .catch(e => e);
    await expect(invites.bountyFor(invitee6.address)).to.emit(
      invites,
      "InviterBounty"
    );
  });

  describe("MultiChain", () => {
    it("should not revert if old identity contract without getWhitelistedOnChain", async () => {
      await loadFixture(initialState);
      const contractFactory = new ethers.ContractFactory(
        IdentityABI.abi,
        IdentityABI.bytecode,
        founder
      );
      const oldId = await contractFactory.deploy();
      await oldId.setAvatar(avatar);
      await setSchemes([oldId.address], []);
      await setDAOAddress("IDENTITY", oldId.address);

      expect(await invites.getIdentity()).equal(oldId.address);
      await invites
        .connect(inviter1)
        .join(ethers.utils.hexZeroPad("0xfa", 32), ethers.constants.HashZero);

      await invites
        .connect(invitee2)
        .join(
          ethers.utils.hexZeroPad("0xaa", 32),
          ethers.utils.hexZeroPad("0xfa", 32)
        );

      await oldId.addWhitelistedWithDID(invitee2.address, Math.random() + "");
      await invites.connect(inviter1).bountyFor(invitee2.address);
    });

    it("should always be able to use my address as invite code", async () => {
      await loadFixture(initialState);

      await invites
        .connect(inviter1)
        .join(
          ethers.utils.hexZeroPad(inviter1.address, 32),
          ethers.constants.HashZero
        );

      await expect(
        invites
          .connect(inviter2)
          .join(
            ethers.utils.hexZeroPad(inviter2.address, 32),
            ethers.constants.HashZero
          )
      ).not.reverted;

      await expect(
        invites
          .connect(inviter1)
          .join(
            ethers.utils.hexZeroPad(inviter1.address, 32),
            ethers.constants.HashZero
          )
      ).reverted;
    });

    it("should not allow to claim if whitelisted originally on another chain", async () => {
      await loadFixture(initialState);
      await invites
        .connect(inviter1)
        .join(ethers.utils.hexZeroPad("0xfa", 32), ethers.constants.HashZero);
      await invites
        .connect(invitee2)
        .join(
          ethers.utils.hexZeroPad("0xaa", 32),
          ethers.utils.hexZeroPad("0xfa", 32)
        );

      await id.addWhitelistedWithDIDAndChain(
        invitee2.address,
        Math.random() + "",
        122,
        0
      );
      expect(await id.getWhitelistedOnChainId(invitee2.address)).equal(122);
      await expect(
        invites.connect(inviter1).bountyFor(invitee2.address)
      ).to.revertedWith("user not elligble for bounty yet");
    });

    it("should allow to claim if whitelisted originally on same chain", async () => {
      await loadFixture(initialState);
      await invites
        .connect(inviter1)
        .join(ethers.utils.hexZeroPad("0xfa", 32), ethers.constants.HashZero);
      await invites
        .connect(invitee2)
        .join(
          ethers.utils.hexZeroPad("0xaa", 32),
          ethers.utils.hexZeroPad("0xfa", 32)
        );

      await id.addWhitelistedWithDIDAndChain(
        invitee2.address,
        Math.random() + "",
        4447,
        0
      );
      expect(await id.getWhitelistedOnChainId(invitee2.address)).equal(4447);
      await expect(invites.connect(inviter1).bountyFor(invitee2.address)).not
        .reverted;
    });
  });

  it("should end contract by owner", async () => {
    expect(
      await gd.balanceOf(invites.address).then(_ => _.toNumber())
    ).to.be.gt(0);
    await invites.end();
    expect(
      await gd.balanceOf(invites.address).then(_ => _.toNumber())
    ).to.be.eq(0);
  });
});
