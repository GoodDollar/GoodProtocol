/**
 * this version is for testing purposes only, to test greputation initial rootstate with the fixed merkle v2
 * which uses sorted pairs so no position is required and it uses double hash for preimage attack
 * future blockchain state hashes should be recalculated and created using similar method done here
 */
import { get, range, chunk, flatten, mergeWith, sortBy, uniq } from "lodash";
import fs from "fs";
import { MerkleTree } from "merkletreejs";
import PromisePool from "async-promise-pool";
import { ethers as Ethers } from "hardhat";
import { BigNumber } from "ethers";
import fetch from "node-fetch";

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);

  let sum = BigNumber.from(0);
  for (let i = 0; i < base; i++) sum = sum.add(sorted[i]);

  return sum;
};

export const airdrop = (ethers: typeof Ethers) => {
  const fuseProvider = new ethers.providers.JsonRpcProvider(
    "https://rpc.fuse.io"
  );

  const zxfastProvider = new ethers.providers.JsonRpcProvider(
    "https://eth-eu.0xfast.com/rpc/free"
  );

  const cfProvider = new ethers.providers.InfuraProvider(
    1,
    "143f9cf968fe4c3da0db77ff525e0da4"
  );
  const goodActiveVotes = async (network = "fuse") => {
    let balances = [];

    const EPOCH = 60 * 60 * 24;
    const pool = new PromisePool({ concurrency: 30 });
    const epochs = range(1646844945, (Date.now() / 1000).toFixed(0), EPOCH);
    const graphName = network === "fuse" ? "gooddollarfuse2" : "goodsubgraphs";
    const graphUrl = `https://api.thegraph.com/subgraphs/name/gooddollar/${graphName}`;

    const graphQuery = async (start, skip, step = EPOCH) => {
      const query = `{
          goodBalances(first: 1000 skip:${skip} where: { memberSince_gte: ${start} memberSince_lt:${
        start + step
      } }) {
            id
            coreBalance
            totalVotes
            activeVotes
            blockchainsBalance
          }
        }`;
      try {
        const { data = {}, errors } = await fetch(graphUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ query })
        }).then(_ => _.json());
        errors && console.log({ errors });
        if (
          errors?.[0]?.message ===
          "The `skip` argument must be between 0 and 5000, but is 6000"
        ) {
          throw new Error("skip");
        }
        if (data?.goodBalances?.length === 1000) {
          return data.goodBalances.concat(
            await graphQuery(start, skip + 1000, step)
          );
        }
        return data.goodBalances || [];
      } catch (error) {
        if (error.message === "skip") throw error;
        console.log({ query, error });
        return [];
      }
    };

    const poolAdd = (start, step) => {
      pool.add(async () => {
        try {
          const goodBalances = await graphQuery(start, 0, step);
          balances = balances.concat(goodBalances);
          console.log({ curDate: start, step, records: goodBalances.length });
        } catch (e) {
          if (e.message === "skip") {
            const newstep = Number((step / 4).toFixed(0));
            console.log("creating sub epochs", {
              start,
              end: start + step,
              newstep
            });

            const subepochs = range(start, start + step, newstep);
            subepochs.forEach(e => poolAdd(e, newstep));
          }
        }
      });
    };
    epochs.forEach(e => {
      poolAdd(e, EPOCH);
    });

    await pool.all();
    console.log(`total ${network} GOOD Holders:`, balances.length, {
      uniques: uniq(balances.map(_ => _.id)).length,
      delegatees: uniq(
        balances
          .filter(_ => Number(_.coreBalance) < Number(_.totalVotes))
          .map(_ => _.id)
      ).length,
      sample: balances.slice(0, 5)
    });

    const treeData = {};

    console.log("calculating leaves hashes...");
    balances.forEach(record => {
      treeData[record.id] = {
        address: record.id,
        rep: record.activeVotes,
        hash: ethers.utils.keccak256(
          ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
              ["address", "uint256"],
              [record.id, record.activeVotes]
            )
          )
        )
      };
    });
    fs.writeFileSync(
      `goodCheckpoints/goodCheckpoint_${network}.json`,
      JSON.stringify({ treeData, balances, until: Date.now() })
    );
    console.log(
      balances.filter(_ => Number(_.coreBalance) < Number(_.totalVotes))
    );
  };

  const collectAirdropData = async () => {
    const calcGoodMints = async () => {
      const step = 10000;
      const START_BLOCK = 14344739;

      const LAST_BLOCK = await good.provider.getBlockNumber();
      console.log({ LAST_BLOCK });
      const blocks = range(START_BLOCK, LAST_BLOCK, step);
      const allLogs = [];
      for (let blockChunk of chunk(blocks, 10)) {
        // Get the filter (the second null could be omitted)
        const ps = blockChunk.map(async (bc: number) => {
          const logs = await good
            .queryFilter(
              good.filters.Mint(),
              bc,
              Math.min(bc + step - 1, LAST_BLOCK)
            )
            .catch(e => {
              console.log("block transfer logs failed retrying...", bc);
              return good.queryFilter(
                good.filters.Mint(),
                bc,
                Math.min(bc + step - 1, LAST_BLOCK)
              );
            });
          const claimedLogs = await good
            .queryFilter(
              good.filters.StateHashProof(),
              bc,
              Math.min(bc + step - 1, LAST_BLOCK)
            )
            .catch(e => {
              console.log("block transfer logs failed retrying...", bc);
              return good.queryFilter(
                good.filters.StateHashProof(),
                bc,
                Math.min(bc + step - 1, LAST_BLOCK)
              );
            });
          console.log("found logs:", claimedLogs.length, logs.length, bc);
          return logs.concat(claimedLogs);
        });
        let chunkLogs = flatten(await Promise.all(ps));
        console.log("chunk logs: ", chunkLogs.length, { blockChunk });
        allLogs.push(chunkLogs);
      }
      const logs = flatten(allLogs);

      const mints = {};
      const claims = {};
      const result = {};
      console.log("logs found:", logs.length);
      let totalMints = ethers.constants.Zero;
      logs.forEach(l => {
        if (l.event === "Mint") {
          mints[l.args._to.toLowerCase()] = (
            mints[l.args._to.toLowerCase()] || BigNumber.from("0")
          ).add(l.args._amount);
          totalMints = totalMints.add(l.args._amount);
        } else claims[l.args.user.toLowerCase()] = l.args.repBalance.toString();
      });
      Object.entries(mints).forEach(
        ([k, v]) =>
          (result[k] = { claim: "0", ...result[k], mint: v.toString() })
      );
      Object.entries(claims).forEach(
        ([k, v]) =>
          (result[k] = { mint: "0", ...result[k], claim: v.toString() })
      );
      console.log({ result, totalMints: totalMints.toString() });
      fs.writeFileSync("goodCheckpointMainnet.json", JSON.stringify(result));
    };

    // await goodActiveVotes();
    await goodActiveVotes("mainnet");
    // await calcGoodMints();
  };

  const buildMerkleTree = async () => {
    const buildTree = async (network = "fuse") => {
      const good = await ethers
        .getContractAt(
          "GReputation",
          "0x603B8C0F110E037b51A381CBCacAbb8d6c6E4543"
        )
        .then(_ => _.connect(network === "fuse" ? fuseProvider : cfProvider));

      const checkpoint = JSON.parse(
        fs
          .readFileSync(`goodCheckpoints/goodCheckpoint_${network}.json`)
          .toString()
      );

      const treeData = checkpoint.treeData;

      let toTree: Array<[string, BigNumber]> = Object.entries(treeData).map(
        ([k, v]) => {
          return [k, BigNumber.from((v as any).rep)];
        }
      );

      toTree = toTree.sort((a, b) => (a[1].gte(b[1]) ? 1 : -1)).reverse();
      //     console.log({ toTree });
      //     const topContracts = toTree.filter(_ => _[2] === true);
      const totalReputation = toTree.reduce(
        (c, a) => c.add(a[1]),
        BigNumber.from(0)
      );
      const totalSupply = (await good.totalSupply()).toString();
      console.log({
        totalSupply,
        totalReputation: totalReputation.toString(),
        numberOfAccounts: toTree.length
      });

      const sorted = toTree.map(_ => _[1]);
      console.log(toTree.slice(0, 10).map(_ => [_[0], _[1]]));
      //     fs.writeFileSync(`${folder}/reptree.json`, JSON.stringify(toTree));
      console.log("Reputation Distribution");
      [0.001, 0.01, 0.1, 0.5].forEach(q => {
        const quantileRep = quantile(sorted, q);
        console.log({
          precentile: q * 100 + "%",
          addresses: (sorted.length * q).toFixed(0),
          quantileRep,
          rep:
            Number(quantileRep.div(1e10).toString()) /
            Number(totalReputation.div(1e10).toString())
        });
      });
      const items = Object.values(treeData);
      const elements = items.map((e: any) => e.hash);
      console.log("creating merkletree sorted...", elements.length);
      //NOTICE: we use a non sorted merkletree to save generation time, this requires also a different proof verification algorithm which
      //is not in the default openzeppelin library
      const merkleTree = new MerkleTree(elements, ethers.utils.keccak256, {
        sortPairs: true
      });

      // get the merkle root
      // returns 32 byte buffer
      const merkleRoot = merkleTree.getHexRoot();
      console.log("Merkle Root:", merkleRoot);

      // generate merkle proof
      // returns array of 32 byte buffers
      const proof = merkleTree.getHexProof(elements[0]);
      const validProof = merkleTree.verify(proof, elements[0], merkleRoot);

      const lastProof = merkleTree.getHexProof(elements[elements.length - 1]);
      const lastValidProof = merkleTree.verify(
        lastProof,
        elements[elements.length - 1],
        merkleRoot
      );

      //check for possible address preimage
      const danger = (merkleTree.getHexLayers() as any).map(_ =>
        _.find(_ => _.startsWith("0x000000"))
      );

      console.log({
        danger,
        merkleRoot,
        proof,
        validProof,
        lastProof,
        lastValidProof,
        proofFor: items[0],
        lastProofFor: items[items.length - 1],
        index: elements.length,
        leaf: elements[elements.length - 1].toString("hex")
      });

      checkpoint.merkleRoot = merkleRoot;
      checkpoint.totalSupply = totalSupply;
      fs.writeFileSync(
        "goodCheckpoints/goodCheckpoint_fuse.json",
        JSON.stringify(checkpoint)
      );
    };

    await buildTree();
    await buildTree("mainnet");
  };

  const getProof = addr => {
    const { treeData, merkleRoot } = JSON.parse(
      fs.readFileSync("airdrop/airdrop.json").toString()
    );

    let entries = Object.entries(treeData as Tree);
    let elements = entries.map(e => Buffer.from(e[1].hash.slice(2), "hex"));

    console.log("creating merkletree sorted pairs...", elements.length);
    const merkleTree = new MerkleTree(elements, ethers.utils.keccak256, {
      sortPairs: true
    });

    const calcMerkleRoot = merkleTree.getHexRoot();
    console.log("merkleroots:", {
      fromFile: merkleRoot,
      calculated: calcMerkleRoot
    });

    const addrData = treeData[addr] || treeData[addr.toLowerCase()];
    const proofFor = Buffer.from(addrData.hash.slice(2), "hex");

    const proof = merkleTree.getHexProof(proofFor);
    const proofIndex =
      elements.findIndex(_ => "0x" + _.toString("hex") === addrData.hash) + 1;

    console.log({ proofIndex, proof, [addr]: addrData });
    console.log(
      "checkProof:",
      merkleTree.verify(proof, proofFor, calcMerkleRoot)
    );
  };

  return { buildMerkleTree, collectAirdropData, getProof };
};

const _timer = async (name, promise) => {
  const start = Date.now();
  const res = await promise;
  const milis = Date.now() - start;
  console.log(`done task ${name} in ${milis / 1000} seconds`);
  return res;
};
