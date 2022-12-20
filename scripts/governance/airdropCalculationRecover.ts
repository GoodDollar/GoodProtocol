import { get, range, chunk, flatten, mergeWith, sortBy, uniq } from "lodash";
import fs from "fs";
import MerkleTree, {
  checkProof,
  checkProofOrdered
} from "merkle-tree-solidity";
import coreContracts from "@gooddollar/goodcontracts/releases/deployment.json";
import stakingContracts from "@gooddollar/goodcontracts/stakingModel/releases/deployment.json";
import upgradablesContracts from "@gooddollar/goodcontracts/upgradables/releases/deployment.json";
import { ethers as Ethers } from "hardhat";
import { BigNumber } from "ethers";
type Balances = {
  [key: string]: {
    isNotContract: boolean;
    balance: number;
    claims: number;
    stake: number;
    gdRepShare: number;
    claimRepShare: number;
    stakeRepShare: number;
  };
};

type Tree = {
  [key: string]: {
    hash: string;
    rep: number;
  };
};
const DefaultBalance = {
  balance: 0,
  claims: 0,
  gdRepShare: 0,
  claimRepShare: 0,
  stake: 0,
  stakeRepShare: 0,
  isNotContract: true
};
const otherContracts = [
  "0x8d441C2Ff54C015A1BE22ad88e5D42EFBEC6C7EF", //fuseswap
  "0x0bf36731724f0baceb0748a9e71cd4883b69c533", //fuseswap usdc
  "0x17b09b22823f00bb9b8ee2d4632e332cadc29458", //old bridge
  "0xd5d11ee582c8931f336fbcd135e98cee4db8ccb0", //new bridge
  "0xa56A281cD8BA5C083Af121193B2AaCCaAAC9850a", //mainnet uniswap
  "0x66c0f5449ba4ff4fba0b05716705a4176bbdb848", //defender automation
  "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11" //"uniswap DAI"
];

const systemContracts = {};
const allContracts = flatten(
  [coreContracts, stakingContracts, upgradablesContracts].map(_ =>
    Object.values(_).map(_ => Object.values(_))
  )
);
flatten(
  [].concat(
    ...[otherContracts, allContracts]
      .map(Object.values)
      .map(arr => arr.map(x => (typeof x === "object" ? Object.values(x) : x)))
  )
)
  .filter(x => typeof x === "string" && x.startsWith("0x"))
  .map(addr => (systemContracts[addr.toLowerCase()] = true));

const isSystemContract = addr => systemContracts[addr.toLowerCase()] === true;

const updateBalance = (balance, update) => {
  return Object.assign({}, DefaultBalance, balance, update);
};

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);

  let sum = 0;
  for (let i = 0; i < base; i++) sum += sorted[i];

  return sum;
};

