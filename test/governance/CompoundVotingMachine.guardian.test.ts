import hre, { ethers, upgrades } from "hardhat";
import { expect } from "chai";
// import { deployContract, deployMockContract, MockContract } from "ethereum-waffle";
import { GReputation, CompoundVotingMachine } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { Wallet } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { createDAO, increaseTime } from "../helpers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

let grep: GReputation, grepWithOwner: GReputation, identity, gd, bounty;
let signers: SignerWithAddress[], founder, repOwner, rep1, rep2, rep3;

const encodeParameters = (types, values) =>
  ethers.utils.defaultAbiCoder.encode(types, values);

const advanceBlocks = async (blocks: number) => {
  let ps = [];
  for (let i = 0; i < blocks; i++) {
    ps.push(ethers.provider.send("evm_mine", []));
    if (i % 5000 === 0) {
      await Promise.all(ps);
      ps = [];
    }
  }
};

const states = [
  "Pending",
  "Active",
  "ActiveTimelock",
  "Canceled",
  "Defeated",
  "Succeeded",
  "Expired",
  "Executed"
];

describe("CompoundVotingMachine#Guardian", () => {
  let gov: CompoundVotingMachine,
    root: SignerWithAddress,
    acct: SignerWithAddress;

  let trivialProposal, targets, values, signatures, callDatas;
  let proposalBlock,
    proposalId,
    voteDelay,
    votePeriod,
    queuePeriod,
    gracePeriod;
  let wallet: Wallet;
  let avatar, mock, Controller;

  before(async () => {
    [root, acct, ...signers] = await ethers.getSigners();

    const GReputation = await ethers.getContractFactory("GReputation");
    const CompoundVotingMachine = await ethers.getContractFactory(
      "CompoundVotingMachine"
    );

    grep = (await upgrades.deployProxy(GReputation, [root.address], {
      unsafeAllowCustomTypes: true
    })) as GReputation;

    let {
      daoCreator,
      controller,
      avatar: av,
      setSchemes
      //genericCall
    } = await createDAO();
    Controller = controller;
    avatar = av;

    // avatarGenericCall = genericCall;

    gov = (await CompoundVotingMachine.deploy(
      avatar,
      grep.address,
      5760
    )) as CompoundVotingMachine;

    //set voting machiine as scheme with permissions
    await setSchemes([gov.address]);

    await grep.mint(root.address, ethers.BigNumber.from("1000000"));
    await grep.mint(acct.address, ethers.BigNumber.from("500000"));

    //set avatar as owner of rep
    await grep.transferOwnership(avatar);

    queuePeriod = await gov.queuePeriod().then(_ => _.toNumber());

    let mockABI = ["function rec() payable"];
    mock = await deployMockContract(root, mockABI);
    mock.mock.rec.returns();
  });

  it("Should have deployer as guardian", async () => {
    expect(await gov.guardian()).to.equal(root.address);
  });

  it("Should not be able to change guardian if not guardian or avatar", async () => {
    await expect(
      gov.connect(acct).setGuardian(acct.address)
    ).to.be.revertedWith("CompoundVotingMachine: not avatar or guardian");
  });

  it("Should not be able to change guardian before foundation release time", async () => {
    await expect(gov.setGuardian(acct.address)).to.be.revertedWith(
      "CompoundVotingMachine: foundation expiration not reached"
    );
  });

  it("Should not be able to renounce guardian if not guardian", async () => {
    await expect(gov.connect(acct).renounceGuardian()).to.be.revertedWith(
      "CompoundVotingMachine: not guardian"
    );
  });

  it("Should be able to set guardian by guardian if foundation expired", async () => {
    await increaseTime(60 * 60 * 24 * 365 * 2);
    await gov.setGuardian(acct.address);
    expect(await gov.guardian()).to.equal(acct.address);
    await gov.connect(acct).setGuardian(root.address); //restore
  });

  it("Should be able to set guardian by avatar if foundation expired", async () => {
    await increaseTime(60 * 60 * 24 * 365 * 2);
    await gov.setGuardian(acct.address);
    expect(await gov.guardian()).to.equal(acct.address);
    await gov.connect(acct).setGuardian(root.address); //restore
  });

  it("Should be able to set guardian if foundation renounced", async () => {
    const CompoundVotingMachine = await ethers.getContractFactory(
      "CompoundVotingMachine"
    );

    const gov2 = (await CompoundVotingMachine.deploy(
      avatar,
      grep.address,
      5760
    )) as CompoundVotingMachine;
    await expect(gov2.renounceGuardian()).to.not.reverted;
    expect(await gov2.guardian()).to.equal(ethers.constants.AddressZero);
  });
  it("Should be able to renounce guardian if guardian", async () => {
    await expect(gov.renounceGuardian()).to.not.reverted;
    expect(await gov.guardian()).to.equal(ethers.constants.AddressZero);
  });
});
