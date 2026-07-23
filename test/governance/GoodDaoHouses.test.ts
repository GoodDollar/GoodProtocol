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
    const [admin, committee, citizenOne, citizenTwo, alignmentOne, alignmentTwo, lateCitizen, stranger] =
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
      stranger,
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

  const registerAlignment = async (committee, goodDollar, houses, signer, name, distributionStrategy = alignmentForumUrl) => {
    await houses.connect(committee).setHoaEligibility(signer.address, true);
    return registerViaTransferAndCall(goodDollar, houses, signer, ALIGNMENT, alignmentMinimumStake, {
      name,
      projectWebpage: `https://${name}.example`,
      missionStatement: `${name} mission`,
      distributionStrategy
    });
  };

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
    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one", alignmentForumUrl);

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

    await expect(
      houses.connect(committee).setVotingSchedule(nextCycleStart, 120 * 24 * 60 * 60, 10 * 24 * 60 * 60)
    )
      .to.emit(houses, "VotingScheduleUpdated")
      .withArgs(nextCycleStart, 120 * 24 * 60 * 60, 10 * 24 * 60 * 60);

    expect(await houses.cycleStartTime()).to.equal(nextCycleStart);
    expect(await houses.termDuration()).to.equal(120 * 24 * 60 * 60);
    expect(await houses.votingTermLength()).to.equal(10 * 24 * 60 * 60);

    const updatedCycleStart = nextCycleStart + 24 * 60 * 60;

    await expect(
      houses.connect(admin).setVotingSchedule(updatedCycleStart, 90 * 24 * 60 * 60, 7 * 24 * 60 * 60)
    )
      .to.emit(houses, "VotingScheduleUpdated")
      .withArgs(updatedCycleStart, 90 * 24 * 60 * 60, 7 * 24 * 60 * 60);

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
    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(committee, goodDollar, houses, alignmentTwo, "alignment-two");

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
    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(committee, goodDollar, houses, alignmentTwo, "alignment-two");

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

    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(committee, goodDollar, houses, alignmentTwo, "alignment-two");
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
    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
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
    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
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

    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(committee, goodDollar, houses, alignmentTwo, "alignment-two");
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

    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(committee, goodDollar, houses, alignmentTwo, "alignment-two");
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

    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(committee, goodDollar, houses, alignmentTwo, "alignment-two");
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

    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(committee, goodDollar, houses, alignmentTwo, "alignment-two");
    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const voteId = await moveToNextVotingWindow(houses);

    await houses.connect(alignmentOne).castVote([alignmentOne.address, alignmentTwo.address], [1, 9999]);

    expect(await houses.getFinalizedUnits(voteId, alignmentOne.address)).to.be.gt(0);
  });

  it("reverts when revokeMember is called on an address with no membership", async () => {
    const { committee, citizenOne, houses } = await loadFixture(fixture);

    // citizenOne has never registered — MemberStatus.None
    await expect(
      houses.connect(committee).revokeMember(citizenOne.address)
    ).to.be.revertedWith("Not a member");
  });

  it("registerAndStake transfers no tokens when caller already meets the minimum stake", async () => {
    const { committee, citizenOne, goodDollar, houses } = await loadFixture(fixture);

    // Register with the exact minimum via transferAndCall
    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    expect((await houses.getMember(citizenOne.address)).stakedAmount).to.equal(citizensMinimumStake);

    // Lower the minimum so the caller is already above it — no additional transfer should occur
    await houses.connect(committee).setStakeRequirement(CITIZENS, citizensMinimumStake - 100);

    await goodDollar.connect(citizenOne).approve(houses.address, citizensMinimumStake);

    const balanceBefore = await goodDollar.balanceOf(citizenOne.address);
    await houses.connect(citizenOne).registerAndStake(CITIZENS, "citizen-one-v2", "", "", "", "");
    const balanceAfter = await goodDollar.balanceOf(citizenOne.address);

    // No tokens transferred — stake unchanged at the original amount
    expect(balanceBefore).to.equal(balanceAfter);
    expect((await houses.getMember(citizenOne.address)).stakedAmount).to.equal(citizensMinimumStake);
    expect((await houses.getMember(citizenOne.address)).name).to.equal("citizen-one-v2");
  });

  it("rejects registration with an out-of-range house value via transferAndCall", async () => {
    const { citizenOne, goodDollar, houses } = await loadFixture(fixture);

    const invalidHouse = 2; // beyond House.Alignment (max = 1)
    const data = ethers.utils.defaultAbiCoder.encode(
      ["uint8", "string", "string", "string", "string", "string"],
      [invalidHouse, "bad", "", "", "", ""]
    );

    await goodDollar.mint(citizenOne.address, citizensMinimumStake);
    await expect(
      goodDollar.connect(citizenOne).transferAndCall(houses.address, citizensMinimumStake, data)
    ).to.be.revertedWith("Invalid house");
  });

  it("setVotingSchedule: non-admin/committee reverts", async () => {
    const { stranger, houses } = await loadFixture(fixture);

    const latestBlock = await ethers.provider.getBlock("latest");
    const termDuration = (await houses.termDuration()).toNumber();
    const votingTermLength = (await houses.votingTermLength()).toNumber();

    await expect(
      houses.connect(stranger).setVotingSchedule(latestBlock.timestamp + 60, termDuration, votingTermLength)
    ).to.be.revertedWith("Not admin/committee");
  });

  it("setVotingSchedule: votingTermLength > termDuration reverts", async () => {
    const { admin, houses } = await loadFixture(fixture);

    const latestBlock = await ethers.provider.getBlock("latest");
    const termDuration = (await houses.termDuration()).toNumber();

    await expect(
      houses.connect(admin).setVotingSchedule(latestBlock.timestamp + 60, termDuration, termDuration + 1)
    ).to.be.revertedWith("Vote term > term");
  });

  it("setVotingSchedule: zero termDuration reverts", async () => {
    const { admin, houses } = await loadFixture(fixture);

    const latestBlock = await ethers.provider.getBlock("latest");

    await expect(
      houses.connect(admin).setVotingSchedule(latestBlock.timestamp + 60, 0, 0)
    ).to.be.revertedWith("Term=0");
  });

  it("setVotingSchedule: zero votingTermLength reverts", async () => {
    const { admin, houses } = await loadFixture(fixture);

    const latestBlock = await ethers.provider.getBlock("latest");
    const termDuration = (await houses.termDuration()).toNumber();

    await expect(
      houses.connect(admin).setVotingSchedule(latestBlock.timestamp + 60, termDuration, 0)
    ).to.be.revertedWith("Vote term=0");
  });

  it("executeVote: uint128 cast safety – accumulated weighted votes fit in uint128", async () => {
    // Weighted vote per voter = (allocation * HOUSE_ALIGNMENT_WEIGHT) / BASIS_POINTS
    //   = (10000 * 400000) / 10000 = 400000, which is well within uint128 max.
    // This test verifies that executeVote completes without reverting on the bounds check
    // and that the stored units are correct.
    const { committee, alignmentOne, alignmentTwo, goodDollar, flowSplitter, houses } = await loadFixture(fixture);

    await registerAlignment(committee, goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(committee, goodDollar, houses, alignmentTwo, "alignment-two");
    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const poolId = await createManagedFlowSplitterPool(flowSplitter, goodDollar, houses);
    await houses.connect(committee).configureFlowSplitter(flowSplitter.address, poolId);

    const voteId = await moveToNextVotingWindow(houses);
    // Both alignment members vote 100 % for alignmentOne
    await houses.connect(alignmentOne).castVote([alignmentOne.address], [10000]);
    await houses.connect(alignmentTwo).castVote([alignmentOne.address], [10000]);

    await movePastVotingWindow(houses);

    // Should not revert on "Units overflow"
    await expect(houses.connect(committee).executeVote(voteId)).to.not.be.reverted;

    const units = await flowSplitter.getMemberUnits(poolId, alignmentOne.address);
    expect(units).to.be.gt(0);
  });

  it("executeVote: uint128 cast safety – reverts when accumulated weight exceeds uint128 max", async () => {
    // Normal voting can never accumulate enough weight to overflow uint128, so this
    // test injects a value above 2**128 - 1 directly via GoodDaoHousesHarness.
    const [admin, committee, , , alignmentOne, alignmentTwo] = await ethers.getSigners();
    const { gd, nameService } = await loadFixture(createDAO);

    const goodDollar = await ethers.getContractAt("IGoodDollar", gd);
    const flowSplitter = await ethers.deployContract("MockFlowSplitter");

    // Deploy the harness (extends GoodDaoHouses with a test-only weight setter)
    const harness = await upgrades.deployProxy(
      await ethers.getContractFactory("GoodDaoHousesHarness"),
      [nameService.address, admin.address, committee.address, citizensMinimumStake, alignmentMinimumStake],
      { kind: "uups" }
    );

    await registerAlignment(committee, goodDollar, harness, alignmentOne, "alignment-one");
    await registerAlignment(committee, goodDollar, harness, alignmentTwo, "alignment-two");
    await harness.connect(committee).approveAlignmentMember(alignmentOne.address);
    await harness.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const poolId = await createManagedFlowSplitterPool(flowSplitter, goodDollar, harness);
    await harness.connect(committee).configureFlowSplitter(flowSplitter.address, poolId);

    // Cast a normal vote first to create the vote record and register alignmentOne as a recipient
    const voteId = await moveToNextVotingWindow(harness);
    await harness.connect(alignmentOne).castVote([alignmentOne.address], [10000]);

    await movePastVotingWindow(harness);

    // Inject a weight above type(uint128).max (= 2**128) to simulate the overflow scenario
    const overflow = ethers.BigNumber.from(2).pow(128);
    await harness.connect(committee).setVoteWeightForTest(voteId, alignmentOne.address, overflow);

    // executeVote must revert rather than silently truncate the cast
    await expect(harness.connect(committee).executeVote(voteId)).to.be.revertedWith("Units overflow");
  });

  // ── HoA eligibility registry ──────────────────────────────────────────────

  it("setHoaEligibility: only GOVERNANCE_COMMITTEE_ROLE can update eligibility", async () => {
    const { committee, stranger, alignmentOne, houses } = await loadFixture(fixture);

    // Committee can grant eligibility
    await expect(houses.connect(committee).setHoaEligibility(alignmentOne.address, true))
      .to.emit(houses, "HoaEligibilityChanged")
      .withArgs(alignmentOne.address, true);

    expect((await houses.getHoaEligibility(alignmentOne.address)).isEligible).to.equal(true);

    // Non-committee cannot update
    await expect(
      houses.connect(stranger).setHoaEligibility(alignmentOne.address, false)
    ).to.be.reverted;
  });

  it("setHoaEligibility: records listedAt on first listing, delistedAt on removal, and preserves history", async () => {
    const { committee, alignmentOne, houses } = await loadFixture(fixture);

    // Grant eligibility — listedAt and updatedAt should be set
    await houses.connect(committee).setHoaEligibility(alignmentOne.address, true);
    const afterListing = await houses.getHoaEligibility(alignmentOne.address);
    expect(afterListing.isEligible).to.equal(true);
    expect(afterListing.listedAt).to.be.gt(0);
    expect(afterListing.updatedAt).to.be.gt(0);
    expect(afterListing.delistedAt).to.equal(0);
    const originalListedAt = afterListing.listedAt;

    // Remove eligibility — delistedAt set, listedAt preserved
    await houses.connect(committee).setHoaEligibility(alignmentOne.address, false);
    const afterDelisting = await houses.getHoaEligibility(alignmentOne.address);
    expect(afterDelisting.isEligible).to.equal(false);
    expect(afterDelisting.listedAt).to.equal(originalListedAt);
    expect(afterDelisting.delistedAt).to.be.gt(0);

    // Re-list — listedAt stays at original value (not overwritten)
    await houses.connect(committee).setHoaEligibility(alignmentOne.address, true);
    const afterRelisting = await houses.getHoaEligibility(alignmentOne.address);
    expect(afterRelisting.isEligible).to.equal(true);
    expect(afterRelisting.listedAt).to.equal(originalListedAt);
  });

  it("HoA registration via transferAndCall reverts when wallet is not eligible", async () => {
    const { alignmentOne, goodDollar, houses } = await loadFixture(fixture);

    // alignmentOne has NOT been added to the eligibility registry
    await goodDollar.mint(alignmentOne.address, alignmentMinimumStake);
    const data = ethers.utils.defaultAbiCoder.encode(
      ["uint8", "string", "string", "string", "string", "string"],
      [ALIGNMENT, "alignment-one", "", "https://alignment-one.example", "mission", alignmentForumUrl]
    );

    await expect(
      goodDollar.connect(alignmentOne).transferAndCall(houses.address, alignmentMinimumStake, data)
    ).to.be.revertedWith("Not HoA eligible");
  });

  it("HoA registration via registerAndStake reverts when wallet is not eligible", async () => {
    const { alignmentOne, goodDollar, houses } = await loadFixture(fixture);

    await goodDollar.mint(alignmentOne.address, alignmentMinimumStake);
    await goodDollar.connect(alignmentOne).approve(houses.address, alignmentMinimumStake);

    await expect(
      houses
        .connect(alignmentOne)
        .registerAndStake(ALIGNMENT, "alignment-one", "", "https://alignment-one.example", "mission", alignmentForumUrl)
    ).to.be.revertedWith("Not HoA eligible");
  });

  it("HoA registration succeeds and status is Pending after eligibility is granted", async () => {
    const { committee, alignmentOne, goodDollar, houses } = await loadFixture(fixture);

    await houses.connect(committee).setHoaEligibility(alignmentOne.address, true);

    // registerAndStake path
    await goodDollar.mint(alignmentOne.address, alignmentMinimumStake);
    await goodDollar.connect(alignmentOne).approve(houses.address, alignmentMinimumStake);
    await houses
      .connect(alignmentOne)
      .registerAndStake(ALIGNMENT, "alignment-one", "", "https://alignment-one.example", "mission", alignmentForumUrl);

    const member = await houses.getMember(alignmentOne.address);
    expect(member.status).to.equal(PENDING);
    expect(member.house).to.equal(ALIGNMENT);
  });

  it("HoA registration via transferAndCall succeeds and status is Pending after eligibility is granted", async () => {
    const { committee, alignmentOne, goodDollar, houses } = await loadFixture(fixture);

    await houses.connect(committee).setHoaEligibility(alignmentOne.address, true);

    await goodDollar.mint(alignmentOne.address, alignmentMinimumStake);
    const data = ethers.utils.defaultAbiCoder.encode(
      ["uint8", "string", "string", "string", "string", "string"],
      [ALIGNMENT, "alignment-one", "", "https://alignment-one.example", "mission", alignmentForumUrl]
    );
    await goodDollar.connect(alignmentOne).transferAndCall(houses.address, alignmentMinimumStake, data);

    const member = await houses.getMember(alignmentOne.address);
    expect(member.status).to.equal(PENDING);
  });

  it("Citizens registration is unaffected by the HoA eligibility gate", async () => {
    const { citizenOne, goodDollar, houses } = await loadFixture(fixture);

    // citizenOne is NOT in the HoA eligibility registry — Citizens must still register freely
    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");

    const member = await houses.getMember(citizenOne.address);
    expect(member.status).to.equal(ACTIVE);
    expect(member.house).to.equal(CITIZENS);
  });
});
