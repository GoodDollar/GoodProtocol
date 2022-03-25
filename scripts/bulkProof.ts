import fs from "fs";
import { chunk } from "lodash";
import { ethers, upgrades, network } from "hardhat";
import { networkNames } from "@openzeppelin/upgrades-core";
import GReputationABI from "../artifacts/contracts/governance/GReputation.sol/GReputation.json";
import BulkProofABI from "../artifacts/contracts/utils/BulkProof.sol/BulkProof.json";

import MerkleTree, {
  checkProof,
  checkProofOrdered
} from "merkle-tree-solidity";
import { BigNumber } from "ethers";

console.log({
  networkNames,
  network: network.name,
  upgrade: process.env.UPGRADE
});
const { name: networkName } = network;
networkNames[1] = networkName;
networkNames[122] = networkName;
networkNames[3] = networkName;

export const bulkProof = async () => {
  console.log("signer", await ethers.getSigners());
  const fuseProvider = new ethers.providers.JsonRpcProvider(
    "https://rpc.fuse.io"
  );

  const fuseGDProvider = new ethers.providers.JsonRpcProvider(
    "https://gooddollar-rpc.fuse.io"
  );

  const goodFuse = new ethers.Contract(
    "0x3A9299BE789ac3730e4E4c49d6d2Ad1b8BC34DFf",
    GReputationABI.abi,
    fuseGDProvider
  );

  const START_BLOCK_FUSE = 14149729;

  const LAST_BLOCK = await goodFuse.provider.getBlockNumber();

  const claimedLogs = await goodFuse.queryFilter(
    goodFuse.filters.StateHashProof(),
    START_BLOCK_FUSE,
    LAST_BLOCK
  );
  console.log("found logs:", claimedLogs.length);
  console.log(claimedLogs.filter(_ => !_.args?.user));

  const addrs = claimedLogs.map(_ => _.args?.user);

  const { treeData, merkleRoot } = JSON.parse(
    fs.readFileSync("airdrop/airdrop.json").toString()
  );

  let entries = Object.entries(treeData);

  let elements = entries.map((e: any) =>
    Buffer.from(e[1].hash.slice(2), "hex")
  );

  console.log("creating merkletree...", elements.length);
  const merkleTree = new MerkleTree(elements, true);

  const calcMerkleRoot = merkleTree.getRoot().toString("hex");
  console.log("merkleroots:", {
    fromFile: merkleRoot,
    calculated: calcMerkleRoot
  });

  const proofs = addrs => {
    return addrs.map(addr => {
      if (!addr) {
        console.log("missing", addr);
        return;
      }
      const addrData = treeData[addr] || treeData[addr.toLowerCase()];
      const proofFor = Buffer.from(addrData.hash.slice(2), "hex");

      const proof = merkleTree.getProof(proofFor);
      const proofIndex =
        entries.findIndex((_: any) => _[1].hash === addrData.hash) + 1;

      // console.log(
      //   "checkProof:",
      //   checkProofOrdered(proof, merkleTree.getRoot(), proofFor, proofIndex)
      // );

      const hexProof = proof.map(_ => "0x" + _.toString("hex"));
      // console.log({
      //   proofIndex,
      //   rep: BigNumber.from(addrData.rep).toString(),
      //   //   hexProof,
      //   addr
      // });

      return {
        index: proofIndex,
        balance: BigNumber.from(addrData.rep).toString(),
        proof: hexProof,
        account: addr
      };
    });
  };

  const bulkProofContract = await ethers.getContractAt(
    "BulkProof",
    "0x8449bb7BDa431F76c21bcCDEce2794D8aD24D8a8"
  );
  for (let addrChunk of chunk(addrs, 50)) {
    console.log("calling bulk proof");
    const proofsChunk = proofs(addrChunk);
    await (
      await bulkProofContract.bulkProof(proofsChunk, { gasLimit: 10000000 })
    ).wait();
  }
};

export const bulkProofGDX = async () => {
  const signers = await ethers.getSigners();
  console.log("signer", await ethers.getSigners());
  //   const signer = signers[0].connect(new ethers.providers.InfuraProvider());
  const reserve = await ethers.getContractAt(
    "GoodReserveCDai",
    "0xa150a825d425B36329D8294eeF8bD0fE68f8F6E0"
  );

  const { treeData, merkleRoot } = JSON.parse(
    fs.readFileSync("airdrop/gdxAirdropRecovery.json").toString()
  );

  let entries = Object.entries(treeData);

  let elements = entries.map((e: any) =>
    Buffer.from(e[1].hash.slice(2), "hex")
  );

  let addrs = Object.keys(treeData);

  console.log("creating merkletree...", elements.length, addrs);
  const merkleTree = new MerkleTree(elements, false);

  const calcMerkleRoot = merkleTree.getRoot().toString("hex");
  console.log("merkleroots:", {
    fromFile: merkleRoot,
    calculated: calcMerkleRoot
  });

  const proofs = addrs => {
    return addrs.map(addr => {
      if (!addr) {
        console.log("missing", addr);
        return;
      }
      const addrData = treeData[addr] || treeData[addr.toLowerCase()];
      const proofFor = Buffer.from(addrData.hash.slice(2), "hex");

      const proof = merkleTree.getProof(proofFor);

      // console.log(
      //   "checkProof:",
      //   checkProofOrdered(proof, merkleTree.getRoot(), proofFor, proofIndex)
      // );

      const hexProof = proof.map(_ => "0x" + _.toString("hex"));
      // console.log({
      //   proofIndex,
      //   rep: BigNumber.from(addrData.rep).toString(),
      //   //   hexProof,
      //   addr
      // });

      return {
        balance: BigNumber.from(addrData.gdx).toString(),
        proof: hexProof,
        account: addr
      };
    });
  };

  const bulkProofContract = await ethers.getContractAt(
    "BulkProof",
    "0xDB8563287ecF1484228951804eC6bf241f884099"
  );
  for (let addrChunk of chunk(addrs, 60)) {
    const proofsChunk = proofs(addrChunk);
    console.log("calling bulk proof");
    const tx = await bulkProofContract.callStatic.bulkProof(proofsChunk, {
      gasLimit: 5000000,
      maxPriorityFeePerGas: 1000000000,
      maxFeePerGas: 40000000000
    });
    console.log(tx);
    await (
      await bulkProofContract.bulkProof(proofsChunk, {
        gasLimit: 5000000,
        maxPriorityFeePerGas: 1000000000,
        maxFeePerGas: 40000000000
      })
    ).wait();
  }
};

// bulkProof().catch(console.log);
bulkProofGDX().catch(console.log);
