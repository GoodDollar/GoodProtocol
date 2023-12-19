import { maxBy, range, sortBy } from "lodash";
import PromisePool from "async-promise-pool";
import fs from "fs";
import { ethers } from "hardhat";

/****
 * Fetch token holders and their last activity date
 * can be used to create stats about active users and how much G$ isnt active
 */
const main = async (chain = "fuse") => {
  let result = [];
  let balances = {};
  let curPage = 1;
  let maxResult;
  const explorer = chain === "fuse" ? "https://explorer.fuse.io" : "https://explorer.celo.org";
  const subgraph = chain === "fuse" ? "https://api.thegraph.com/subgraphs/name/gooddollar/gooddollarfuse" : "https://";
  do {
    const pages = range(curPage, curPage + 5, 1);
    curPage += 5;
    const ps = pages.map(p =>
      fetch(
        `https://explorer.fuse.io/api?module=token&action=getTokenHolders&contractaddress=0x495d133B938596C9984d462F007B676bDc57eCEC&page=${p}&offset=10000`
      )
        .then(_ => _.json())
        .then(_ => _.result)
    );
    const results = await Promise.all(ps);
    result = result.concat(...results);
    maxResult = maxBy(results, "length");
    console.log(maxResult.length, result.length);
  } while (maxResult.length === 10000);
  result.forEach(r => (balances[r.address.toLowerCase()] = { balance: r.value, lastSeen: 0 }));
  fs.writeFileSync("activeWalletsBalances.json", JSON.stringify(balances));

  // balances = JSON.parse(fs.readFileSync("activeWalletsBalances.json").toString());

  const EPOCH = 60 * 60 * 6;
  const pool = new PromisePool({ concurrency: 30 });
  const lastUsed = {};
  const epochs = range(1596045730, (Date.now() / 1000).toFixed(0), EPOCH);

  const graphQuery = async (start, skip) => {
    const query = `{
        walletStats(first: 1000 skip:${skip} where: { dateAppeared_gte: ${start} dateAppeared_lt:${start + EPOCH} }) {
          id
          dateAppeared
          balance
          lastTransactionTo
          lastTransactionFrom
          lastClaimed
        }
      }`;
    // console.log({ query });
    try {
      const { data = {}, errors } = await fetch("https://api.thegraph.com/subgraphs/name/gooddollar/gooddollarfuse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query })
      }).then(_ => _.json());
      errors && console.log({ errors });
      if (data?.walletStats?.length === 1000) {
        return data.walletStats.concat(await graphQuery(start, skip + 1000));
      }
      return data.walletStats || [];
    } catch (error) {
      console.log({ query, error });
      return [];
    }
  };
  epochs.forEach(e => {
    pool.add(async () => {
      const walletStats = await graphQuery(e, 0);
      walletStats.forEach(w => {
        balances[w.id.toLowerCase()] = {
          lastSeen: Math.max(
            Number(w.lastClaimed),
            Number(w.lastTransactionFrom),
            Number(w.lastTransactionTo),
            Number(w.dateAppeared)
          ),
          balance: balances[w.id.toLowerCase()]?.balance || w.balance
        };
      });
      console.log({ curDate: e, records: walletStats.length });
    });
  });

  await pool.all();
  fs.writeFileSync("activeWalletsLastUsed.json", JSON.stringify(balances));
  //   console.log({ lastUsed });
};

const etl = async () => {
  /** Convert a 2D array into a CSV string
   */
  function arrayToCsv(data) {
    return data
      .map(
        row =>
          row
            .map(String) // convert every value to String
            .map(v => v.replaceAll('"', '""')) // escape double colons
            .map(v => `"${v}"`) // quote it
            .join(",") // comma-separated
      )
      .join("\r\n"); // rows starting on new lines
  }

  const balances = JSON.parse(fs.readFileSync("activeWalletsLastUsed.json").toString());

  let result = [];

  for (let addr in balances) {
    const r = balances[addr];
    if (!r.balance) {
      continue;
    }
    result.push([addr, r.balance / 100, r.lastSeen, false]);
  }
  const top100 = result.slice(0, 100);
  const pool = new PromisePool({ concurrency: 30 });
  const provider = new ethers.providers.JsonRpcBatchProvider("https://rpc.fuse.io");

  for (let idx in top100) {
    pool.add(async () => {
      const record = top100[idx];
      let isContract = (await provider.getCode(record[0]).catch(e => "0x")) !== "0x";
      record[3] = isContract;
    });
  }
  await pool.all();
  console.log({ top100 });
  fs.writeFileSync("activeWalletsLastUsed.csv", arrayToCsv(sortBy(result, _ => -Number(_[1]))));
};

const fundsByLastSeen = async () => {
  const balances = JSON.parse(fs.readFileSync("activeWalletsLastUsed.json").toString());
  let total1Year = 0;
  let total2Year = 0;
  let total = 0;
  for (let addr in balances) {
    const r = balances[addr];
    if (Number(r.balance) < 0) {
      console.log(addr, r.balance);
    }
    if (!Number(r.balance) || Number(r.balance) < 0) {
      continue;
    }

    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).valueOf() / 1000;
    const twoYearAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).valueOf() / 1000;
    if (Number(r.lastSeen) < yearAgo) {
      total1Year += Number(r.balance / 100);
    }
    if (Number(r.lastSeen) < twoYearAgo) {
      total2Year += Number(r.balance / 100);
    }

    total += Number(r.balance / 100);
  }

  console.log({ total, total1Year, total2Year });
};
// main().catch(e => console.log(e));
// etl();
fundsByLastSeen();
