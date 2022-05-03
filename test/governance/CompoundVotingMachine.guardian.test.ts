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
let nameService;

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

  let queuePeriod, avatarGenericCall;
  let avatar, mock, Controller;

  before(async () => {
    [root, acct, ...signers] = await ethers.getSigners();

    let {
      daoCreator,
      controller,
      avatar: av,
      setSchemes,
      reputation,
      setDAOAddress,
      genericCall,
      nameService: ns,
      votingMachine
    } = await createDAO();

    Controller = controller;
    avatar = av;
    avatarGenericCall = genericCall;
    nameService = ns;

    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;

    gov = votingMachine;

    //this will give root minter permissions
    setDAOAddress("GDAO_CLAIMERS", root.address);

    //set voting machiine as scheme with permissions
    await setSchemes([gov.address]);

    await grep.mint(root.address, ethers.BigNumber.from("1000000"));
    await grep.mint(acct.address, ethers.BigNumber.from("500000"));

    queuePeriod = await gov.queuePeriod().then(_ => _.toNumber());

    let mockABI = ["function rec() payable"];
    mock = await deployMockContract(root, mockABI);
    mock.mock.rec.returns();
  });

  it("should set guardian from initializer", async () => {
    const votingMachine = (await upgrades.deployProxy(
      await ethers.getContractFactory("CompoundVotingMachine"),
      [nameService.address, 5760, signers[2].address, NULL_ADDRESS],
      { kind: "uups" }
    )) as unknown as CompoundVotingMachine;
    expect(await votingMachine.guardian()).to.equal(signers[2].address);
  });

  it("Should have deployer as guardian", async () => {
    expect(await gov.guardian()).to.equal(root.address);
  });

  it("Should not be able to change guardian if not guardian or avatar", async () => {
    await expect(
      gov.connect(acct).setGuardian(acct.address)
    ).to.be.revertedWith("CompoundVotingMachine: not avatar or guardian");
  });

  it("Should not be able to change guardian before foundation release time by avatar", async () => {
    const encoded = gov.interface.encodeFunctionData("setGuardian", [
      acct.address
    ]);
    await avatarGenericCall(gov.address, encoded);
    expect(await gov.guardian()).to.equal(root.address);
  });

  it("Should not be able to renounce guardian if not guardian", async () => {
    await expect(gov.connect(acct).renounceGuardian()).to.be.revertedWith(
      "CompoundVotingMachine: not guardian"
    );
  });

  it("Should be able to set guardian by guardian before foundation expired", async () => {
    await gov.setGuardian(acct.address);
    expect(await gov.guardian()).to.equal(acct.address);
    await gov.connect(acct).setGuardian(root.address); //restore
  });

  it("Should be able to set guardian by avatar if foundation expired", async () => {
    await ethers.provider.send("evm_setNextBlockTimestamp", [1672531201]); //1672531200
    await ethers.provider.send("evm_mine", []);

    const encoded = gov.interface.encodeFunctionData("setGuardian", [
      acct.address
    ]);
    await avatarGenericCall(gov.address, encoded);
    expect(await gov.guardian()).to.equal(acct.address);
  });

  it("Should be able to renounce guardian if guardian", async () => {
    await expect(gov.connect(acct).renounceGuardian()).to.not.reverted;
    expect(await gov.guardian()).to.equal(ethers.constants.AddressZero);
  });

  it("Should be able to set guardian by avatar if foundation renounced", async () => {
    const CompoundVotingMachine = await ethers.getContractFactory(
      "CompoundVotingMachine"
    );

    const gov2 = (await upgrades.deployProxy(
      CompoundVotingMachine,
      [nameService.address, 5760, root.address, NULL_ADDRESS],
      { kind: "uups" }
    )) as CompoundVotingMachine;

    await expect(gov2.renounceGuardian()).to.not.reverted;
    expect(await gov2.guardian()).to.equal(ethers.constants.AddressZero);

    const encoded = gov2.interface.encodeFunctionData("setGuardian", [
      acct.address
    ]);
    await avatarGenericCall(gov2.address, encoded);
    expect(await gov2.guardian()).to.equal(acct.address);
  });

  it("cancel when undelegated and proposer votes below threshold", async () => {
    await grep.delegateTo(signers[4].address);

    let targets = [acct.address];
    let values = ["0"];
    let signatures = ["getBalanceOf(address)"];
    let callDatas = [encodeParameters(["address"], [acct.address])];

    //new guardian signers[1]
    const encoded = gov.interface.encodeFunctionData("setGuardian", [
      signers[1].address
    ]);
    await avatarGenericCall(gov.address, encoded);

    await gov
      .connect(signers[4])
      ["propose(address[],uint256[],string[],bytes[],string)"](
        targets,
        values,
        signatures,
        callDatas,
        "do nothing"
      );
    let proposalId = await gov.latestProposalIds(signers[4].address);
    await advanceBlocks(1);

    await expect(gov.cancel(proposalId)).to.be.revertedWith(
      "CompoundVotingMachine::cancel: proposer above threshold"
    ); //should not be cancelable by anyone else buy guardian

    await gov.connect(signers[1]).cancel(proposalId);
    expect(states[await gov.state(proposalId)]).to.equal("Canceled");
    await grep.delegateTo(root.address); //delegate back our votes
  });

  it("Should be able to pass proposal to change guardian", async () => {
    console.log(
      grep.address,
      await grep.totalSupply().then(_ => _.toString()),
      await (await grep.getVotes(root.address)).toString(),
      await (await grep.balanceOfLocal(root.address)).toString(),
      await gov.rep()
    );
    let targets = [gov.address];
    let values = ["0"];
    let signatures = ["setGuardian(address)"];
    let callDatas = [encodeParameters(["address"], [signers[1].address])];

    await gov
      .connect(root)
      ["propose(address[],uint256[],string[],bytes[],string)"](
        targets,
        values,
        signatures,
        callDatas,
        "set guardian"
      );
    let proposalBlock = +(await ethers.provider.getBlockNumber());
    let proposalId = await gov.latestProposalIds(root.address);
    await advanceBlocks(1);
    await gov.connect(root).castVote(proposalId, true);
    await increaseTime(queuePeriod);
    expect(states[await gov.state(proposalId)]).to.equal("Succeeded");
    await gov.execute(proposalId);
    expect(states[await gov.state(proposalId)]).to.equal("Executed");

    //acct should now have 1M after proposal minted rep
    expect(await gov.guardian()).to.equal(signers[1].address);
  });
});
