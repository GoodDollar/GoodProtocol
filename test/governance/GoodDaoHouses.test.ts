import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { createDAO, increaseTime } from "../helpers";

const CITIZENS = 0;
const ALIGNMENT = 1;
const PENDING = 1;
const ACTIVE = 2;
const UNSTAKED = 4;

describe("GoodDaoHouses", () => {
  const citizensMinimumStake = 1000;
  const alignmentMinimumStake = 2000;

  const fixture = async () => {
    const [admin, committee, citizenOne, citizenTwo, alignmentOne, alignmentTwo] =
      await ethers.getSigners();

    const { gd, nameService } = await loadFixture(createDAO);

    const goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    const flowSplitter = await ethers.deployContract("MockFlowSplitter");
    const houses = await upgrades.deployProxy(
      await ethers.getContractFactory("GoodDaoHouses"),
      [
        nameService.address,
        admin.address,
        committee.address,
        citizensMinimumStake,
        alignmentMinimumStake
      ],
      { kind: "uups" }
    );

    return {
      admin,
      committee,
      citizenOne,
      citizenTwo,
      alignmentOne,
      alignmentTwo,
      goodDollar,
      flowSplitter,
      houses
    };
  };

  const registerViaTransferAndCall = async (
    goodDollar,
    houses,
    signer,
    house,
    amount,
    metadata
  ) => {
    const data = ethers.utils.defaultAbiCoder.encode(
      ["uint8", "string"],
      [house, metadata]
    );

    await goodDollar.mint(signer.address, amount);
    await goodDollar.connect(signer).transferAndCall(houses.address, amount, data);
  };

  it("registers citizens immediately and alignment members through eligibility plus approval", async () => {
    const { committee, citizenOne, alignmentOne, goodDollar, houses } =
      await loadFixture(fixture);

    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentOne.address, true);

    await registerViaTransferAndCall(
      goodDollar,
      houses,
      citizenOne,
      CITIZENS,
      citizensMinimumStake,
      "citizen-one"
    );
    await registerViaTransferAndCall(
      goodDollar,
      houses,
      alignmentOne,
      ALIGNMENT,
      alignmentMinimumStake,
      "alignment-one"
    );

    const citizenMember = await houses.getMember(citizenOne.address);
    const alignmentMemberBeforeApproval = await houses.getMember(
      alignmentOne.address
    );

    expect(citizenMember.status).to.equal(ACTIVE);
    expect(alignmentMemberBeforeApproval.status).to.equal(PENDING);

    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);

    const alignmentMemberAfterApproval = await houses.getMember(
      alignmentOne.address
    );
    const activeAlignmentMembers = await houses.getActiveMembers(ALIGNMENT);

    expect(alignmentMemberAfterApproval.status).to.equal(ACTIVE);
    expect(activeAlignmentMembers).to.deep.equal([alignmentOne.address]);
  });

  it("snapshots voters, allows ballot replacement, and finalizes deterministic units", async () => {
    const {
      committee,
      citizenOne,
      citizenTwo,
      alignmentOne,
      alignmentTwo,
      goodDollar,
      houses
    } = await loadFixture(fixture);

    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentOne.address, true);
    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentTwo.address, true);

    await registerViaTransferAndCall(
      goodDollar,
      houses,
      citizenOne,
      CITIZENS,
      citizensMinimumStake,
      "citizen-one"
    );
    await registerViaTransferAndCall(
      goodDollar,
      houses,
      citizenTwo,
      CITIZENS,
      citizensMinimumStake,
      "citizen-two"
    );
    await registerViaTransferAndCall(
      goodDollar,
      houses,
      alignmentOne,
      ALIGNMENT,
      alignmentMinimumStake,
      "alignment-one"
    );
    await registerViaTransferAndCall(
      goodDollar,
      houses,
      alignmentTwo,
      ALIGNMENT,
      alignmentMinimumStake,
      "alignment-two"
    );

    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    await houses.connect(committee).createAlignmentVote(3600, 1000, "Q1");

    const voteId = await houses.voteCount();
    const [alignmentVoters, citizensVoters] = await houses.getVoteVoters(voteId);

    expect(alignmentVoters).to.deep.equal([
      alignmentOne.address,
      alignmentTwo.address
    ]);
    expect(citizensVoters).to.deep.equal([
      citizenOne.address,
      citizenTwo.address
    ]);

    await houses
      .connect(alignmentOne)
      .castVote(voteId, [alignmentOne.address], [10000]);
    await houses
      .connect(citizenOne)
      .castVote(voteId, [alignmentTwo.address], [10000]);
    await houses
      .connect(citizenTwo)
      .castVote(voteId, [alignmentTwo.address], [10000]);

    await houses
      .connect(alignmentTwo)
      .castVote(voteId, [alignmentTwo.address], [10000]);
    await houses
      .connect(alignmentTwo)
      .castVote(voteId, [alignmentOne.address], [10000]);

    const [ballotRecipients, ballotAllocations] = await houses.getBallot(
      voteId,
      alignmentTwo.address
    );

    expect(ballotRecipients).to.deep.equal([alignmentOne.address]);
    expect(ballotAllocations[0]).to.equal(10000);

    await increaseTime(3601);
    await houses.connect(committee).finalizeAlignmentVote(voteId);

    expect(await houses.getFinalizedUnits(voteId, alignmentOne.address)).to.equal(
      909
    );
    expect(await houses.getFinalizedUnits(voteId, alignmentTwo.address)).to.equal(
      90
    );
  });

  it("creates the flow splitter pool once, updates units on later votes, and zeroes units on unstake", async () => {
    const {
      committee,
      citizenOne,
      citizenTwo,
      alignmentOne,
      alignmentTwo,
      goodDollar,
      flowSplitter,
      houses
    } = await loadFixture(fixture);

    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentOne.address, true);
    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentTwo.address, true);

    await registerViaTransferAndCall(
      goodDollar,
      houses,
      citizenOne,
      CITIZENS,
      citizensMinimumStake,
      "citizen-one"
    );
    await registerViaTransferAndCall(
      goodDollar,
      houses,
      citizenTwo,
      CITIZENS,
      citizensMinimumStake,
      "citizen-two"
    );
    await registerViaTransferAndCall(
      goodDollar,
      houses,
      alignmentOne,
      ALIGNMENT,
      alignmentMinimumStake,
      "alignment-one"
    );
    await registerViaTransferAndCall(
      goodDollar,
      houses,
      alignmentTwo,
      ALIGNMENT,
      alignmentMinimumStake,
      "alignment-two"
    );

    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    await houses.connect(committee).configureFlowSplitter(
      flowSplitter.address,
      goodDollar.address,
      "GoodDao Houses pool",
      "GoodDao Houses",
      "GDH",
      18,
      false,
      false
    );

    await houses.connect(committee).createAlignmentVote(3600, 1000, "Q1");
    let voteId = await houses.voteCount();

    await houses
      .connect(alignmentOne)
      .castVote(voteId, [alignmentOne.address], [10000]);
    await houses
      .connect(alignmentTwo)
      .castVote(voteId, [alignmentOne.address], [10000]);
    await houses
      .connect(citizenOne)
      .castVote(voteId, [alignmentOne.address], [10000]);
    await houses
      .connect(citizenTwo)
      .castVote(voteId, [alignmentOne.address], [10000]);

    await increaseTime(3601);
    await houses.connect(committee).finalizeAlignmentVote(voteId);
    await houses.connect(committee).executeVote(voteId);

    let flowConfig = await houses.getFlowSplitterConfig();

    expect(flowConfig.poolInitialized).to.equal(true);
    expect(flowConfig.poolId).to.equal(1);
    expect(await flowSplitter.getMemberUnits(1, alignmentOne.address)).to.equal(
      1000
    );
    expect(await flowSplitter.getMemberUnits(1, alignmentTwo.address)).to.equal(0);

    await houses.connect(committee).createAlignmentVote(3600, 1000, "Q2");
    voteId = await houses.voteCount();

    await houses
      .connect(alignmentOne)
      .castVote(voteId, [alignmentTwo.address], [10000]);
    await houses
      .connect(alignmentTwo)
      .castVote(voteId, [alignmentTwo.address], [10000]);
    await houses
      .connect(citizenOne)
      .castVote(voteId, [alignmentTwo.address], [10000]);
    await houses
      .connect(citizenTwo)
      .castVote(voteId, [alignmentTwo.address], [10000]);

    await increaseTime(3601);
    await houses.connect(committee).finalizeAlignmentVote(voteId);
    await houses.connect(committee).executeVote(voteId);

    flowConfig = await houses.getFlowSplitterConfig();
    expect(flowConfig.poolId).to.equal(1);
    expect(await flowSplitter.getMemberUnits(1, alignmentOne.address)).to.equal(0);
    expect(await flowSplitter.getMemberUnits(1, alignmentTwo.address)).to.equal(
      1000
    );

    await houses.connect(alignmentTwo).unstake();

    const alignmentMember = await houses.getMember(alignmentTwo.address);
    expect(alignmentMember.status).to.equal(UNSTAKED);
    expect(await flowSplitter.getMemberUnits(1, alignmentTwo.address)).to.equal(0);
  });
});
