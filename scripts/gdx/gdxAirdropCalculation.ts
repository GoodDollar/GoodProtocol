import { get, range, chunk, flatten, mergeWith, sortBy } from "lodash";
import fs from "fs";
import MerkleTree from "merkle-tree-solidity";
import stakingContracts from "@gooddollar/goodcontracts/stakingModel/releases/deployment.json";
import fetch from "node-fetch";
import { string } from "hardhat/internal/core/params/argumentTypes";

type Tree = {
  [key: string]: {
    hash: string;
    gdx: number;
  };
};

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);

  let sum = 0;
  for (let i = 0; i < base; i++) sum += sorted[i];

  return sum;
};

export const airdrop = ethers => {
  const getBuyingAddresses = async (addresses = {}, isContracts = {}) => {
    const provider = new ethers.providers.InfuraProvider();

    let reserve = await ethers.getContractAt(
      "GoodReserveCDai",
      stakingContracts["production-mainnet"].Reserve
    );
    reserve = reserve.connect(provider);
    const step = 100000;
    const latestBlock = await provider.getBlockNumber();
    // const blocks = range(startBlock, endBlock, step);
    const blocks = range(6000000, latestBlock, step);
    const filter = reserve.filters.TokenPurchased();
    console.log({ latestBlock });
    for (let blockChunk of chunk(blocks, 10)) {
      // Get the filter (the second null could be omitted)
      const ps = blockChunk.map(async bc => {
        // Query the filter (the latest could be omitted)
        const logs = await reserve
          .queryFilter(filter, bc, Math.min(bc + step - 1, latestBlock))
          .catch(e => {
            console.log("block transfer logs failed retrying...", bc);
            return reserve.queryFilter(
              filter,
              bc,
              Math.min(bc + step - 1, latestBlock)
            );
          });

        console.log("found transfer logs in block:", { bc }, logs.length);
        // Print out all the values:
        const ps = logs.map(async log => {
          let isContract =
            (await reserve.provider
              .getCode(log.args.caller)
              .catch(e => "0x")) !== "0x";
          let balance = addresses[log.args.caller] || 0;
          addresses[log.args.caller] =
            balance + log.args.actualReturn.toNumber();
          isContracts[log.args.caller] = isContract;
        });
        await Promise.all(ps);
      });
      await Promise.all(ps);
    }

    return { addresses, isContracts: isContracts };
  };

  const collectAirdropData = async () => {
    return getBuyingAddresses().then(r =>
      fs.writeFileSync("buyBalances.json", JSON.stringify(r))
    );
  };

  const buildMerkleTree = () => {
    const { addresses, isContracts } = JSON.parse(
      fs.readFileSync("buyBalances.json").toString()
      // fs.readFileSync("test/gdx_airdrop_test.json").toString()
    );
    let toTree: Array<[string, number]> = Object.entries(addresses).map(
      ([addr, gdx]) => {
        return [addr, gdx as number];
      }
    );

    toTree = sortBy(toTree, "1").reverse();

    console.log({
      isContracts,
      toTree,
      numberOfAccounts: toTree.length
    });

    const sorted = toTree.map(_ => _[1]);
    console.log("GDX Distribution\n");
    [0.001, 0.01, 0.1, 0.5].forEach(q =>
      console.log({
        precentile: q * 100 + "%",
        gdx: quantile(sorted, q)
      })
    );

    const treeData = {};
    const elements = toTree.map(e => {
      const hash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256"],
          [e[0], e[1]]
        )
      );
      treeData[e[0]] = {
        gdx: e[1],
        hash
      };
      return Buffer.from(hash.slice(2), "hex");
    });

    console.log(elements);
    const merkleTree = new MerkleTree(elements, false);
    // get the merkle root
    // returns 32 byte buffer
    const merkleRoot = merkleTree.getRoot().toString("hex");
    // generate merkle proof
    // returns array of 32 byte buffers
    const proof = merkleTree.getProof(elements[0]).map(_ => _.toString("hex"));
    console.log({ merkleRoot, proof, sampleProofFor: toTree[0] });
    fs.writeFileSync(
      "gdxairdrop.json",
      JSON.stringify({ treeData, merkleRoot })
    );
  };

  const getProof = addr => {
    const { treeData, merkleRoot } = JSON.parse(
      fs.readFileSync("gdxairdrop.json").toString()
    );

    const elements = Object.entries(treeData as Tree).map(e =>
      Buffer.from(e[1].hash.slice(2), "hex")
    );

    const merkleTree = new MerkleTree(elements, true);
    const proof = merkleTree
      .getProof(Buffer.from(treeData[addr].hash.slice(2), "hex"))
      .map(_ => "0x" + _.toString("hex"));
    console.log({ proof, [addr]: treeData[addr] });
  };

  return { buildMerkleTree, collectAirdropData, getProof };
};
