import { ethers, upgrades } from "hardhat";
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

describe("CompoundVotingMachine#States", () => {
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
      setSchemes,
      avatar,
      reputation,
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

    //set voting machiine as scheme with permissions
    await setSchemes([gov.address]);
    await grep.mint(root.address, ethers.BigNumber.from("1000000"));
    await grep.mint(acct.address, ethers.BigNumber.from("500000"));

    targets = [grep.address, grep.address];
    values = ["0", "0"];
    signatures = ["balanceOf(address)", ""];
    callDatas = [
      encodeParameters(["address"], [acct.address]),
      grep.interface.encodeFunctionData("balanceOf", [acct.address])
    ];

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

  it("Invalid for proposal not found", async () => {
    await expect(gov.state(5)).to.revertedWith(
      "CompoundVotingMachine::state: invalid proposal id"
    );
  });

  it("Pending", async () => {
    expect(states[await gov.state(trivialProposal.id)]).to.equal("Pending");
  });

  it("Active", async () => {
    await ethers.provider.send("evm_mine", []);
    await ethers.provider.send("evm_mine", []);
    expect(states[await gov.state(trivialProposal.id)]).to.equal("Active");
  });

  it("Canceled", async () => {
    let actor = signers[4];
    await grep.delegateTo(actor.address);
    await gov
      .connect(actor)
      ["propose(address[],uint256[],string[],bytes[],string)"](
        targets,
        values,
        signatures,
        callDatas,
        "do nothing"
      );
    let newProposalId = await gov.proposalCount();

    // send away the delegates
    await grep.undelegate();
    await gov.cancel(newProposalId);

    expect(states[await gov.state(newProposalId)]).to.equal("Canceled");
  });

  it("Defeated", async () => {
    // travel to end block
    await advanceBlocks(votePeriod + 2);

    expect(states[await gov.state(trivialProposal.id)]).to.equal("Defeated");
  });

  describe("queue period", async () => {
    let proposalId;
    before(async () => {
      await advanceBlocks(1);
      await gov["propose(address[],uint256[],string[],bytes[],string)"](
        targets,
        values,
        signatures,
        callDatas,
        "do nothing"
      );
      proposalId = await gov.latestProposalIds(root.address);
      await advanceBlocks(1);
    });

    it("ActiveTimelock in queue period", async () => {
      await gov.castVote(proposalId, true);
      await advanceBlocks(1);
      expect((await gov.proposals(proposalId)).eta).to.gt(0);
      await increaseTime(queuePeriod / 2);
      expect(states[await gov.state(proposalId)]).to.equal("ActiveTimelock"); //active while in queue period
    });
    it("succeeded after queue period", async () => {
      await increaseTime(queuePeriod / 2);
      expect(states[await gov.state(proposalId)]).to.equal("Succeeded");
    });

    it("Still succeeded in grace period", async () => {
      await increaseTime(gracePeriod - 10);
      expect(states[await gov.state(proposalId)]).to.equal("Succeeded");
    });

    it("Cant vote in grace period", async () => {
      let proposalId = await gov.latestProposalIds(root.address);
      await expect(
        gov.connect(acct).castVote(proposalId, false)
      ).to.be.revertedWith(
        "CompoundVotingMachine::_castVote: voting is closed"
      );
    });

    it("Expired after grace period", async () => {
      await increaseTime(10);
      expect(states[await gov.state(proposalId)]).to.equal("Expired");
      await expect(gov.execute(proposalId)).to.be.revertedWith(
        "CompoundVotingMachine::execute: proposal can only be executed if it is succeeded"
      );
    });
  });

  //

  it("ActiveTimelock in queue period then defeated", async () => {
    let actor = signers[0];
    await grep.mint(actor.address, ethers.BigNumber.from("1000000"));

    await advanceBlocks(1);
    await gov
      .connect(actor)
      ["propose(address[],uint256[],string[],bytes[],string)"](
        targets,
        values,
        signatures,
        callDatas,
        "do nothing"
      );
    let proposalId = await gov.latestProposalIds(actor.address);
    await advanceBlocks(1);
    await gov.connect(actor).castVote(proposalId, false);
    expect((await gov.proposals(proposalId)).eta).to.gt(0);
    await increaseTime(queuePeriod / 2);
    expect(states[await gov.state(proposalId)]).to.equal("ActiveTimelock"); //active while in queue period
    await increaseTime(queuePeriod / 2);
    expect(states[await gov.state(proposalId)]).to.equal("Defeated");
    await increaseTime(gracePeriod);
    expect(states[await gov.state(proposalId)]).to.equal("Defeated"); //still defeated after expiration
  });

  it("Executed", async () => {
    let actor = signers[1];
    await grep.mint(actor.address, ethers.BigNumber.from("1000000"));
    await advanceBlocks(1);
    await gov
      .connect(actor)
      ["propose(address[],uint256[],string[],bytes[],string)"](
        targets,
        values,
        signatures,
        callDatas,
        "do nothing"
      );
    let proposalId = await gov.latestProposalIds(actor.address);
    await advanceBlocks(1);
    await gov.connect(actor).castVote(proposalId, true);
    expect((await gov.proposals(proposalId)).eta).to.gt(0);
    await increaseTime(queuePeriod);
    expect(states[await gov.state(proposalId)]).to.equal("Succeeded");
    let eta = (await gov.proposals(proposalId)).eta;

    await increaseTime(gracePeriod / 2);

    expect(states[await gov.state(proposalId)]).to.equal("Succeeded"); //still succeeded

    await gov.execute(proposalId);

    expect(states[await gov.state(proposalId)]).to.equal("Executed");

    // still executed even though would be expired
    await increaseTime(gracePeriod);

    expect(states[await gov.state(proposalId)]).to.equal("Executed");
  });

  it("can not cancel executed proposal", async () => {
    let actor = signers[1];
    let proposalId = await gov.latestProposalIds(actor.address);
    await expect(gov.cancel(proposalId)).to.be.revertedWith(
      "cannot cancel executed proposal"
    );
  });

  it("Game changer extends eta", async () => {
    let gameChangerPeriod = await gov
      .gameChangerPeriod()
      .then(_ => _.toNumber());
    await advanceBlocks(1);
    await gov["propose(address[],uint256[],string[],bytes[],string)"](
      targets,
      values,
      signatures,
      callDatas,
      "do nothing"
    );
    let proposalId = await gov.latestProposalIds(root.address);
    await advanceBlocks(1);
    await gov.connect(acct).castVote(proposalId, false);
    let firstEta = (await gov.proposals(proposalId)).eta;
    expect(firstEta).to.gt(0);
    await increaseTime(queuePeriod / 2);
    expect(states[await gov.state(proposalId)]).to.equal("ActiveTimelock"); //active while in queue period
    await increaseTime(queuePeriod / 2 - 10); //almost to end of queue period
    await gov.castVote(proposalId, true);
    let secondEta = (await gov.proposals(proposalId)).eta;
    expect(firstEta).to.lt(secondEta); //eta should now end in atleast gameChangrePeriod
    // expect(secondEta.sub(firstEta)).to.eq(gameChangerPeriod.sub(1));
    await increaseTime(gameChangerPeriod - 10); //almost to end of gameChangerPeriod
    expect(states[await gov.state(proposalId)]).to.equal("ActiveTimelock"); //should be still active after almost 24hours
    await increaseTime(10);
    expect(states[await gov.state(proposalId)]).to.equal("Succeeded");
    await increaseTime(gracePeriod);
  });

  it("can be executed after short activetimelock period when passed with absolute majority", async () => {
    let fastQueuePeriod = await gov.fastQueuePeriod().then(_ => _.toNumber());
    await advanceBlocks(1);
    await gov
      .connect(signers[0])
      ["propose(address[],uint256[],string[],bytes[],string)"](
        targets,
        values,
        signatures,
        callDatas,
        "do nothing"
      );
    let proposalId = await gov.proposalCount();
    await advanceBlocks(1);

    //vote with > 50%
    await gov.connect(root).castVote(proposalId, true);
    await gov.connect(signers[0]).castVote(proposalId, true);
    await gov.connect(signers[1]).castVote(proposalId, true);

    let proposal = await gov.proposals(proposalId);
    expect(proposal.forVotes).gt((await grep.totalSupply()).div(2)); //verify absolute majority

    await increaseTime(fastQueuePeriod / 2);
    expect(states[await gov.state(proposalId)]).to.equal("ActiveTimelock"); //active while in queue period

    await increaseTime(fastQueuePeriod / 2);
    await advanceBlocks(1);
    expect(states[await gov.state(proposalId)]).to.equal("Succeeded");
    await expect(gov.execute(proposalId)).to.not.reverted;
  });
});
