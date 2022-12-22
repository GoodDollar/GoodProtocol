import { get, range, chunk, flatten, mergeWith, sortBy } from "lodash";
import fs from "fs";
import MerkleTree from "merkle-tree-solidity";
import stakingContracts from "@gooddollar/goodcontracts/stakingModel/releases/deployment.json";
import { ethers as Ethers } from "hardhat";
import { BigNumber } from "ethers";

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

const quantileBN = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);

  let sum = BigNumber.from("0");
  for (let i = 0; i < base; i++)
    sum = BigNumber.from(sum).add(BigNumber.from(sorted[i]));

  return sum.toString();
};

let ETH_SNAPSHOT_BLOCK = 13320531; //first blocka after 12pm Sep-29-2021 12:00:20 PM +UTC

export const airdrop = (ethers: typeof Ethers, ethSnapshotBlock) => {
  const getBuyingAddresses = async (addresses = {}, isContracts = {}) => {
    const provider = new ethers.providers.InfuraProvider();

    let reserve = await ethers.getContractAt(
      [
        "event TokenPurchased(address indexed caller,address indexed reserveToken,uint256 reserveAmount,uint256 minReturn,uint256 actualReturn)"
      ],
      stakingContracts["production-mainnet"].Reserve
    );

    let swaphelper = await ethers.getContractAt(
      [
        "event GDTraded(string protocol, string action, address from, uint256 value, uint256[] uniswap, uint256 gd)"
      ],
      "0xe28dbcce95764dc379f45e61d609356010595fd1"
    );

    reserve = reserve.connect(provider);
    swaphelper = swaphelper.connect(provider);

    const step = 100000;
    const snapshotBlock = parseInt(ethSnapshotBlock || ETH_SNAPSHOT_BLOCK);
    // const blocks = range(startBlock, endBlock, step);
    const blocks = range(10575670, snapshotBlock, step);
    const filter = reserve.filters.TokenPurchased();
    const swapFilter = swaphelper.filters.GDTraded();
    console.log({ snapshotBlock });
    for (let blockChunk of chunk(blocks, 10)) {
      // Get the filter (the second null could be omitted)
      const ps = blockChunk.map(async bc => {
        // Query the filter (the latest could be omitted)
        const logs = await reserve
          .queryFilter(filter, bc, Math.min(bc + step - 1, snapshotBlock))
          .catch(e => {
            console.log("block transfer logs failed retrying...", bc);
            return reserve.queryFilter(
              filter,
              bc,
              Math.min(bc + step - 1, snapshotBlock)
            );
          });

        const swapLogs = await swaphelper
          .queryFilter(swapFilter, bc, Math.min(bc + step - 1, snapshotBlock))
          .catch(e => {
            console.log("block swaphelper logs failed retrying...", bc);
            return swaphelper.queryFilter(
              swapFilter,
              bc,
              Math.min(bc + step - 1, snapshotBlock)
            );
          });

        console.log(
          "found transfer logs in block:",
          { bc },
          { reserve: logs.length, swaphelper: swapLogs.length }
        );
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
        const swapps = swapLogs
          .filter(_ => _.args.action == "buy")
          .map(async log => {
            let isContract =
              (await reserve.provider
                .getCode(log.args.caller)
                .catch(e => "0x")) !== "0x";
            let balance = addresses[log.args.from] || 0;
            addresses[log.args.from] = balance + log.args.gd.toNumber();
            isContracts[log.args.from] = isContract;
          });

        await Promise.all([...ps, ...swapps]);
      });
      await Promise.all(ps);
    }

    delete addresses["0xE28dBcCE95764dC379f45e61D609356010595fd1"]; //delete swaphelper
    console.log({ addresses, isContracts });
    return { addresses, isContracts: isContracts };
  };

  const collectAirdropData = async () => {
    return getBuyingAddresses().then(r =>
      fs.writeFileSync("airdrop/buyBalances.json", JSON.stringify(r))
    );
  };

  const buildMerkleTree = () => {
    const { addresses, isContracts } = JSON.parse(
      fs.readFileSync("airdrop/buyBalances.json").toString()
      // fs.readFileSync("test/gdx_airdrop_test.json").toString()
    );
    let toTree: Array<[string, number]> = Object.entries(addresses).map(
      ([addr, gdx]) => {
        return [addr, gdx as number];
      }
    );

    toTree = sortBy(toTree, "1").reverse();
    const totalGDX = toTree.reduce((acc, v) => acc + v[1], 0);
    console.log({
      isContracts,
      toTree,
      numberOfAccounts: toTree.length,
      totalGDX
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
      "airdrop/gdxairdrop.json",
      JSON.stringify({ treeData, merkleRoot })
    );
  };

  const getProof = addr => {
    const { treeData, merkleRoot } = JSON.parse(
      fs.readFileSync("airdrop/gdxairdrop.json").toString()
    );

    const elements = Object.entries(treeData as Tree).map(e =>
      Buffer.from(e[1].hash.slice(2), "hex")
    );

    const merkleTree = new MerkleTree(elements, false);
    const proof = merkleTree
      .getProof(Buffer.from(treeData[addr].hash.slice(2), "hex"))
      .map(_ => "0x" + _.toString("hex"));
    console.log({ proof, [addr]: treeData[addr] });
  };

  return { buildMerkleTree, collectAirdropData, getProof };
};

export const airdropRecover = (ethers: typeof Ethers) => {
  const ZERO = ethers.BigNumber.from("0");

  const getHoldersInformation = async (
    newAddresses = {},
    newIsContracts = {}
  ) => {
    const provider = new ethers.providers.InfuraProvider();

    let newReserve = await ethers.getContractAt(
      "GoodReserveCDai",
      "0x6C35677206ae7FF1bf753877649cF57cC30D1c42"
    );

    let recoveredReserve = await ethers.getContractAt(
      "GoodReserveCDai",
      "0xa150a825d425B36329D8294eeF8bD0fE68f8F6E0"
    );

    // let exchangeHelper = await ethers.getContractAt(
    //   eventsABI,
    //   "0x0a8c6bB832801454F6CC21761D0A293Caa003296"
    // );

    // exchangeHelper = exchangeHelper.connect(provider);
    newReserve = newReserve.connect(provider);

    const step = 100000;
    const START_BLOCK = 13683748; // Reserve was created
    // const END_BLOCK = 14296271; // Following reserve created
    const END_BLOCK = await ethers.provider.getBlockNumber();
    const blocks = range(START_BLOCK, END_BLOCK, step);

    const reserveTokenPurchasedFilter = newReserve.filters.Transfer(
      ethers.constants.AddressZero
    );
    const reserveTokenSoldFilter = newReserve.filters.Transfer(
      undefined,
      ethers.constants.AddressZero
    );

    // const exchangeHelperTokenPurchasedFilter = exchangeHelper.filters.TokenPurchased();
    // const exchangeHelperTokenSoldFilter = exchangeHelper.filters.TokenSold();

    const populateListOfAddressesAndBalances = async (
      contractInstance,
      purchaseFilter,
      soldFilter
    ) => {
      for (let blockChunk of chunk(blocks, 10)) {
        // Get the filter (the second null could be omitted)
        const processedChunks = blockChunk.map(async bc => {
          // Query the filter (the latest could be omitted)
          const purchaseEvents = await contractInstance
            .queryFilter(purchaseFilter, bc, Math.min(bc + step - 1, END_BLOCK))
            .catch(e => {
              console.log("block transfer logs failed retrying...", bc);
              return contractInstance.queryFilter(
                purchaseFilter,
                bc,
                Math.min(bc + step - 1, END_BLOCK)
              );
            });

          // console.log({ purchaseEvents });

          const soldEvents = await contractInstance
            .queryFilter(soldFilter, bc, Math.min(bc + step - 1, END_BLOCK))
            .catch(e => {
              console.log("block swaphelper logs failed retrying...", bc);
              return contractInstance.queryFilter(
                soldFilter,
                bc,
                Math.min(bc + step - 1, END_BLOCK)
              );
            });

          // console.log(
          //   "found transfer logs in block:",
          //   { bc },
          //   { purchaseEvents: purchaseEvents.length, soldEvents: soldEvents.length }
          // );

          const isContract = async (log, role) => {
            const possibleCodeStateOfAddress = await contractInstance.provider
              .getCode(log.args[role])
              .catch(e => "0x");
            return possibleCodeStateOfAddress !== "0x";
          };

          // Print out all the values:
          const purchasedEventsMapped = purchaseEvents.map(async log => {
            let balance = newAddresses[log.args.to] || ZERO;
            // console.log(log.blockNumber);
            // console.log(`actualReturn: ${log.args.actualReturn.toString()}`);
            newAddresses[log.args.to] =
              log.blockNumber === 14358516 //airdrop reimburse
                ? balance.sub(log.args.value)
                : balance.add(log.args.value);
            newIsContracts[log.args.to] = await isContract(log, "to");
          });
          const soldEventsMapped = soldEvents.map(async log => {
            let balance = newAddresses[log.args.from] || ZERO;
            newAddresses[log.args.from] = balance.sub(log.args.value);
            newIsContracts[log.args.from] = await isContract(log, "from");
          });

          await Promise.all([...purchasedEventsMapped, ...soldEventsMapped]);
        });
        await Promise.all(processedChunks);
      }
    };

    await populateListOfAddressesAndBalances(
      newReserve,
      reserveTokenPurchasedFilter,
      reserveTokenSoldFilter
    );
    await populateListOfAddressesAndBalances(
      recoveredReserve,
      reserveTokenPurchasedFilter,
      reserveTokenSoldFilter
    );
    // await populateListOfAddressesAndBalances(exchangeHelper, exchangeHelperTokenPurchasedFilter, exchangeHelperTokenSoldFilter);

    // console.log({ newAddresses, newIsContracts });
    return { newAddresses, newIsContracts };
  };

  const buildMerkleTree = () => {
    const { addressesCombined } = JSON.parse(
      fs.readFileSync("airdrop/buyBalancesCombined.json").toString()
    );

    let toTree: Array<[string, BigNumber]> = Object.entries(
      addressesCombined
    ).map(([addr, gdx]) => {
      return [addr, gdx as BigNumber];
    });

    // console.log(`Before sorting`);
    // toTree.forEach((a,_) => { console.log(`${a[0].toString()}:${ethers.BigNumber.from(a[1]).toString()}\n`)});

    toTree.sort((a, b) => (BigNumber.from(b[1]).gt(a[1]) ? 0 : -1));

    // console.log(`After sorting`);
    // toTree.forEach((a,_) => { console.log(`${a[0].toString()}:${ethers.BigNumber.from(a[1]).toString()}\n`)});

    let totalGDX = ZERO;
    toTree.forEach((a, _) => (totalGDX = totalGDX.add(a[1])));
    console.log({
      toTree: toTree.forEach((a, _) =>
        console.log({
          address: a[0].toString(),
          balance: BigNumber.from(a[1]).toString()
        })
      ),
      numberOfAccounts: toTree.length,
      TotalGDX: totalGDX.toString()
    });

    // Print statistics
    const sorted = toTree.map(_ => _[1]);
    console.log("GDX Distribution\n");
    [0.001, 0.01, 0.1, 0.5].forEach(q =>
      console.log({
        precentile: q * 100 + "%",
        gdx: quantileBN(sorted, q)
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
      "airdrop/gdxAirdropRecovery.json",
      JSON.stringify({ treeData, merkleRoot })
    );
  };

  const addCalculationsToPreviousData = async () => {
    // get previous airdrop and turn it into BigNumbers
    const gdxAirdropData = JSON.parse(
      fs.readFileSync("airdrop/gdxairdrop.json").toString()
    );
    const addressesCombined = {};
    for (const [address, balance] of Object.entries(gdxAirdropData.treeData)) {
      addressesCombined[address] = BigNumber.from(balance["gdx"]).toString();
    }

    // get new holders info and turn into array
    const { newAddresses } = await getHoldersInformation();

    let newAddressesArray: Array<[string, BigNumber]> = Object.entries(
      newAddresses
    ).map(([addr, gdx]) => {
      return [addr, gdx as BigNumber];
    });

    // Unite previous airdrop with current information
    for (const newAddressEntry of newAddressesArray) {
      const address = newAddressEntry[0];
      const addition = newAddressEntry[1];

      if (addition <= ZERO) continue;

      // console.log({address})
      // console.log({before: BigNumber.from(addressesCombined[address] || "0").toString() })
      // console.log({addition: addition.toString()})
      addressesCombined[address] = ethers.BigNumber.from(
        addressesCombined[address] || 0
      )
        .add(addition.toString())
        .toString();
      // console.log({total: addressesCombined[address].toString()})
      // console.log(`\n`);
    }

    let newReserve = await ethers.getContractAt(
      "GoodReserveCDai",
      "0xa150a825d425B36329D8294eeF8bD0fE68f8F6E0"
    );

    const ps = Object.entries(addressesCombined).map(async ([addr, amount]) => {
      console.log(addr, amount);
      const balance = await newReserve.balanceOf(addr);
      const diff = balance.sub(amount);
      if (diff.lt(0)) {
        console.log({
          addr,
          balance: balance.toString(),
          amount,
          diff: diff.toString()
        });
      }
    });

    await Promise.all(ps);
    fs.writeFileSync(
      "airdrop/buyBalancesCombined.json",
      JSON.stringify({ addressesCombined })
    );
  };

  return { buildMerkleTree, addCalculationsToPreviousData };
};
