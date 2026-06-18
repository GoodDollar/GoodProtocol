import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { createDAO, increaseTime } from "../helpers";

const CITIZENS = 0;
const ALIGNMENT = 1;
const PENDING = 1;
const ACTIVE = 2;
const REVOKED = 3;

describe("GoodDaoHouses", () => {
  const citizensMinimumStake = 1000;
  const alignmentMinimumStake = 2000;
  const alignmentForumUrl = "https://forum.gooddollar.org/t/alignment-one";

  const fixture = async () => {
    const [admin, committee, citizenOne, citizenTwo, alignmentOne, alignmentTwo, lateCitizen] =
      await ethers.getSigners();

    const { gd, nameService, addWhitelisted } = await loadFixture(createDAO);

    const goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    const flowSplitter = await ethers.deployContract("MockFlowSplitter");
    const houses = await upgrades.deployProxy(
      await ethers.getContractFactory("GoodDaoHouses"),
      [nameService.address, admin.address, committee.address, citizensMinimumStake, alignmentMinimumStake],
      { kind: "uups" }
    );

    return {
      admin,
      committee,
      citizenOne,
      citizenTwo,
      alignmentOne,
      alignmentTwo,
      lateCitizen,
      goodDollar,
      flowSplitter,
      houses,
      addWhitelisted
    };
  };

  const registerViaTransferAndCall = async (goodDollar, houses, signer, house, amount, details) => {
    const data = ethers.utils.defaultAbiCoder.encode(
      ["uint8", "string", "string", "string", "string", "string"],
      [
        house,
        details.name,
        details.socialLinks ?? "",
        details.projectWebpage ?? "",
        details.missionStatement ?? "",
        details.distributionStrategy ?? ""
      ]
    );

    await goodDollar.mint(signer.address, amount);
    await goodDollar.connect(signer).transferAndCall(houses.address, amount, data);
  };

  const registerCitizen = async (goodDollar, houses, signer, name = "citizen") =>
    registerViaTransferAndCall(goodDollar, houses, signer, CITIZENS, citizensMinimumStake, {
      name,
      socialLinks: "https://social.example/" + name
    });

  const registerAlignment = async (goodDollar, houses, signer, name, distributionStrategy = alignmentForumUrl) =>
    registerViaTransferAndCall(goodDollar, houses, signer, ALIGNMENT, alignmentMinimumStake, {
      name,
      projectWebpage: `https://${name}.example`,
      missionStatement: `${name} mission`,
      distributionStrategy
    });

  const moveToNextVotingWindow = async houses => {
    const latestBlock = await ethers.provider.getBlock("latest");
    const cycleStartTime = (await houses.cycleStartTime()).toNumber();
    const termDuration = (await houses.termDuration()).toNumber();
    const delta =
      latestBlock.timestamp < cycleStartTime
        ? cycleStartTime - latestBlock.timestamp
        : (() => {
            const offset = (latestBlock.timestamp - cycleStartTime) % termDuration;
            return offset === 0 ? 1 : termDuration - offset + 1;
          })();

    await increaseTime(delta);

    return houses.getCurrentVoteId();
  };

  const movePastVotingWindow = async houses => {
    const latestBlock = await ethers.provider.getBlock("latest");
    const cycleStartTime = (await houses.cycleStartTime()).toNumber();
    const termDuration = (await houses.termDuration()).toNumber();
    const votingTermLength = (await houses.votingTermLength()).toNumber();
    const offset = latestBlock.timestamp < cycleStartTime ? 0 : (latestBlock.timestamp - cycleStartTime) % termDuration;

    if (offset <= votingTermLength) {
      await increaseTime(votingTermLength - offset + 1);
    }
  };

  const createManagedFlowSplitterPool = async (flowSplitter, goodDollar, houses) => {
    await flowSplitter.createPool(
      goodDollar.address,
      {
        transferabilityForUnitsOwner: false,
        distributionFromAnyAddress: false
      },
      {
        name: "GoodDao Houses",
        symbol: "GDH",
        decimals: 18
      },
      [],
      [houses.address],
      "GoodDao Houses pool"
    );

    return flowSplitter.poolCounter();
  };

  it("writes house fields on chain and approves alignment members", async () => {
    const { committee, citizenOne, alignmentOne, goodDollar, houses } = await loadFixture(fixture);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one", alignmentForumUrl);

    const citizenMember = await houses.getMember(citizenOne.address);
    const alignmentMemberBeforeApproval = await houses.getMember(alignmentOne.address);

    expect(citizenMember.status).to.equal(ACTIVE);
    expect(citizenMember.name).to.equal("citizen-one");
    expect(citizenMember.socialLinks).to.equal("https://social.example/citizen-one");
    expect(alignmentMemberBeforeApproval.status).to.equal(PENDING);
    expect(alignmentMemberBeforeApproval.projectWebpage).to.equal("https://alignment-one.example");
    expect(alignmentMemberBeforeApproval.missionStatement).to.equal("alignment-one mission");
    expect(alignmentMemberBeforeApproval.distributionStrategy).to.equal(alignmentForumUrl);

    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);

    const alignmentMemberAfterApproval = await houses.getMember(alignmentOne.address);
    const activeAlignmentMembers = await houses["getActiveMembers(uint8)"](ALIGNMENT);

    expect(alignmentMemberAfterApproval.status).to.equal(ACTIVE);
    expect(activeAlignmentMembers).to.deep.equal([alignmentOne.address]);
  });

  it("lets admin or committee set the voting schedule anchor and term lengths", async () => {
    const { admin, committee, houses } = await loadFixture(fixture);
    const latestBlock = await ethers.provider.getBlock("latest");
    const nextCycleStart = latestBlock.timestamp + 3 * 24 * 60 * 60;

    await houses.connect(committee).setVotingSchedule(nextCycleStart, 120 * 24 * 60 * 60, 10 * 24 * 60 * 60);

    expect(await houses.cycleStartTime()).to.equal(nextCycleStart);
    expect(await houses.termDuration()).to.equal(120 * 24 * 60 * 60);
    expect(await houses.votingTermLength()).to.equal(10 * 24 * 60 * 60);

    const updatedCycleStart = nextCycleStart + 24 * 60 * 60;
    await houses.connect(admin).setVotingSchedule(updatedCycleStart, 90 * 24 * 60 * 60, 7 * 24 * 60 * 60);

    expect(await houses.cycleStartTime()).to.equal(updatedCycleStart);
    expect(await houses.termDuration()).to.equal(90 * 24 * 60 * 60);
    expect(await houses.votingTermLength()).to.equal(7 * 24 * 60 * 60);
  });

  it("creates the term vote on first ballot, blocks late joiners, and stores direct weighted units", async () => {
    const {
      committee,
      citizenOne,
      citizenTwo,
      alignmentOne,
      alignmentTwo,
      lateCitizen,
      goodDollar,
      houses,
      addWhitelisted
    } = await loadFixture(fixture);

    await addWhitelisted(citizenOne.address, "did:gooddollar:citizen-one");
    await addWhitelisted(citizenTwo.address, "did:gooddollar:citizen-two");
    await addWhitelisted(lateCitizen.address, "did:gooddollar:late-citizen");

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerCitizen(goodDollar, houses, citizenTwo, "citizen-two");
    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(goodDollar, houses, alignmentTwo, "alignment-two");

    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const voteId = await moveToNextVotingWindow(houses);

    expect(await houses.getVoteRecipients(voteId)).to.deep.equal([]);

    await houses.connect(alignmentOne).castVote([alignmentOne.address], [10000]);
    await houses.connect(citizenOne).castVote([alignmentTwo.address], [10000]);
    await houses.connect(citizenTwo).castVote([alignmentTwo.address], [10000]);

    await houses.connect(alignmentTwo).castVote([alignmentTwo.address], [10000]);

    const createdVoteId = await houses.getCurrentVoteId();
    const vote = await houses.getVoteConfig(createdVoteId);
    const recipients = await houses.getVoteRecipients(createdVoteId);

    expect(createdVoteId).to.equal(voteId);
    expect(recipients).to.deep.equal([alignmentOne.address, alignmentTwo.address]);
    expect(vote.startTime).to.equal(
      (await houses.cycleStartTime()).add(createdVoteId.mul(await houses.termDuration()))
    );

    await registerCitizen(goodDollar, houses, lateCitizen, "late-citizen");

    await expect(houses.connect(lateCitizen).castVote([alignmentOne.address], [10000])).to.be.revertedWith(
      "Not eligible"
    );

    expect(await houses.getFinalizedUnits(createdVoteId, alignmentOne.address)).to.equal(40 * 1e4);
    expect(await houses.getFinalizedUnits(createdVoteId, alignmentTwo.address)).to.equal(48 * 1e4);
  });

  it("updates units on the managed flow splitter pool and zeroes units on unstake", async () => {
    const {
      committee,
      citizenOne,
      citizenTwo,
      alignmentOne,
      alignmentTwo,
      goodDollar,
      flowSplitter,
      houses,
      addWhitelisted
    } = await loadFixture(fixture);

    await addWhitelisted(citizenOne.address, "did:gooddollar:citizen-onex");
    await addWhitelisted(citizenTwo.address, "did:gooddollar:citizen-twox");

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerCitizen(goodDollar, houses, citizenTwo, "citizen-two");
    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(goodDollar, houses, alignmentTwo, "alignment-two");

    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    // Keep term windows short so identity whitelisting does not expire during this test.
    const latestBlock = await ethers.provider.getBlock("latest");
    await houses.connect(committee).setVotingSchedule(latestBlock.timestamp + 10, 24 * 60 * 60, 12 * 60 * 60);

    const poolId = await createManagedFlowSplitterPool(flowSplitter, goodDollar, houses);

    await houses.connect(committee).configureFlowSplitter(flowSplitter.address, poolId);

    let voteId = await moveToNextVotingWindow(houses);

    await houses.connect(alignmentOne).castVote([alignmentOne.address], [10000]);
    await houses.connect(alignmentTwo).castVote([alignmentOne.address], [10000]);
    await houses.connect(citizenOne).castVote([alignmentOne.address], [10000]);
    await houses.connect(citizenTwo).castVote([alignmentOne.address], [10000]);

    await movePastVotingWindow(houses);
    await houses.connect(committee).executeVote(voteId);

    let flowConfig = await houses.flowSplitterConfig();

    expect(flowConfig.poolId).to.equal(1);
    expect(await flowSplitter.getMemberUnits(1, alignmentOne.address)).to.equal(88 * 1e4);
    expect(await flowSplitter.getMemberUnits(1, alignmentTwo.address)).to.equal(0);

    voteId = await moveToNextVotingWindow(houses);

    await houses.connect(alignmentOne).castVote([alignmentTwo.address], [10000]);
    await houses.connect(alignmentTwo).castVote([alignmentTwo.address], [10000]);
    await houses.connect(citizenOne).castVote([alignmentTwo.address], [10000]);
    await houses.connect(citizenTwo).castVote([alignmentTwo.address], [10000]);

    await movePastVotingWindow(houses);
    await houses.connect(committee).executeVote(voteId);

    flowConfig = await houses.flowSplitterConfig();
    expect(flowConfig.poolId).to.equal(1);
    expect(await flowSplitter.getMemberUnits(1, alignmentOne.address)).to.equal(0);
    expect(await flowSplitter.getMemberUnits(1, alignmentTwo.address)).to.equal(88 * 1e4);

    const termDuration = await houses.termDuration();
    await increaseTime(termDuration.toNumber());
    await houses.connect(alignmentTwo).unstake();

    const alignmentMember = await houses.getMember(alignmentTwo.address);
    expect(alignmentMember.status).to.equal(0);
    expect(await flowSplitter.getMemberUnits(1, alignmentTwo.address)).to.equal(0);
  });

  it("prevents voting twice in the same term", async () => {
    const { committee, alignmentOne, alignmentTwo, goodDollar, houses } = await loadFixture(fixture);

    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(goodDollar, houses, alignmentTwo, "alignment-two");
    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    await moveToNextVotingWindow(houses);

    await houses.connect(alignmentOne).castVote([alignmentOne.address], [10000]);

    await expect(houses.connect(alignmentOne).castVote([alignmentTwo.address], [10000])).to.be.revertedWith(
      "Already voted"
    );
  });

  it("blocks unwhitelisted citizens from voting", async () => {
    const { committee, citizenOne, alignmentOne, goodDollar, houses } = await loadFixture(fixture);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);

    await moveToNextVotingWindow(houses);

    await expect(houses.connect(citizenOne).castVote([alignmentOne.address], [10000])).to.be.revertedWith(
      "Citizen not whitelisted"
    );
  });

  it("reverts unstake before term lock expires, then fully deletes the member record", async () => {
    const { citizenOne, goodDollar, houses } = await loadFixture(fixture);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");

    // Cannot unstake immediately — term has not elapsed yet
    await expect(houses.connect(citizenOne).unstake()).to.be.revertedWith("Term not passed");

    const termDuration = (await houses.termDuration()).toNumber();
    await increaseTime(termDuration);

    await houses.connect(citizenOne).unstake();

    const member = await houses.getMember(citizenOne.address);
    // `delete` zeroes the whole struct; status is None (0), not Unstaked (4)
    expect(member.status).to.equal(0);
    expect(member.stakedAmount).to.equal(0);
    expect(member.name).to.equal("");
  });

  it("swap-removes the unstaked member and updates the remaining member's index", async () => {
    const { citizenOne, citizenTwo, goodDollar, houses } = await loadFixture(fixture);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerCitizen(goodDollar, houses, citizenTwo, "citizen-two");

    expect((await houses.getMember(citizenOne.address)).memberIndex).to.equal(0);
    expect((await houses.getMember(citizenTwo.address)).memberIndex).to.equal(1);

    const termDuration = (await houses.termDuration()).toNumber();
    await increaseTime(termDuration);

    // Unstake the first member; citizenTwo (slot 1) is moved into slot 0
    await houses.connect(citizenOne).unstake();

    expect((await houses.getMember(citizenTwo.address)).memberIndex).to.equal(0);
    const activeMembers = await houses["getActiveMembers(uint8)"](CITIZENS);
    expect(activeMembers).to.deep.equal([citizenTwo.address]);
  });

  it("blocks switching houses on re-registration", async () => {
    const { citizenOne, goodDollar, houses } = await loadFixture(fixture);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");

    await expect(
      registerViaTransferAndCall(goodDollar, houses, citizenOne, ALIGNMENT, alignmentMinimumStake, {
        name: "citizen-as-alignment",
        distributionStrategy: alignmentForumUrl
      })
    ).to.be.revertedWith("Cannot switch houses");
  });

  it("accumulates stake and updates profile on re-registration in the same house", async () => {
    const { citizenOne, goodDollar, houses } = await loadFixture(fixture);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");

    const memberBefore = await houses.getMember(citizenOne.address);
    expect(memberBefore.stakedAmount).to.equal(citizensMinimumStake);
    expect(memberBefore.status).to.equal(ACTIVE);
    const joinedAt = memberBefore.joinedAt;

    // Re-register in the same house with extra stake — profile and cumulative stake update
    const extraStake = 500;
    await registerViaTransferAndCall(goodDollar, houses, citizenOne, CITIZENS, extraStake, {
      name: "citizen-one-v2",
      socialLinks: "https://social.example/citizen-one-v2"
    });

    const memberAfter = await houses.getMember(citizenOne.address);
    expect(memberAfter.stakedAmount).to.equal(citizensMinimumStake + extraStake);
    expect(memberAfter.name).to.equal("citizen-one-v2");
    expect(memberAfter.status).to.equal(ACTIVE);
    expect(memberAfter.joinedAt).to.equal(joinedAt);
  });

  it("returns the correct paginated subset from getActiveMembers", async () => {
    const { citizenOne, citizenTwo, lateCitizen, goodDollar, houses } = await loadFixture(fixture);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerCitizen(goodDollar, houses, citizenTwo, "citizen-two");
    await registerCitizen(goodDollar, houses, lateCitizen, "late-citizen");

    const first2 = await houses["getActiveMembers(uint8,uint256,uint256)"](CITIZENS, 0, 2);
    expect(first2).to.deep.equal([citizenOne.address, citizenTwo.address]);

    const last2 = await houses["getActiveMembers(uint8,uint256,uint256)"](CITIZENS, 1, 3);
    expect(last2).to.deep.equal([citizenTwo.address, lateCitizen.address]);

    // endIndex beyond array length is clamped to the actual length
    const all = await houses["getActiveMembers(uint8,uint256,uint256)"](CITIZENS, 0, 100);
    expect(all).to.deep.equal([citizenOne.address, citizenTwo.address, lateCitizen.address]);
  });

  it("revoking a citizen sets status to Revoked and does not zero FlowSplitter units", async () => {
    const { committee, citizenOne, alignmentOne, goodDollar, flowSplitter, houses } = await loadFixture(fixture);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);

    const poolId = await createManagedFlowSplitterPool(flowSplitter, goodDollar, houses);
    await houses.connect(committee).configureFlowSplitter(flowSplitter.address, poolId);

    await houses.connect(committee).revokeMember(citizenOne.address);

    expect((await houses.getMember(citizenOne.address)).status).to.equal(REVOKED);
    // No FlowSplitter call for a Citizens revoke — alignment units are untouched
    expect(await flowSplitter.getMemberUnits(1, alignmentOne.address)).to.equal(0);
  });

  it("revoking an alignment member clears their FlowSplitter units", async () => {
    const { committee, alignmentOne, alignmentTwo, goodDollar, flowSplitter, houses } = await loadFixture(fixture);

    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(goodDollar, houses, alignmentTwo, "alignment-two");
    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const poolId = await createManagedFlowSplitterPool(flowSplitter, goodDollar, houses);
    await houses.connect(committee).configureFlowSplitter(flowSplitter.address, poolId);

    const voteId = await moveToNextVotingWindow(houses);
    await houses.connect(alignmentOne).castVote([alignmentOne.address], [10000]);
    await houses.connect(alignmentTwo).castVote([alignmentOne.address], [10000]);

    await movePastVotingWindow(houses);
    await houses.connect(committee).executeVote(voteId);

    expect(await flowSplitter.getMemberUnits(1, alignmentOne.address)).to.be.gt(0);

    await houses.connect(committee).revokeMember(alignmentOne.address);

    expect(await flowSplitter.getMemberUnits(1, alignmentOne.address)).to.equal(0);
    expect((await houses.getMember(alignmentOne.address)).status).to.equal(REVOKED);
  });

  it("emits VoteCreated with recipients and VoteCast with voter details on first ballot", async () => {
    const { committee, alignmentOne, alignmentTwo, goodDollar, houses } = await loadFixture(fixture);

    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(goodDollar, houses, alignmentTwo, "alignment-two");
    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const voteId = await moveToNextVotingWindow(houses);
    const expectedStart = (await houses.cycleStartTime()).add((await houses.termDuration()).mul(voteId));
    const expectedEnd = expectedStart.add(await houses.votingTermLength());

    await expect(houses.connect(alignmentOne).castVote([alignmentOne.address], [10000]))
      .to.emit(houses, "VoteCreated")
      .withArgs(voteId, expectedStart, expectedEnd, [alignmentOne.address, alignmentTwo.address])
      .and.to.emit(houses, "VoteCast")
      .withArgs(voteId, alignmentOne.address, [alignmentOne.address], [10000]);
  });

  it("persists the executed flag and blocks re-execution for the same voteId", async () => {
    const { committee, alignmentOne, alignmentTwo, goodDollar, flowSplitter, houses } = await loadFixture(fixture);

    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(goodDollar, houses, alignmentTwo, "alignment-two");
    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const poolId = await createManagedFlowSplitterPool(flowSplitter, goodDollar, houses);
    await houses.connect(committee).configureFlowSplitter(flowSplitter.address, poolId);

    const voteId = await moveToNextVotingWindow(houses);
    await houses.connect(alignmentOne).castVote([alignmentOne.address], [10000]);

    await movePastVotingWindow(houses);
    await houses.connect(committee).executeVote(voteId);

    expect((await houses.getVoteConfig(voteId)).executed).to.equal(true);

    await expect(houses.connect(committee).executeVote(voteId)).to.be.revertedWith("Vote executed");
  });

  it("registerAndStake only pulls the stake delta when the member is below the new minimum", async () => {
    const { committee, citizenOne, goodDollar, houses } = await loadFixture(fixture);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    expect((await houses.getMember(citizenOne.address)).stakedAmount).to.equal(citizensMinimumStake);

    // Raise the minimum — member now has a deficit of 500
    const newMinimum = citizensMinimumStake + 500;
    await houses.connect(committee).setStakeRequirement(CITIZENS, newMinimum);

    // Mint the exact deficit and approve
    await goodDollar.mint(citizenOne.address, 500);
    await goodDollar.connect(citizenOne).approve(houses.address, 500);

    const balanceBefore = await goodDollar.balanceOf(citizenOne.address);
    await houses.connect(citizenOne).registerAndStake(CITIZENS, "citizen-one-v2", "", "", "", "");
    const balanceAfter = await goodDollar.balanceOf(citizenOne.address);

    expect(balanceBefore.sub(balanceAfter)).to.equal(500);
    expect((await houses.getMember(citizenOne.address)).stakedAmount).to.equal(newMinimum);
    expect((await houses.getMember(citizenOne.address)).name).to.equal("citizen-one-v2");
  });

  it("stores a non-zero finalized unit for a 1 basis-point allocation", async () => {
    const { committee, alignmentOne, alignmentTwo, goodDollar, houses } = await loadFixture(fixture);

    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(goodDollar, houses, alignmentTwo, "alignment-two");
    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const voteId = await moveToNextVotingWindow(houses);

    await houses.connect(alignmentOne).castVote([alignmentOne.address, alignmentTwo.address], [1, 9999]);

    expect(await houses.getFinalizedUnits(voteId, alignmentOne.address)).to.be.gt(0);
  });
});