export const airdrop = (
  ethers: typeof Ethers,
  ethplorer_key,
  etherscan_key
) => {
  const fusePoktProvider = new ethers.providers.JsonRpcProvider({
    url: "https://fuse-mainnet.gateway.pokt.network/v1/lb/60ee374fc6318362996a1fb0",
    user: "",
    password: "d57939c260bdf0a6f22550e2350b4312" //end point will be removed, so its ok to keep clear text password
  });

  const fuseProvider = new ethers.providers.JsonRpcProvider(
    "https://rpc.fuse.io"
  );

  const fuseGDProvider = new ethers.providers.JsonRpcProvider(
    "https://gooddollar-rpc.fuse.io"
  );
  const fuseArchiveProvider = new ethers.providers.JsonRpcBatchProvider(
    "https://explorer-node.fuse.io/"
  );

  const poktArchiveProvider = new ethers.providers.JsonRpcProvider({
    url: "https://eth-trace.gateway.pokt.network/v1/lb/6130bad2dc57c50036551041",
    user: "",
    password: "15439e4f4aeceb469b6b38e319f4f2a5" //end point will be removed, so its ok to keep clear text password
  });

  console.log({ systemContracts });

  const LAST_BLOCK_ETH = 14296865;
  const LAST_BLOCK_FUSE = 14296865;
  const START_BLOCK_FUSE = 14149729;
  const START_BLOCK_ETH = 13683492;

  const collectAirdropData = async () => {
    const goodMainnet = await ethers
      .getContractAt(
        "GReputation",
        "0x3A9299BE789ac3730e4E4c49d6d2Ad1b8BC34DFf"
      )
      .then(_ => _.connect(new ethers.providers.InfuraProvider()));

    const goodFuse = await ethers
      .getContractAt(
        "GReputation",
        "0x3A9299BE789ac3730e4E4c49d6d2Ad1b8BC34DFf"
      )
      .then(_ => _.connect(fuseGDProvider));

    console.log({
      LAST_BLOCK_ETH,
      LAST_BLOCK_FUSE
    });
    const calcGoodMints = async (runForFuse = true) => {
      const step = 10000;
      const START_BLOCK = runForFuse ? START_BLOCK_FUSE : START_BLOCK_ETH;

      const good = runForFuse ? goodFuse : goodMainnet;
      const LAST_BLOCK = await good.provider.getBlockNumber();
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

      const balances: { [key: string]: BigNumber } = {};
      const result = [];
      if (runForFuse) {
        logs.forEach(l => {
          if (l.event === "Mint")
            balances[l.args._to.toLowerCase()] = (
              balances[l.args._to.toLowerCase()] || BigNumber.from("0")
            ).add(l.args._amount);
          else
            balances[l.args.user.toLowerCase()] = (
              balances[l.args.user.toLowerCase()] || BigNumber.from("0")
            ).sub(l.args.repBalance);
        });
        Object.entries(balances).forEach(
          ([k, v]) => {
            if (v.gt(0)) result.push([k, v.toString()]);
          }
          // console.log(k, v.toString())
        );
        console.log(
          "total balances found:",
          Object.entries(balances).length,
          "to update balances:",
          result.length
        );
        fs.writeFileSync("airdrop/repRecoverFuse.json", JSON.stringify(result));
      } else {
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
          } else
            claims[l.args.user.toLowerCase()] = l.args.repBalance.toString();
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
        fs.writeFileSync(
          "airdrop/repRecoverMainnet.json",
          JSON.stringify(result)
        );
      }
    };

    await Promise.all([calcGoodMints(), calcGoodMints(false)]);
  };

  const buildMerkleTree = () => {
    const { treeData } = JSON.parse(
      fs.readFileSync("airdrop/airdrop.first.json").toString()
    );
    const fuseMints = JSON.parse(
      fs.readFileSync("airdrop/repRecoverFuse.json").toString()
    );

    const mainnetMints = JSON.parse(
      fs.readFileSync("airdrop/repRecoverMainnet.json").toString()
    );

    fuseMints.forEach(([addr, v]) => {
      const rep = BigNumber.from(v);
      const repInWei = BigNumber.from(
        treeData[addr.toLowerCase()]?.rep || "0"
      ).add(rep);
      const hash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256"],
          [addr, repInWei.toString()]
        )
      );
      treeData[addr.toLowerCase()] = {
        ...treeData[addr.toLowerCase()],
        rep: repInWei,
        hash
      };
    });

    const ethRestore = Object.entries(mainnetMints).map(
      ([k, v]: [string, any]) => {
        return [
          k.toLowerCase(),
          BigNumber.from(treeData[k.toLowerCase()]?.rep || "0").toString(),
          v.mint
        ];
      }
    );
    fs.writeFileSync(
      "airdrop/ethAirdropRecover.json",
      JSON.stringify({
        accounts: ethRestore.map(_ => _[0]),
        stateValue: ethRestore.map(_ => _[1]),
        mintValue: ethRestore.map(_ => _[2])
      })
    );
    let toTree: Array<[string, BigNumber]> = Object.entries(treeData).map(
      ([k, v]) => {
        return [k, BigNumber.from((v as any).rep)];
      }
    );
    toTree = toTree.sort((a, b) => (a[1].gte(b[1]) ? 1 : -1));
    //     console.log({ toTree });
    //     const topContracts = toTree.filter(_ => _[2] === true);
    const totalReputationAirdrop = toTree
      .reduce((c, a) => c.add(a[1]), BigNumber.from(0))
      .toString();
    console.log({
      totalReputationAirdrop,
      numberOfAccounts: toTree.length
    });
    // const sorted = toTree.map(_ => _[1]);
    console.log(toTree.slice(0, 100).map(_ => [_[0], _[1].toString()]));
    //     fs.writeFileSync(`${folder}/reptree.json`, JSON.stringify(toTree));
    // console.log("Reputation Distribution");
    // [0.001, 0.01, 0.1, 0.5].forEach(q =>
    //   console.log({
    //     precentile: q * 100 + "%",
    //     addresses: (sorted.length * q).toFixed(0),
    //     rep:
    //       quantile(sorted, q) /
    //       (CLAIMER_REP_ALLOCATION +
    //         HOLDER_REP_ALLOCATION +
    //         STAKER_REP_ALLOCATION)
    //   })
    // );
    const elements = Object.values(treeData).map((e: any) =>
      Buffer.from(e.hash.slice(2), "hex")
    );
    console.log("creating merkletree...", elements.length);
    //NOTICE: we use a non sorted merkletree to save generation time, this requires also a different proof verification algorithm which
    //is not in the default openzeppelin library
    const merkleTree = new MerkleTree(elements, true);
    // get the merkle root
    // returns 32 byte buffer
    const merkleRoot = merkleTree.getRoot().toString("hex");
    // generate merkle proof
    // returns array of 32 byte buffers
    const proof = merkleTree.getProof(elements[0]).map(_ => _.toString("hex"));
    const validProof = checkProofOrdered(
      proof.map(_ => Buffer.from(_, "hex")),
      merkleTree.getRoot(),
      elements[0],
      1
    );
    const lastProof = merkleTree
      .getProof(elements[elements.length - 1])
      .map(_ => _.toString("hex"));
    const lastValidProof = checkProofOrdered(
      lastProof.map(_ => Buffer.from(_, "hex")),
      merkleTree.getRoot(),
      elements[elements.length - 1],
      elements.length
    );
    console.log({
      merkleRoot,
      proof,
      validProof,
      lastProof,
      lastValidProof,
      proofFor: toTree[0],
      lastProofFor: toTree[toTree.length - 1]
    });
    fs.writeFileSync(
      `airdrop/airdrop.json`,
      JSON.stringify({
        treeData,
        merkleRoot
      })
    );
  };

  const getProof = addr => {
    const { treeData, merkleRoot } = JSON.parse(
      fs.readFileSync("airdrop/airdrop.json").toString()
    );

    let entries = Object.entries(treeData as Tree);
    let elements = entries.map(e => Buffer.from(e[1].hash.slice(2), "hex"));

    console.log("creating merkletree...", elements.length);
    const merkleTree = new MerkleTree(elements, true);

    const calcMerkleRoot = merkleTree.getRoot().toString("hex");
    console.log("merkleroots:", {
      fromFile: merkleRoot,
      calculated: calcMerkleRoot
    });

    const addrData = treeData[addr] || treeData[addr.toLowerCase()];
    const proofFor = Buffer.from(addrData.hash.slice(2), "hex");

    const proof = merkleTree.getProof(proofFor);
    const proofIndex = entries.findIndex(_ => _[1].hash === addrData.hash) + 1;

    console.log(
      "checkProof:",
      checkProofOrdered(proof, merkleTree.getRoot(), proofFor, proofIndex)
    );
    const hexProof = proof.map(_ => "0x" + _.toString("hex"));
    console.log({ proofIndex, proof: hexProof, [addr]: addrData });
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
