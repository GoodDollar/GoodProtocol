import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { GReputation, CompoundVotingMachine } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime } from "../helpers";
const BN = ethers.BigNumber;
export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

let grep: GReputation, grepWithOwner: GReputation, identity, gd, bounty;
let signers: SignerWithAddress[], founder, repOwner, rep1, rep2, rep3;

const encodeParameters = (types, values) =>
  ethers.utils.defaultAbiCoder.encode(types, values);

describe("CompoundVotingMachine#cross blockchain", () => {
  let gov: CompoundVotingMachine,
    root: SignerWithAddress,
    acct: SignerWithAddress;

  let queuePeriod, targets, values, signatures, callDatas, testaddr;

  before(async () => {
    [root, acct, ...signers] = await ethers.getSigners();

    let { reputation, setDAOAddress, votingMachine, cdaiAddress, controller } =
      await createDAO();
    testaddr = controller;
    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;

    gov = votingMachine;

    //this will give root minter permissions
    setDAOAddress("GDAO_CLAIMERS", root.address);

    await grep.mint(root.address, ethers.BigNumber.from("1000000"));
    targets = [root.address];
    values = ["0"];
    signatures = ["getBalanceOf(address)"];
    callDatas = [encodeParameters(["address"], [acct.address])];

    queuePeriod = await gov.queuePeriod().then(_ => _.toNumber());
  });

  it("creates cross blockchain proposal", async () => {
    let nextProposal = gov[
      "propose(address[],uint256[],string[],bytes[],string,uint256)"
    ](targets, values, signatures, callDatas, "eth proposal", 1);

    let nextProposalId = await nextProposal
      .then(_ => _.wait())
      .then(_ => gov.proposalCount());
    let proposalBlock = +(await ethers.provider.getBlockNumber());

    expect(nextProposal)
      .to.emit(gov, "ProposalBridge")
      .withArgs(nextProposalId, 1);
  });

  it("reverts emit succeeded if not passed", async () => {
    await expect(gov.emitSucceeded(await gov.proposalCount())).to.revertedWith(
      "not Succeeded"
    );
  });

  it("reverts if tried to be executed not on target blockchain", async () => {
    const pid = await gov.proposalCount();
    await gov.castVote(pid, true);
    await increaseTime(queuePeriod);

    await expect(gov.execute(await gov.proposalCount())).to.revertedWith(
      "wrong blockchain"
    );
  });

  it("can emit succeeded", async () => {
    const pid = await gov.proposalCount();
    const proposal = await gov.proposals(pid);

    const emitTx = gov.emitSucceeded(pid);

    await expect(emitTx).to.not.reverted;
    await expect(emitTx)
      .to.emit(gov, "ProposalSucceeded")
      .withArgs(
        pid,
        root.address,
        targets,
        values,
        signatures,
        callDatas,
        proposal.startBlock,
        proposal.endBlock,
        1,
        proposal.eta,
        proposal.forVotes,
        proposal.againstVotes
      );
  });

  it("can get executed status and forBlockchain from storage", async () => {
    const proposalsMapping = 217; //slot 216 is currently proposals count
    const keyHash = ethers.utils.solidityKeccak256(
      ["uint256", "uint256"],
      [1, proposalsMapping]
    );
    const proposerPos = ethers.BigNumber.from(keyHash).add(1).toHexString();
    const executedPos = ethers.BigNumber.from(keyHash).add(11).toHexString();
    const blockchainPos = ethers.BigNumber.from(keyHash).add(14).toHexString();
    const proposer = await ethers.provider.getStorageAt(
      gov.address,
      proposerPos
    );
    const executed = await ethers.provider.getStorageAt(
      gov.address,
      executedPos
    );
    const forBlockchain = await ethers.provider.getStorageAt(
      gov.address,
      blockchainPos
    );
    expect(proposer).to.equal(
      ethers.utils.hexZeroPad(root.address.toLowerCase(), 32)
    );
    expect(executed).to.eq(ethers.utils.hexZeroPad("0x0100", 32)); //executed slot if together with cancel, both bools, each bool 1 byte. ie 0x0000, so 0x0001 is canceled true and 0x0100 is executed true
    expect(forBlockchain).to.equal(ethers.utils.hexZeroPad("0x1", 32));
  });
});
