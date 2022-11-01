// import { GReputationInstance } from "../types/GReputation";
import MerkleTree, { checkProofOrdered } from "merkle-tree-solidity";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber, Signer } from "ethers";
import { sign } from "crypto";
import { expect } from "chai";
import { GReputation } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { advanceBlocks, createDAO, increaseTime } from "../helpers";
import { TextDecoder } from "util";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;

type BlockChainState = {
  stateHash: string;
  hashType: BigNumber;
  totalSupply: BigNumber;
  blockNumber: BigNumber;
};

export const getMerkleAndProof = async (data, proofIdx) => {
  const elements = data.map(e =>
    Buffer.from(
      ethers.utils
        .keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "uint256"],
            [e[0], e[1]]
          )
        )
        .slice(2),
      "hex"
    )
  );

  //this will give repOwner minter permissions
  await setDAOAddress("GDAO_CLAIMERS", repOwner);

  const merkleTree = new MerkleTree(elements, true);

  // get the merkle root
  // returns 32 byte buffer
  const merkleRoot = merkleTree.getRoot();

  // generate merkle proof
  // returns array of 32 byte buffers
  const proof = merkleTree.getProof(elements[proofIdx]);
  const isValid = checkProofOrdered(
    proof,
    merkleRoot,
    elements[proofIdx],
    proofIdx + 1
  );
  return { merkleRoot, proof, isValid, index: proofIdx + 1 };
};

let grep: GReputation, grepWithOwner: GReputation, identity, gd, bounty;
let signers: SignerWithAddress[],
  founder,
  repOwner,
  rep1,
  rep2,
  rep3,
  repTarget,
  delegator,
  setDAOAddress,
  avatar;

const fuseHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("fuse"));
describe("GReputation", () => {
  let merkleRoot: any, proof: any;
  let avatarGenericCall;

  before(async () => {
    let {
      reputation,
      setDAOAddress: sda,
      avatar: av,
      genericCall
    } = await loadFixture(createDAO);

    setDAOAddress = sda;
    avatar = av;
    avatarGenericCall = genericCall;

    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;

    signers = await ethers.getSigners();
    [founder, repOwner, rep1, rep2, rep3, repTarget] = signers.map(
      _ => _.address
    );
    delegator = ethers.Wallet.createRandom().connect(ethers.provider);

    grepWithOwner = await grep.connect(ethers.provider.getSigner(repOwner));
    // create merkle tree
    // expects unique 32 byte buffers as inputs (no hex strings)
    // if using web3.sha3, convert first -> Buffer(web3.sha3('a'), 'hex')
    const merkleData = await getMerkleAndProof(
      [
        [rep1, 1],
        [rep2, 2],
        [repTarget, 1],
        [rep3, 1]
      ],
      0
    );

    // get the merkle root
    // returns 32 byte buffer
    merkleRoot = merkleData.merkleRoot;

    // generate merkle proof
    // returns array of 32 byte buffers
    proof = merkleData.proof;
  });

  it("should have avatar as role manager", async () => {
    expect(await grep.hasRole(await grep.DEFAULT_ADMIN_ROLE(), avatar)).to.be
      .true;
  });

  it("should have name, symbol and decimals", async () => {
    expect(await grep.name()).to.equal("GoodDAO");
    expect(await grep.symbol()).to.equal("GOOD");
    expect(await grep.decimals()).to.equal(18);
  });

  it("should get balanceOf", async () => {
    const repBalance = await grep.balanceOfLocal(founder);
    expect(repBalance.toNumber()).to.be.equal(0);
  });

  it("should not be able to mint or burn if not minter", async () => {
    await expect(grep.connect(signers[4]).mint(founder, 2)).to.revertedWith(
      "GReputation: need minter role or be GDAO contract"
    );
    await expect(grep.connect(signers[4]).burn(founder, 2)).to.revertedWith(
      "GReputation: need minter role or be GDAO contract"
    );
  });

  describe("rootState", async () => {
    it("should set rootState", async () => {
      let encodedCall = grep.interface.encodeFunctionData(
        "setBlockchainStateHash",
        ["rootState", "0x" + merkleRoot.toString("hex"), 100]
      );

      await avatarGenericCall(grep.address, encodedCall);
      const rootState = await grep.blockchainStates(await grep.ROOT_STATE(), 0);
      expect(rootState[0]).to.be.equal("0x" + merkleRoot.toString("hex"));
    });
    it("rootState should not change totalsupply until proof", async () => {
      expect(await grep.totalSupply()).to.equal(100);
    });

    it("should update core balances and not change totalsupply after proof of rootState", async () => {
      await grep.proveBalanceOfAtBlockchain("rootState", rep1, 1, proof, 1);

      //root states changes the core balance
      const newRep = await grep.balanceOfLocal(rep1);
      expect(newRep.toNumber()).to.be.equal(1);

      const newVotes = await grep.getVotes(rep1);
      expect(newVotes.toNumber()).to.be.equal(1);
      expect(await grep.totalSupply()).to.equal(100); //total supply shouldnt change by proof
    });
    it("should not set rootState again", async () => {
      await setDAOAddress("GDAO_CLAIMERS", repOwner);
      await grepWithOwner["mint(address,uint256)"](
        founder,
        ethers.utils.parseEther("1")
      );
      let encodedCall = grep.interface.encodeFunctionData(
        "setBlockchainStateHash",
        ["rootState", "0x" + merkleRoot.toString("hex"), 100]
      );

      const tx = await (
        await avatarGenericCall(grep.address, encodedCall)
      ).wait();
      await grepWithOwner["burn(address,uint256)"](
        founder,
        ethers.utils.parseEther("1")
      );
    });

    it("should reject invalid merkle proof", async () => {
      const e = await grep
        .proveBalanceOfAtBlockchain("rootState", rep3, 10, proof, 1)
        .catch(e => e);
      expect(e.message).to.match(/invalid merkle proof/);
    });
  });

  describe("delegation", async () => {
    it("should allow delegation", async () => {
      expect(await grep.balanceOfLocal(rep3)).to.be.eq(BN.from(0));
      await grep.connect(signers[2]).delegateTo(rep3); //rep1 -> rep3

      expect(await grep.getVotes(rep3)).to.be.eq(
        await grep.balanceOfLocal(rep1)
      ); //with delegation
      expect(
        await grep.getVotes(rep1),
        "delegator should now have 0 votes"
      ).to.be.eq(BN.from(0));
      expect(await grep.delegateOf(rep1)).to.be.eq(rep3);
    });

    it("should allow multiple delegates", async () => {
      const { merkleRoot, proof } = await getMerkleAndProof(
        [
          [rep1, 1],
          [rep2, 2],
          [repTarget, 1],
          [rep3, 1]
        ],
        1
      );
      await grep.proveBalanceOfAtBlockchain("rootState", rep2, 2, proof, 2);
      await grep.connect(signers[3]).delegateTo(rep3); //rep2 -> rep3

      //verify delegators list has been updated
      expect(await grep.delegateOf(rep1)).to.be.eq(rep3);
      expect(await grep.delegateOf(rep2)).to.be.eq(rep3);

      //verify delegate balance is updated
      expect(await grep.getVotes(rep3)).to.be.eq(
        BN.from(3) //rep1 + rep2
      );

      //verify delegators dont have any votes
      expect(await grep.getVotes(rep1)).to.be.eq(BN.from(0));
      expect(await grep.getVotes(rep2)).to.be.eq(BN.from(0));
    });

    it("should allow to change delegate", async () => {
      expect(await grep.balanceOfLocal(rep1)).to.be.eq(BN.from(1)); //proof was submitted
      await grep.connect(signers[3]).delegateTo(rep1); //rep2 -> rep1
      expect(await grep.getVotes(rep3)).to.be.eq(BN.from(1)); //previous delegate should now be 1 bcause it has only rep1
      expect(await grep.getVotes(rep1)).to.be.eq(
        BN.from(2) //rep2
      );

      expect(await grep.delegates(rep2)).to.be.eq(rep1);
      expect(await grep.delegates(rep1)).to.be.eq(rep3);
    });

    it("should allow undelegation", async () => {
      await grep.connect(signers[2]).undelegate(); //rep1 -> remove delegattion to rep3
      expect(await grep.balanceOfLocal(rep3)).to.be.eq(BN.from(0));
      expect(await grep.getVotes(rep3)).to.be.eq(BN.from(0));
      expect(await grep.getVotes(rep1)).to.be.eq(BN.from(3)); //rep2 delegating to rep1 + rep1 votes
      expect(await grep.balanceOfLocal(rep1)).to.be.eq(BN.from(1));

      expect(await grep.delegates(rep1)).to.be.eq(rep1);
    });

    it("should update delegate votes after mint to delegate", async () => {
      const delegateOf = await grep.delegates(rep2);
      const prevVotes = await grep.getVotes(delegateOf);
      await grepWithOwner.mint(rep2, 10);
      expect(await grep.getVotes(delegateOf)).to.be.eq(prevVotes.add(10));

      expect(await grep.delegates(rep1)).to.be.eq(rep1);
    });
  });

  describe("delegateBySig", () => {
    const Domain = async gov => ({
      name: await grep.name(),
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: grep.address
    });
    const Types = {
      Delegation: [
        { name: "delegate", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" }
      ]
    };

    it("reverts if the signatory is invalid", async () => {
      const delegate = founder,
        nonce = 0,
        expiry = 0;
      await expect(
        grep.delegateBySig(
          delegate,
          nonce,
          expiry,
          0,
          ethers.utils.hexZeroPad("0xbadd", 32),
          ethers.utils.hexZeroPad("0xbadd", 32)
        )
      ).to.revertedWith("GReputation::delegateBySig: invalid signature");
    });

    it("It should not be delegate when delegation address is null", async () => {
      let tx = await grep["delegateTo(address)"](NULL_ADDRESS).catch(e => e);
      expect(tx.message).to.have.string(
        "GReputation::delegate can't delegate to null address"
      );
    });

    it("It should not be able to delegate votes if they are already delagating", async () => {
      await grepWithOwner["mint(address,uint256)"](
        founder,
        ethers.utils.parseEther("1")
      );
      await grep.delegateTo(rep1);
      const tx = await grep.delegateTo(rep1).catch(e => e);
      expect(tx.message).to.have.string("already delegating to delegator");
      await grepWithOwner["burn(address,uint256)"](
        founder,
        ethers.utils.parseEther("1")
      );
    });
    it("reverts if the nonce is bad ", async () => {
      const delegate = founder,
        nonce = 1,
        expiry = 0;

      const signature = await delegator._signTypedData(
        await Domain(grep),
        Types,
        {
          delegate,
          nonce,
          expiry
        }
      );

      const sig = ethers.utils.splitSignature(signature);
      await expect(
        grep.delegateBySig(delegate, nonce, expiry, sig.v, sig.r, sig.s)
      ).to.revertedWith("GReputation::delegateBySig: invalid nonce");
    });

    it("reverts if the signature has expired", async () => {
      const delegate = founder,
        nonce = 0,
        expiry = 0;
      const signature = await delegator._signTypedData(
        await Domain(grep),
        Types,
        {
          delegate,
          nonce,
          expiry
        }
      );

      const sig = ethers.utils.splitSignature(signature);
      await expect(
        grep.delegateBySig(delegate, nonce, expiry, sig.v, sig.r, sig.s)
      ).to.revertedWith("GReputation::delegateBySig: signature expired");
    });

    describe("delegates on behalf of the signatory", () => {
      let txForGas;
      it("should delegate using signature", async () => {
        const delegate = founder,
          nonce = 0,
          expiry = 10e9;
        const signature = await delegator._signTypedData(
          await Domain(grep),
          Types,
          {
            delegate,
            nonce,
            expiry
          }
        );

        const sig = ethers.utils.splitSignature(signature);
        expect(await grep.delegates(delegator.address)).to.equal(
          ethers.constants.AddressZero
        );
        txForGas = await (
          await grep.delegateBySig(delegate, nonce, expiry, sig.v, sig.r, sig.s)
        ).wait();
        expect(await grep.delegates(delegator.address)).to.equal(founder);
      });

      it("should delegate with X gas [@skip-on-coverage]", async () => {
        expect(txForGas.gasUsed).to.lt(130000);
      });
    });
  });

  describe("setting a blockchain merkle hash", async () => {
    it("should set new merkle hash", async () => {
      const { merkleRoot, proof } = await getMerkleAndProof(
        [
          [rep1, 100],
          [rep2, 200],
          [repTarget, 1],
          [rep3, 1]
        ],
        1
      );

      let encodedCall = grep.interface.encodeFunctionData(
        "setBlockchainStateHash",
        ["fuse", "0x" + merkleRoot.toString("hex"), 200]
      );

      const totalSupply = await grep.totalSupply();
      await expect(avatarGenericCall(grep.address, encodedCall)).to.not.be
        .reverted;
      const totalAfterSupply = await grep.totalSupply();
      expect(totalAfterSupply).to.eq(totalSupply.add(200));
    });

    it("should modify only local totalSupply on burn mint", async () => {
      const totalSupply = await grep.totalSupply();
      await grepWithOwner["mint(address,uint256)"](founder, 155);
      const totalSupplyAfter = await grep.totalSupply();
      expect(totalSupplyAfter).to.eq(totalSupply.add(155));
    });

    it("should not reset core balance", async () => {
      //before proving new rep in new root balance should be 0
      const newRep = await grep.balanceOfLocal(rep1);
      expect(newRep.toNumber()).to.be.gt(0);
      const newRep2 = await grep.balanceOfLocal(rep2);
      expect(newRep2.toNumber()).to.be.gt(0);
    });

    it("should prove balance in new state", async () => {
      const prevRep = await grep.balanceOfLocal(rep2);
      const prevVotes = await grep.getVotes(rep2);
      const { proof } = await getMerkleAndProof(
        [
          [rep1, 100],
          [rep2, 200],
          [repTarget, 1],
          [rep3, 1]
        ],
        1
      );

      await grep.proveBalanceOfAtBlockchain("fuse", rep2, 200, proof, 2);
      const newRep = await grep.balanceOfLocal(rep2);
      expect(newRep).to.be.equal(prevRep); //core rep should not change
      const newVotes = await grep.getVotes(rep2);

      expect(newVotes).to.be.equal(prevVotes.add(200));
    });

    it("should keep active votes (local balance) correctly after mint/burn", async () => {
      await grep.connect(signers[3]).undelegate();
      const totalSupply = await grep.getCurrentVotes(rep2);
      const tx = await grepWithOwner["mint(address,uint256)"](rep2, 155);
      const result = await tx.wait();
      const totalSupplyAfter = await grep.getVotes(rep2);
      expect(totalSupplyAfter).to.eq(totalSupply.add(155));
    });

    it("should only delegate core balance and not new state balance", async () => {
      expect(await grep.getVotes(rep3)).to.be.eq(BN.from(0));
      await grep.connect(signers[3]).delegateTo(rep3); //rep2=signers[3]
      expect(await grep.getVotes(rep3)).to.be.eq(
        await grep.balanceOfLocal(rep2)
      );
      expect(await grep.getVotes(rep3)).to.be.lt(await grep.getVotes(rep2));
    });

    it("should not effect delegate balance after new state hash", async () => {
      const prevDelegated = await grep.getVotes(rep3);
      const { merkleRoot, proof } = await getMerkleAndProof(
        [
          [rep1, 100],
          [rep2, 200],
          [rep3, 10],
          [repTarget, 1]
        ],
        1
      );

      let encodedCall = grep.interface.encodeFunctionData(
        "setBlockchainStateHash",
        ["fuse", "0x" + merkleRoot.toString("hex"), 200]
      );

      await expect(avatarGenericCall(grep.address, encodedCall)).to.not.be
        .reverted;

      expect(await grep.getVotes(rep3)).to.be.eq(prevDelegated);
    });

    it("should not effect delegate balance after new blockchain proof", async () => {
      const prevVotes = await grep.getVotes(rep3);
      const { merkleRoot, proof } = await getMerkleAndProof(
        [
          [rep1, 100],
          [rep2, 200],
          [rep3, 10],
          [repTarget, 1]
        ],
        1
      );
      await grep.proveBalanceOfAtBlockchain("fuse", rep2, 200, proof, 2);
      expect(await grep.getVotes(rep3)).to.be.eq(prevVotes); //be equal to rep2
    });

    it("should include own rep in votes balance after new state", async () => {
      const prevVotes = await grep.getVotes(rep3);
      const { merkleRoot, proof } = await getMerkleAndProof(
        [
          [rep1, 100],
          [rep2, 200],
          [rep3, 10],
          [repTarget, 1]
        ],
        2
      );
      await grep.proveBalanceOfAtBlockchain("fuse", rep3, 10, proof, 3);
      expect(await grep.getVotes(rep3)).to.be.eq(prevVotes.add(10)); //add new blockchain rep
    });

    it("should report blockchain balance after proof of new state", async () => {
      //before proving new rep in new root balance should be 0
      const newRep = await grep.getVotesAtBlockchain(
        fuseHash,
        rep1,
        ethers.constants.MaxUint256
      );
      expect(newRep.toNumber()).to.be.equal(0); //not prooved

      const newRep2 = await grep.getVotesAtBlockchain(
        fuseHash,
        rep2,
        ethers.constants.MaxUint256
      );
      expect(newRep2.toNumber()).to.be.equal(200);

      const newRep3 = await grep.getVotesAtBlockchain(
        fuseHash,
        rep3,
        ethers.constants.MaxUint256
      );
      expect(newRep3.toNumber()).to.be.equal(10);
    });

    describe("overriding with a new state hash", async () => {
      it("should set a new state hash", async () => {
        await expect(
          grep.setBlockchainStateHash("fuse", fuseHash, BN.from("100"))
        ).to.be.revertedWith("only avatar can call this method");

        let encodedCall = grep.interface.encodeFunctionData(
          "setBlockchainStateHash",
          ["fuse", fuseHash, 100]
        );

        expect(await avatarGenericCall(grep.address, encodedCall)).to.not.throw;

        const first = await grep.activeBlockchains(0);
        const state: BlockChainState = (await grep.blockchainStates(
          fuseHash,
          2 //third state of fuse
        )) as unknown as BlockChainState;
        expect(first).to.be.equal(fuseHash);
        expect(state.stateHash).to.be.equal(fuseHash);
        expect(state.totalSupply.toNumber()).to.be.equal(100);
        expect(state.blockNumber.toNumber()).to.be.greaterThan(0);
      });
      it("should reset blockchain balance to 0 before proof of new state", async () => {
        //before proving new rep in new root balance should be 0
        const newRep = await grep.getVotesAtBlockchain(
          fuseHash,
          rep1,
          ethers.constants.MaxUint256
        );
        expect(newRep.toNumber()).to.be.equal(0);
        const newRep2 = await grep.getVotesAtBlockchain(
          fuseHash,
          rep2,
          ethers.constants.MaxUint256
        );
        expect(newRep2.toNumber()).to.be.equal(0);
      });

      it("should return previous state when state.blockNumber > _blockNumber", async () => {
        const blockNumber = await ethers.provider.getBlockNumber();
        const newRep2 = await grep.getVotesAtBlockchain(
          fuseHash,
          rep2,
          blockNumber - 4
        );

        expect(newRep2.toNumber()).to.be.equal(200); // returns previous state
      });
      it("should return another state's total supply when states[uint256(i)].blockNumber > _blockNumber in totalSupplyAtBlockchain", async () => {
        const blockNumber = await ethers.provider.getBlockNumber();
        const newRep2 = await grep.totalSupplyAtBlockchain(
          fuseHash,
          blockNumber - 4
        );
      });
    });
  });

  describe("real example of airdrop", async () => {
    let startSupply = ethers.constants.Zero;
    before(async () => {
      startSupply = await grep.totalSupply();
    });
    it("should set a new state hash", async () => {
      let encodedCall = grep.interface.encodeFunctionData(
        "setBlockchainStateHash",
        [
          "realState",
          "0x2c6122d5343ba909417d15ad20cc796c11fb8d25a16b2280d1c9f338dee228f2",
          ethers.utils.parseEther("96000000")
        ]
      );

      expect(await avatarGenericCall(grep.address, encodedCall)).to.not.throw;
      expect(await grep.totalSupply()).to.eq(
        startSupply.add(ethers.utils.parseEther("96000000"))
      );
    });

    it("should prove real proof", async () => {
      const prevVotes = await grep.getVotes(
        "0xf79b804bae955ae4cd8e8b0331c4bc437104804f"
      );
      const proof = [
        "0x9b8e7febcbd180034badae99ecbab673459fb0c0737b9cad212c3937f56e4585",
        "0xd10d8ef972acbc30a43739c4701a2b6e4c519ce346a62df26bec7b5997445627",
        "0xbd5dd5fed6f798a47ea020b57132471b5d46a2b65d0acbd4e230a072c3e3a55c",
        "0x9f23c9cf88be7e52235387e276e29b7d6c51534e9d59c2a65a21952fd88900c7",
        "0xfdfe22fe05bce861932bfa4578051c71f2e7b54db33234e5272b4301438a8d8f",
        "0x5656593fc2eb9bcd304ec0447e592997a99ebecdc2659f220ff635baa285ecfa",
        "0xaec1054c23f27e94d187f812e1f4dd5edf7f6e718a8cb2f626b1d8c36d11b0c7",
        "0x092d517b71b26e46666b7495f585a85edba242fc5b1ae3fa92270d1c2a902456",
        "0x0b4cb632876d934c4a6765fd5d1feea130cf157789c21963d44b1efcc2978c21",
        "0x723c9e86aa78f12110fe81d12df83e78dd7615522e26fb970e2a5d3f4274132f",
        "0x0bb4f0a903802cc0c3bb7462c2511faff05f8c10d702944d36554319049489ab",
        "0x67b4b760b618e92a01f28e6e642d97edc815eae9aedc5e2d379d27846807ac9f",
        "0x532d257a230e24572128456bf10346e4a44c85f86f6adff6bc869557f76dc004",
        "0x095fcd1d64eaf81d5b94e14bbe890495b45e9cbf6fb0207c11e5e7b235994622",
        "0x831b4cbc31413fc036cb47497ebb3131c1fe68a1643b9b4dd574bc917db0dc93",
        "0xc3c5c42fce820bc86269c682690932873e9fb69129e6184ce4896dbd7de91e96",
        "0x1b6439ad44cfdfcf0238bd6bec094b4da9767432dd026ec7936a7bb2901d3428",
        "0x6c8e26b04a1bdd3eb15e76dd4de8b3b097759bcf1a2e568b4847a4ef9a70602e"
      ];
      const rep = ethers.utils.parseEther("21492275.377107453");
      await grep.proveBalanceOfAtBlockchain(
        "realState",
        "0xf79b804bae955ae4cd8e8b0331c4bc437104804f",
        rep,
        proof,
        1
      );
      expect(
        await grep.getVotes("0xf79b804bae955ae4cd8e8b0331c4bc437104804f")
      ).to.be.eq(prevVotes.add(rep)); //add new blockchain rep
      expect(await grep.totalSupply()).to.eq(
        startSupply.add(ethers.utils.parseEther("96000000"))
      );
    });

    it("should prove real proof of last index", async () => {
      const prevVotes = await grep.getVotes(
        "0x68b064891efb77b87fe1e872205e795f75a72a6d"
      );
      const proof = [
        "0xb23becc094bb77b57b02efa3223a97c5c2f179e419ad1cd197bdf716ba35e2ab",
        "0x64c2f7c557e1388282802a530489b6328e04300c5d97df9e90150bde1dbcecff",
        "0xfc72b1c90592c448f908aea27bf3b6ad2bbb0264686c0c4cb780f784dfd661e1",
        "0x28cb29a5f16d4ad5e1690a7b78a8b139a200120558e33c4157477c715a448ae4",
        "0x635293d19ad0cad71df6bfa1e214b52866ef5f1953f97d6d013704e23c8a3abf",
        "0x6176e5fed3f84225bb522cd6d3af0ff39515cd6c2f8fa088dd64e1eb5554cad9",
        "0x4dd623274305ba776ebbff19fcd5942bff2c823413d54a456fd5defe52bc505d",
        "0xbee9e989bf2cc76791c93ac8783e249b382f41ac283d01fcf3aca8434697db83",
        "0x7bd84a4af41fd85d87106def7f3504262f12963c2be51344f49a0dc8da0b370d",
        "0xa3a60333331cd727f58058926a64de5031600482e6f59804dd3dd7a3a36c104a",
        "0x1445a9ef548502e693fc9561c082d53258c00b4f6e475e835c4397ce72e9283d",
        "0x3b602cb425eefe45feb2c9944e094c8f7cb3cc28336948e976b7999f4d805c9f",
        "0x46e9fa8d0157acbd5891643c3d16ddc9dcb67cbd0c5cd0cd289b01c6e2fd93fc"
      ];
      const rep = 139216138927630;
      await grep.proveBalanceOfAtBlockchain(
        "realState",
        "0x68b064891efb77b87fe1e872205e795f75a72a6d",
        rep,
        proof,
        238576
      );
      expect(
        await grep.getVotes("0x68b064891efb77b87fe1e872205e795f75a72a6d")
      ).to.be.eq(prevVotes.add(rep)); //add new blockchain rep
      expect(await grep.totalSupply()).to.eq(
        startSupply.add(ethers.utils.parseEther("96000000"))
      );
    });

    it("it should be able get votes at the specific block", async () => {
      const rep = ethers.utils.parseEther("21492275.377107453");

      let currentBlock = await ethers.provider.getBlockNumber();
      let votes = await grep["getVotesAt(address,uint256)"](
        "0xf79b804bae955ae4cd8e8b0331c4bc437104804f",
        currentBlock
      );
      expect(votes).to.be.equal(rep);
    });

    it("it should be able to get totalSupply for particular block", async () => {
      let currentSupply = await grep["totalSupply()"]();
      let localSupply = await grep.totalSupplyLocalAt(
        await ethers.provider.getBlockNumber()
      );
      await grepWithOwner["mint(address,uint256)"](
        founder,
        ethers.utils.parseEther("1")
      );
      let currentBlock = await ethers.provider.getBlockNumber();
      let totalSupply = await grep.totalSupplyAt(currentBlock);
      expect(await grep.totalSupplyLocalAt(currentBlock)).to.equal(
        localSupply.add(ethers.utils.parseEther("1"))
      );
      expect(
        totalSupply
          .sub(currentSupply)
          .sub(ethers.utils.parseEther("1"))
          .toString()
      ).to.be.equal("0");
      await grepWithOwner["burn(address,uint256)"](
        founder,
        ethers.utils.parseEther("1")
      );
    });

    it("it should be able to get totalSupplyLocal for particular block", async () => {
      let currentBlock = await ethers.provider.getBlockNumber();
      const totalSupplyLocalBefore = await grep["totalSupplyLocal(uint256)"](
        currentBlock
      );
      await grepWithOwner["mint(address,uint256)"](
        founder,
        ethers.utils.parseEther("1")
      );
      currentBlock = await ethers.provider.getBlockNumber();
      const totalSupplyLocalAfter = await grep["totalSupplyLocal(uint256)"](
        currentBlock
      );
      expect(totalSupplyLocalAfter).to.equal(
        totalSupplyLocalBefore.add(ethers.utils.parseEther("1"))
      );

      await grepWithOwner["burn(address,uint256)"](
        founder,
        ethers.utils.parseEther("1")
      );
    });

    it("it should return 0 when particular blockchain state is empty", async () => {
      let state = await grep["getVotesAtBlockchain(bytes32,address,uint256)"](
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("notExist")),
        "0xe28f701A8a94E18220A5d800Bb06ae20e8eDd6c8",
        "300"
      );
      expect(state.toString()).to.be.equal("0");
    });

    it("It should not be able to get total supply when particular blockchain state is empty", async () => {
      let state = await grep["totalSupplyAtBlockchain(bytes32,uint256)"](
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("notExist")),
        "300"
      );
      expect(state.toString()).to.be.equal("0");
    });

    it("it should prove balance of blockchain for particular chain only once", async () => {
      const proof = [
        "0x9b8e7febcbd180034badae99ecbab673459fb0c0737b9cad212c3937f56e4585",
        "0xd10d8ef972acbc30a43739c4701a2b6e4c519ce346a62df26bec7b5997445627",
        "0xbd5dd5fed6f798a47ea020b57132471b5d46a2b65d0acbd4e230a072c3e3a55c",
        "0x9f23c9cf88be7e52235387e276e29b7d6c51534e9d59c2a65a21952fd88900c7",
        "0xfdfe22fe05bce861932bfa4578051c71f2e7b54db33234e5272b4301438a8d8f",
        "0x5656593fc2eb9bcd304ec0447e592997a99ebecdc2659f220ff635baa285ecfa",
        "0xaec1054c23f27e94d187f812e1f4dd5edf7f6e718a8cb2f626b1d8c36d11b0c7",
        "0x092d517b71b26e46666b7495f585a85edba242fc5b1ae3fa92270d1c2a902456",
        "0x0b4cb632876d934c4a6765fd5d1feea130cf157789c21963d44b1efcc2978c21",
        "0x723c9e86aa78f12110fe81d12df83e78dd7615522e26fb970e2a5d3f4274132f",
        "0x0bb4f0a903802cc0c3bb7462c2511faff05f8c10d702944d36554319049489ab",
        "0x67b4b760b618e92a01f28e6e642d97edc815eae9aedc5e2d379d27846807ac9f",
        "0x532d257a230e24572128456bf10346e4a44c85f86f6adff6bc869557f76dc004",
        "0x095fcd1d64eaf81d5b94e14bbe890495b45e9cbf6fb0207c11e5e7b235994622",
        "0x831b4cbc31413fc036cb47497ebb3131c1fe68a1643b9b4dd574bc917db0dc93",
        "0xc3c5c42fce820bc86269c682690932873e9fb69129e6184ce4896dbd7de91e96",
        "0x1b6439ad44cfdfcf0238bd6bec094b4da9767432dd026ec7936a7bb2901d3428",
        "0x6c8e26b04a1bdd3eb15e76dd4de8b3b097759bcf1a2e568b4847a4ef9a70602e"
      ];
      const rep = ethers.utils.parseEther("21492275.377107453");

      const tx = await grep
        .proveBalanceOfAtBlockchain(
          "realState",
          "0xf79b804bae955ae4cd8e8b0331c4bc437104804f",
          rep,
          proof,
          1
        )
        .catch(e => e);
      expect(tx.message).to.have.string("stateHash already proved");
    });

    it("It should not prove balance of blockchain if particular chain does not exist", async () => {
      const proof = [
        "0x6429597531910c38ed2ac8f73a890245ef7f67db49e1a947049fe8d987b0ee09",
        "0x2225a8a896fbfc6d8b9d15574ff43d6025a1e811b790df431b84e08dc3287ce4",
        "0xa83c67b8ca77de2b6cd01571d03d21a61df664f8128c805b1b27c202862ac5f8",
        "0xb11cfc679f76ed949270ef345f8268571b9ed317f25970332a0e0fb3a4feaea8",
        "0xb93eefff7353452bcb68e1af11b94ac4aa0f59e3dc6770027a7f9ac3a8d55d87",
        "0xed638b497e00aec652c528d142de5f261238cf99395c93472820bcd8b55ef5bb",
        "0xfa3ef97384d7e03d0980873fd18ec3ae7f57d266f4d6495e631257c5b5c11081",
        "0x66cbd6385735911728866e1208db6ca94698c6ef726dd06334e80d81cf0e59e4",
        "0xf6c5fbaf4bd80f598dae62ca88af460bbdc618739959c1f0a00a8ecabe2be51d",
        "0x9fba3d9d96b8c268d322548cc41b1c9bb37b8bf7108184fc33784b3f089f45dc",
        "0x0582b0084b238128163879a707f336e6932ce8ddcfe1fdfce9dbc37ab7c430a5",
        "0x278db5f9072c404b1d8d9baba030c171943a4a5cdc51e8c9b21fee01f2fe32bd",
        "0xe3d136bf3ea1fbed0055294cd43a0fd4b52d6388ecb524627a88b73db57a3429",
        "0x2c8245c2d4c0e4ac0ae22754005d62d994aabe2bdb05f46cfe3ac63a4bf72a32"
      ];
      let tx = await grep
        .proveBalanceOfAtBlockchain(
          "notExist",
          "0xe28f701A8a94E18220A5d800Bb06ae20e8eDd6c8",
          1199,
          proof,
          1
        )
        .catch(e => e);
      expect(tx.message).to.have.string("no state found for given _id");
    });
  });

  describe("reputation recipient", () => {
    it("user should be able to set recipient", async () => {
      await grep.connect(signers[4]).setReputationRecipient(repTarget);
      expect(await grep.reputationRecipients(rep3)).to.equal(repTarget);
      await grepWithOwner.mint(rep3, 111);
      expect(await grep.balanceOfLocal(repTarget)).to.equal(111);
    });

    it("user should be able to unset recipient", async () => {
      const startBalance = await grep.balanceOfLocal(rep3);
      await grep
        .connect(signers[4])
        .setReputationRecipient(ethers.constants.AddressZero);
      expect(await grep.reputationRecipients(rep3)).to.equal(
        ethers.constants.AddressZero
      );
      await grepWithOwner.mint(rep3, 111);
      expect(await grep.balanceOfLocal(repTarget)).to.equal(111);
      expect(await grep.balanceOfLocal(rep3)).to.equal(startBalance.add(111));
    });

    it("should get accurate prior votes", async () => {
      await grep.connect(signers[3]).undelegate();
      const selectedBlock = await ethers.provider.getBlockNumber();
      const selectedBlockVotes = await grep.getCurrentVotes(rep2);
      await advanceBlocks(1);
      await (await grepWithOwner["mint(address,uint256)"](rep2, 1)).wait();
      await advanceBlocks(1);
      const priorSelectedBlockVotes = await grep.getPriorVotes(
        rep2,
        selectedBlock
      );
      const votesAfterAdvancing = await grep.getCurrentVotes(rep2);
      expect(priorSelectedBlockVotes).to.eq(selectedBlockVotes);
      expect(priorSelectedBlockVotes).to.be.not.eq(votesAfterAdvancing);
    });
  });
});
