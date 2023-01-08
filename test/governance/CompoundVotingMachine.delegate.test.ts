import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { GReputation, CompoundVotingMachine } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO } from "../helpers";

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

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await advanceBlocks(1);
}

async function setTime(seconds) {
  await ethers.provider.send("evm_setTime", [new Date(seconds * 1000)]);
}

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

describe("CompoundVotingMachine#Delegation", () => {
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

  before(async () => {
    [root, acct, ...signers] = await ethers.getSigners();

    let {
      daoCreator,
      reputation,
      avatar,
      setDAOAddress,
      nameService,
      votingMachine
    } = await loadFixture(createDAO);
    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;

    gov = votingMachine;

    //this will give root minter permissions
    await setDAOAddress("GDAO_CLAIMERS", root.address);

    await grep.mint(root.address, ethers.BigNumber.from("1000000"));
    await grep.mint(acct.address, ethers.BigNumber.from("500000"));
    await grep.mint(signers[0].address, ethers.BigNumber.from("2000000")); //just to make acct+root < 50%

    targets = [acct.address];
    values = ["0"];
    signatures = ["getBalanceOf(address)"];
    callDatas = [encodeParameters(["address"], [acct.address])];

    await gov["propose(address[],uint256[],string[],bytes[],string)"](
      targets,
      values,
      signatures,
      callDatas,
      "do nothing"
    );
    proposalBlock = +(await ethers.provider.getBlockNumber());
    proposalId = await gov.latestProposalIds(root.address);
    trivialProposal = await gov.proposals(proposalId);

    voteDelay = await gov.votingDelay().then(_ => _.toNumber());
    votePeriod = await gov.votingPeriod().then(_ => _.toNumber());
    queuePeriod = await gov.queuePeriod().then(_ => _.toNumber());
    gracePeriod = await gov.gracePeriod().then(_ => _.toNumber());
  });

  it("vote with delegated", async () => {
    await grep.delegateTo(acct.address);
    await gov.connect(acct).castVote(proposalId, true);
    expect((await gov.proposals(proposalId)).forVotes).to.eq(BN.from(1500000)); //root + acct
    expect((await gov.getReceipt(proposalId, acct.address)).votes).to.eq(
      BN.from(1500000)
    ); //root + acct
  });

  it("should be able to vote as delegate without my own delegated votes", async () => {
    await gov.castVote(proposalId, true);
    expect((await gov.getReceipt(proposalId, root.address)).hasVoted).to.true;
  });

  it("cancel when undelegated and proposer votes below threshold", async () => {
    await grep.delegateTo(signers[4].address);

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
    await grep.undelegate();
    await gov.cancel(proposalId);
    expect(states[await gov.state(proposalId)]).to.equal("Canceled");
  });

  it("should not count delegatees that voted", async () => {
    await gov
      .connect(acct)
      ["propose(address[],uint256[],string[],bytes[],string)"](
        targets,
        values,
        signatures,
        callDatas,
        "do nothing"
      );
    let proposalId = await gov.latestProposalIds(acct.address);
    await advanceBlocks(1);
    await gov.castVote(proposalId, false);
    await gov.connect(acct).castVote(proposalId, false);

    expect((await gov.getReceipt(proposalId, acct.address)).votes).to.eq(
      BN.from(500000)
    );

    const delegateeReceipt = await gov.getReceipt(proposalId, root.address);
    expect(delegateeReceipt.votes).to.eq(BN.from(1000000));
    expect(delegateeReceipt.hasVoted).to.eq(true);
  });
});
