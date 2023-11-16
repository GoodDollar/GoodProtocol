import hre, { ethers } from "hardhat";
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

describe("CompoundVotingMachine#DAOScheme", () => {
  let gov: CompoundVotingMachine,
    root: SignerWithAddress,
    acct: SignerWithAddress;

  let genericCall, queuePeriod;

  let avatar, mock, Controller, setAddress;

  before(async () => {
    [root, acct, ...signers] = await ethers.getSigners();

    let {
      daoCreator,
      controller,
      avatar: av,
      setSchemes,
      reputation,
      setDAOAddress,
      nameService,
      votingMachine,
      genericCall: gc
    } = await loadFixture(createDAO);
    Controller = controller;
    avatar = av;
    genericCall = gc;
    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;

    gov = votingMachine;
    setAddress = setDAOAddress;

    //this will give root minter permissions
    await setDAOAddress("GDAO_CLAIMERS", root.address);

    //set voting machiine as scheme with permissions
    await setSchemes([gov.address]);

    await grep.mint(root.address, ethers.BigNumber.from("1000000"));
    await grep.mint(acct.address, ethers.BigNumber.from("500000"));

    queuePeriod = await gov.queuePeriod().then(_ => _.toNumber());
  });

  ///cell 0 - votingPeriod blocks, 1 - quoromPercentage, 2 - proposalPercentage,3 - proposalMaxOperations, 4 - voting delay blocks, 5 - queuePeriod time
  ///6 - fastQueuePeriod time, 7 - gameChangerPeriod time, 8 - gracePeriod	time
  it("Should be initialized with default parameters", async () => {
    expect(await gov.votingPeriod()).to.eq(5760);
    expect(await gov.quoromPercentage()).to.eq(30000);
    expect(await gov.proposalPercentage()).to.eq(2500);
    expect(await gov.proposalMaxOperations()).to.eq(10);
    expect(await gov.votingDelay()).to.eq(1);
    expect(await gov.queuePeriod()).to.eq(60 * 60 * 24 * 2);
    expect(await gov.fastQueuePeriod()).to.eq(60 * 60 * 3);
    expect(await gov.gameChangerPeriod()).to.eq(60 * 60 * 24);
    expect(await gov.gracePeriod()).to.eq(60 * 60 * 24 * 3);
  });

  it("Should report correct proposalThreshold and quorom based on percentages", async () => {
    expect(
      await gov.proposalThreshold(await gov.provider.getBlockNumber())
    ).to.eq(BN.from(1500000).mul(2500).div(1e6));

    expect(await gov.quorumVotes()).to.eq(BN.from(1500000).mul(30000).div(1e6));
  });

  it("Should be able to change params by avatar", async () => {
    let encoded = gov.interface.encodeFunctionData("setVotingParameters", [
      [1, 20000, 2000, 4, 5, 6, 7, 8, 9]
    ]);
    await genericCall(gov.address, encoded);
    expect(await gov.votingPeriod()).to.eq(1);
    expect(await gov.quoromPercentage()).to.eq(20000);
    expect(await gov.proposalPercentage()).to.eq(2000);
    expect(await gov.proposalMaxOperations()).to.eq(4);
    expect(await gov.votingDelay()).to.eq(5);
    expect(await gov.queuePeriod()).to.eq(6);
    expect(await gov.fastQueuePeriod()).to.eq(7);
    expect(await gov.gameChangerPeriod()).to.eq(8);
    expect(await gov.gracePeriod()).to.eq(9);

    encoded = gov.interface.encodeFunctionData("setVotingParameters", [
      [
        5760,
        30000,
        2500,
        10,
        1,
        60 * 60 * 24 * 2,
        60 * 60 * 3,
        60 * 60 * 24,
        60 * 60 * 24 * 3
      ]
    ]);
    await genericCall(gov.address, encoded);
  });

  it("Should not change params with value 0 by avatar", async () => {
    const encoded = gov.interface.encodeFunctionData("setVotingParameters", [
      [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ]);
    await genericCall(gov.address, encoded);
    expect(await gov.votingPeriod()).to.eq(5760);
    expect(await gov.proposalPercentage()).to.eq(2500);
    expect(await gov.quoromPercentage()).to.eq(30000);
    expect(await gov.proposalMaxOperations()).to.eq(10);
    expect(await gov.votingDelay()).to.eq(1);
    expect(await gov.queuePeriod()).to.eq(60 * 60 * 24 * 2);
    expect(await gov.fastQueuePeriod()).to.eq(60 * 60 * 3);
    expect(await gov.gameChangerPeriod()).to.eq(60 * 60 * 24);
    expect(await gov.gracePeriod()).to.eq(60 * 60 * 24 * 3);
  });

  it("Should not be able to change params if not avatar", async () => {
    await expect(
      gov.setVotingParameters([0, 0, 0, 0, 0, 0, 0, 0, 0])
    ).to.revertedWith(/only avatar/);
  });

  it("Should be able to propose parameters changes", async () => {
    let targets = [gov.address];
    let values = ["0"];
    let signatures = ["setVotingParameters(uint256[9])"];
    let callDatas = [
      encodeParameters(["uint256[9]"], [[1, 20000, 2000, 4, 5, 6, 7, 8, 9]])
    ];

    await gov["propose(address[],uint256[],string[],bytes[],string)"](
      targets,
      values,
      signatures,
      callDatas,
      "change params"
    );
    let proposalBlock = +(await ethers.provider.getBlockNumber());
    let proposalId = await gov.latestProposalIds(root.address);
    await advanceBlocks(1);
    await gov.castVote(proposalId, true);
    await increaseTime(queuePeriod);
    expect(states[await gov.state(proposalId)]).to.equal("Succeeded");
    await gov.execute(proposalId);
    expect(states[await gov.state(proposalId)]).to.equal("Executed");

    expect(await gov.votingPeriod()).to.eq(1);
    expect(await gov.quoromPercentage()).to.eq(20000);
    expect(await gov.proposalPercentage()).to.eq(2000);
    expect(await gov.proposalMaxOperations()).to.eq(4);
    expect(await gov.votingDelay()).to.eq(5);
    expect(await gov.queuePeriod()).to.eq(6);
    expect(await gov.fastQueuePeriod()).to.eq(7);
    expect(await gov.gameChangerPeriod()).to.eq(8);
    expect(await gov.gracePeriod()).to.eq(9);

    const encoded = gov.interface.encodeFunctionData("setVotingParameters", [
      [
        5760,
        30000,
        2500,
        10,
        1,
        60 * 60 * 24 * 2,
        60 * 60 * 3,
        60 * 60 * 24,
        60 * 60 * 24 * 3
      ]
    ]);
    await genericCall(gov.address, encoded);
  });

  it("Should have genericCall Permission", async () => {
    let targets = [grep.address];
    let values = ["0"];
    let signatures = ["mint(address,uint256)"];
    let callDatas = [
      encodeParameters(
        ["address", "uint256"],
        [acct.address, ethers.BigNumber.from("500000")]
      )
    ];

    await gov["propose(address[],uint256[],string[],bytes[],string)"](
      targets,
      values,
      signatures,
      callDatas,
      "mint rep"
    );
    let proposalBlock = +(await ethers.provider.getBlockNumber());
    let proposalId = await gov.latestProposalIds(root.address);
    await advanceBlocks(1);
    await gov.castVote(proposalId, true);
    await increaseTime(queuePeriod);
    expect(states[await gov.state(proposalId)]).to.equal("Succeeded");
    await gov.execute(proposalId);
    expect(states[await gov.state(proposalId)]).to.equal("Executed");

    //acct should now have 1M after proposal minted rep
    expect(await grep.balanceOfLocal(acct.address)).to.equal(
      ethers.BigNumber.from("1000000")
    );
  });

  it("Should use value passed to execute", async () => {
    const mock = await (
      await ethers.getContractFactory("PayableMock")
    ).deploy();

    let wallet = ethers.Wallet.createRandom();
    let targets = [mock.address];
    let values = [ethers.utils.parseEther("10")];
    let signatures = ["rec()"];
    let callDatas = ["0x00"];

    await gov["propose(address[],uint256[],string[],bytes[],string)"](
      targets,
      values,
      signatures,
      callDatas,
      "send eth"
    );
    let proposalBlock = +(await ethers.provider.getBlockNumber());
    let proposalId = await gov.latestProposalIds(root.address);
    await advanceBlocks(1);
    await gov.castVote(proposalId, true);
    await increaseTime(queuePeriod);
    expect(states[await gov.state(proposalId)]).to.equal("Succeeded");
    await gov.execute(proposalId, { value: ethers.utils.parseEther("10") });
    expect(states[await gov.state(proposalId)]).to.equal("Executed");

    //acct should now have 1M after proposal minted rep
    const balance = await ethers.provider.getBalance(mock.address);
    const avatarBalance = await ethers.provider.getBalance(avatar);

    expect(avatarBalance).to.eq(0);
    expect(balance).to.eq(ethers.utils.parseEther("10"));
  });

  it("should be able to call Controller permissioned methods", async () => {
    let wallet = ethers.Wallet.createRandom();
    let u = await hre.artifacts.readArtifact("Controller");
    let c = new ethers.Contract(Controller, u.abi, root);
    expect(await c.isSchemeRegistered(gov.address, avatar)).to.eq(true);

    let targets = [Controller];
    let values = ["0"];
    let signatures = ["unregisterSelf(address)"];
    let callDatas = [encodeParameters(["address"], [avatar])];

    await gov["propose(address[],uint256[],string[],bytes[],string)"](
      targets,
      values,
      signatures,
      callDatas,
      "send eth"
    );
    let proposalBlock = +(await ethers.provider.getBlockNumber());
    let proposalId = await gov.latestProposalIds(root.address);
    await advanceBlocks(1);
    await gov.castVote(proposalId, true);
    await increaseTime(queuePeriod);

    const tx = await (await gov.execute(proposalId)).wait();
    expect(states[await gov.state(proposalId)]).to.equal("Executed");
    expect(await c.isSchemeRegistered(gov.address, avatar)).to.eq(false);
  });

  it("should be able to update reputation", async () => {
    const originalRep = await gov.rep();
    const repToSet = root.address;
    await setAddress("REPUTATION", root.address);
    await gov.updateRep();
    const updatedRep = await gov.rep();
    expect(updatedRep).to.not.eq(originalRep);
    expect(updatedRep).to.eq(repToSet);
    await setAddress("REPUTATION", originalRep);
    await gov.updateRep();
  });
});
