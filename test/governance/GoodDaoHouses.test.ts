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
  const alignmentForumUrl = "https://forum.gooddollar.org/t/alignment-one";

  const fixture = async () => {
    const [
      admin,
      committee,
      citizenOne,
      citizenTwo,
      alignmentOne,
      alignmentTwo,
      lateCitizen
    ] =
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
      lateCitizen,
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
    details
  ) => {
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

  const registerAlignment = async (
    goodDollar,
    houses,
    signer,
    name,
    distributionStrategy = alignmentForumUrl
  ) =>
    registerViaTransferAndCall(
      goodDollar,
      houses,
      signer,
      ALIGNMENT,
      alignmentMinimumStake,
      {
        name,
        projectWebpage: `https://${name}.example`,
        missionStatement: `${name} mission`,
        distributionStrategy
      }
    );

  const moveToNextVotingWindow = async houses => {
    const latestBlock = await ethers.provider.getBlock("latest");
    const termDuration = (await houses.termDuration()).toNumber();
    const offset = latestBlock.timestamp % termDuration;
    const delta = offset === 0 ? 1 : termDuration - offset + 1;

    await increaseTime(delta);

    return houses.getCurrentVoteId();
  };

  const movePastVotingWindow = async houses => {
    const latestBlock = await ethers.provider.getBlock("latest");
    const termDuration = (await houses.termDuration()).toNumber();
    const votingTermLength = (await houses.votingTermLength()).toNumber();
    const offset = latestBlock.timestamp % termDuration;

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

  it("writes house fields on chain and approves alignment members after eligibility", async () => {
    const { committee, citizenOne, alignmentOne, goodDollar, houses } =
      await loadFixture(fixture);

    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentOne.address, true);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerAlignment(
      goodDollar,
      houses,
      alignmentOne,
      "alignment-one",
      alignmentForumUrl
    );

    const citizenMember = await houses.getMember(citizenOne.address);
    const alignmentMemberBeforeApproval = await houses.getMember(
      alignmentOne.address
    );

    expect(citizenMember.status).to.equal(ACTIVE);
    expect(citizenMember.name).to.equal("citizen-one");
    expect(citizenMember.socialLinks).to.equal(
      "https://social.example/citizen-one"
    );
    expect(alignmentMemberBeforeApproval.status).to.equal(PENDING);
    expect(alignmentMemberBeforeApproval.projectWebpage).to.equal(
      "https://alignment-one.example"
    );
    expect(alignmentMemberBeforeApproval.missionStatement).to.equal(
      "alignment-one mission"
    );
    expect(alignmentMemberBeforeApproval.distributionStrategy).to.equal(
      alignmentForumUrl
    );

    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);

    const alignmentMemberAfterApproval = await houses.getMember(
      alignmentOne.address
    );
    const activeAlignmentMembers = await houses.getActiveMembers(ALIGNMENT);

    expect(alignmentMemberAfterApproval.status).to.equal(ACTIVE);
    expect(activeAlignmentMembers).to.deep.equal([alignmentOne.address]);
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
      houses
    } = await loadFixture(fixture);

    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentOne.address, true);
    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentTwo.address, true);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerCitizen(goodDollar, houses, citizenTwo, "citizen-two");
    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(goodDollar, houses, alignmentTwo, "alignment-two");

    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const voteId = await moveToNextVotingWindow(houses);

    const [alignmentVoters, citizensVoters] = await houses.getVoteVoters(voteId);

    expect(alignmentVoters).to.deep.equal([]);
    expect(citizensVoters).to.deep.equal([]);

    await houses
      .connect(alignmentOne)
      .castVote([alignmentOne.address], [10000]);
    await houses
      .connect(citizenOne)
      .castVote([alignmentTwo.address], [10000]);
    await houses
      .connect(citizenTwo)
      .castVote([alignmentTwo.address], [10000]);

    await houses
      .connect(alignmentTwo)
      .castVote([alignmentTwo.address], [10000]);
    await houses
      .connect(alignmentTwo)
      .castVote([alignmentOne.address], [10000]);

    const createdVoteId = await houses.getCurrentVoteId();
    const vote = await houses.getVote(createdVoteId);
    const [createdAlignmentVoters, createdCitizensVoters] =
      await houses.getVoteVoters(createdVoteId);

    expect(createdVoteId).to.equal(voteId);
    expect(createdAlignmentVoters).to.deep.equal([
      alignmentOne.address,
      alignmentTwo.address
    ]);
    expect(createdCitizensVoters).to.deep.equal([
      citizenOne.address,
      citizenTwo.address
    ]);
    expect(vote.startTime).to.equal(
      createdVoteId.mul(await houses.termDuration())
    );

    await registerCitizen(goodDollar, houses, lateCitizen, "late-citizen");

    await expect(
      houses.connect(lateCitizen).castVote([alignmentOne.address], [10000])
    ).to.be.revertedWith("Voter is not eligible for this term");

    const [ballotRecipients, ballotAllocations] = await houses.getBallot(
      createdVoteId,
      alignmentTwo.address
    );

    expect(ballotRecipients).to.deep.equal([alignmentOne.address]);
    expect(ballotAllocations[0]).to.equal(10000);

    expect(
      await houses.getFinalizedUnits(createdVoteId, alignmentOne.address)
    ).to.equal(
      80
    );
    expect(
      await houses.getFinalizedUnits(createdVoteId, alignmentTwo.address)
    ).to.equal(
      8
    );
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
      houses
    } = await loadFixture(fixture);

    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentOne.address, true);
    await houses
      .connect(committee)
      .setAlignmentEligibility(alignmentTwo.address, true);

    await registerCitizen(goodDollar, houses, citizenOne, "citizen-one");
    await registerCitizen(goodDollar, houses, citizenTwo, "citizen-two");
    await registerAlignment(goodDollar, houses, alignmentOne, "alignment-one");
    await registerAlignment(goodDollar, houses, alignmentTwo, "alignment-two");

    await houses.connect(committee).approveAlignmentMember(alignmentOne.address);
    await houses.connect(committee).approveAlignmentMember(alignmentTwo.address);

    const poolId = await createManagedFlowSplitterPool(
      flowSplitter,
      goodDollar,
      houses
    );

    await houses.connect(committee).configureFlowSplitter(flowSplitter.address, poolId);

    let voteId = await moveToNextVotingWindow(houses);

    await houses
      .connect(alignmentOne)
      .castVote([alignmentOne.address], [10000]);
    await houses
      .connect(alignmentTwo)
      .castVote([alignmentOne.address], [10000]);
    await houses
      .connect(citizenOne)
      .castVote([alignmentOne.address], [10000]);
    await houses
      .connect(citizenTwo)
      .castVote([alignmentOne.address], [10000]);

    await movePastVotingWindow(houses);
    await houses.connect(committee).executeVote(voteId);

    let flowConfig = await houses.getFlowSplitterConfig();

    expect(flowConfig.poolId).to.equal(1);
    expect(await flowSplitter.getMemberUnits(1, alignmentOne.address)).to.equal(
      88
    );
    expect(await flowSplitter.getMemberUnits(1, alignmentTwo.address)).to.equal(0);

    voteId = await moveToNextVotingWindow(houses);

    await houses
      .connect(alignmentOne)
      .castVote([alignmentTwo.address], [10000]);
    await houses
      .connect(alignmentTwo)
      .castVote([alignmentTwo.address], [10000]);
    await houses
      .connect(citizenOne)
      .castVote([alignmentTwo.address], [10000]);
    await houses
      .connect(citizenTwo)
      .castVote([alignmentTwo.address], [10000]);

    await movePastVotingWindow(houses);
    await houses.connect(committee).executeVote(voteId);

    flowConfig = await houses.getFlowSplitterConfig();
    expect(flowConfig.poolId).to.equal(1);
    expect(await flowSplitter.getMemberUnits(1, alignmentOne.address)).to.equal(0);
    expect(await flowSplitter.getMemberUnits(1, alignmentTwo.address)).to.equal(
      88
    );

    await houses.connect(alignmentTwo).unstake();

    const alignmentMember = await houses.getMember(alignmentTwo.address);
    expect(alignmentMember.status).to.equal(UNSTAKED);
    expect(await flowSplitter.getMemberUnits(1, alignmentTwo.address)).to.equal(0);
  });
});
