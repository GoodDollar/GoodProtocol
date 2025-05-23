import { maxBy, range, sortBy, flatten } from "lodash";
import PromisePool from "async-promise-pool";
import fs from "fs";
import { ethers } from "hardhat";

const today = new Date().toLocaleDateString().replace(/\//g, "");
console.log({ today });
/****
 * Fetch token holders and their last activity date
 * can be used to create stats about active users and how much G$ isnt active
 */
const main = async (chain = "fuse") => {
  let result = [];
  let balances = {};
  let curPage = 1;
  let maxResult;
  const fuseExplorer = "https://explorer.fuse.io/api";
  const celoExplorer = "https://explorer.celo.org/mainnet/api";
  const fuseSubgraph =
    "https://gateway.thegraph.com/api/9048669a7632776aae01a191c4939445/subgraphs/id/5cAhhzm7LSqGiFibV1odbbgZWiRmZsYjYrmaoj87UxFd";
  const celoSubgraph =
    "https://gateway.thegraph.com/api/9048669a7632776aae01a191c4939445/subgraphs/id/F7314rxGdcpKPC1nN5KCoFW84EGRoUyzseY2sAT9PEkw";
  do {
    const pages = range(curPage, curPage + 5, 1);
    curPage += 5;
    const ps = pages.map(p =>
      fetch(
        `${fuseExplorer}?module=token&action=getTokenHolders&contractaddress=0x495d133B938596C9984d462F007B676bDc57eCEC&page=${p}&offset=10000`
      )
        .then(_ => _.json())
        .then(_ => _.result)
    );
    const results = await Promise.all(ps);
    result = result.concat(...results);
    maxResult = maxBy(results, "length");
    console.log(maxResult.length, result.length);
  } while (maxResult.length === 10000);
  result.forEach(
    r =>
      (balances[r.address.toLowerCase()] = {
        balance: Number(r.value) / 100,
        fuseBalance: Number(r.value) / 100,
        lastSeen: 0
      })
  );

  console.log("fetching celo balances....");
  curPage = 1;
  result = [];
  do {
    const pages = range(curPage, curPage + 3, 1);
    curPage += 3;
    const ps = pages.map(p =>
      fetch(
        `${celoExplorer}?module=token&action=getTokenHolders&contractaddress=0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A&page=${p}&offset=10000`
      )
        .then(_ => _.json())
        .then(_ => _.result)
    );
    const results = await Promise.all(ps);
    result = result.concat(...results);
    maxResult = maxBy(results, "length");
    console.log(maxResult.length, result.length);
  } while (maxResult.length === 10000);

  result.forEach(
    r =>
      (balances[r.address.toLowerCase()] = {
        ...balances[r.address.toLowerCase()],
        celoBalance: Number(r.value) / 1e18,
        balance: Number(balances[r.address.toLowerCase()]?.fuseBalance || 0) + Number(r.value) / 1e18,
        lastSeen: 0
      })
  );

  fs.writeFileSync(`activeWalletsBalances-${today}.json`, JSON.stringify(balances));

  balances = JSON.parse(fs.readFileSync(`activeWalletsBalances-${today}.json`).toString());

  const EPOCH = 60 * 60 * 6;
  const pool = new PromisePool({ concurrency: 10 });
  const lastUsed = {};
  const epochs = range(1596045730, (Date.now() / 1000).toFixed(0), EPOCH);

  const graphQuery = async (start, skip, subgraph, retry = 3) => {
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
      const { data = {}, errors } = await fetch(subgraph, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query })
      }).then(_ => _.json());
      errors && console.log({ errors });
      if (errors) {
        console.log("query failed:", { subgraph, start, skip, retrying: retry > 0 });
        if (retry > 0) {
          return graphQuery(start, skip, subgraph, retry - 1);
        }
        return [];
      }
      // console.log("query ok:", { subgraph, start, skip, records: data.walletStats.length })
      if (data?.walletStats?.length === 1000) {
        return data.walletStats.concat(await graphQuery(start, skip + 1000, subgraph));
      }
      return data.walletStats || [];
    } catch (error) {
      console.log({ query, error, subgraph });
      return [];
    }
  };
  epochs.forEach(e => {
    pool.add(async () => {
      const walletStats = flatten(await Promise.all([graphQuery(e, 0, fuseSubgraph), graphQuery(e, 0, celoSubgraph)]));
      walletStats.forEach(w => {
        balances[w.id.toLowerCase()] = {
          ...balances[w.id.toLowerCase()],
          lastSeen: Math.max(
            balances[w.id.toLowerCase()]?.lastSeen,
            Number(w.lastClaimed),
            Number(w.lastTransactionFrom),
            Number(w.lastTransactionTo),
            Number(w.dateAppeared)
          )
        };
      });
      console.log({ curDate: e, records: walletStats.length });
    });
  });

  await pool.all();
  fs.writeFileSync(`activeWalletsLastUsed-${today}.json`, JSON.stringify(balances));
  //   console.log({ lastUsed });
};

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

const fix = async () => {
  const balances = JSON.parse(fs.readFileSync(`activeWalletsLastUsed-${today}.json`).toString());

  let result = [];

  let missing = 0;
  for (let addr in balances) {
    const r = balances[addr];
    if (!r.fuseBalance && !r.celoBalance) {
      console.log("missing:", addr);
      missing += 1;
      continue;
    }
    r.celoBalance = (r.celoBalance || 0) * 100;
    r.balance = r.celoBalance + r.fuseBalance;
  }

  console.log("missing balance", missing);
  console.log(sortBy(Object.entries(balances), _ => -_.balance).slice(0, 10));

  fs.writeFileSync(`activeWalletsLastUsed-${today}.json`, JSON.stringify(balances));
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

  const balances = JSON.parse(fs.readFileSync(`activeWalletsLastUsed-${today}.json`).toString());

  let result = [];

  for (let addr in balances) {
    const r = balances[addr];
    if (!r.balance) {
      continue;
    }
    result.push([addr, r.balance, r.lastSeen, false, r.fuseBalance, r.celoBalance]);
  }
  result = sortBy(result, _ => -_[1]);
  const top100 = result.slice(0, 100);
  const pool = new PromisePool({ concurrency: 30 });
  const provider = new ethers.providers.JsonRpcBatchProvider("https://rpc.fuse.io");
  const celoprovider = new ethers.providers.JsonRpcBatchProvider("https://forno.celo.org");

  for (let idx in top100) {
    pool.add(async () => {
      const record = top100[idx];
      let isContract =
        (
          await Promise.all([
            provider.getCode(record[0]).catch(e => "0x"),
            celoprovider.getCode(record[0]).catch(e => "0x")
          ])
        ).find(_ => _ !== "0x") !== undefined;
      record[3] = isContract;
    });
  }
  await pool.all();
  console.log({ top100 });
  fs.writeFileSync(`activeWalletsLastUsed-${today}.csv`, arrayToCsv(result));
};

const getFuseBalances = async (refetch = true) => {
  if (refetch === false) {
    const balances = JSON.parse(fs.readFileSync("activeWalletsBalances.json").toString());
    const rows = Object.entries(balances).filter(_ => Number(_[1].balance) > 10000000);
    const sorted = sortBy(rows, _ => -Number(_[1].balance));
    sorted.forEach(_ => (_[1].balance = Number(_[1].balance) / 100));
    console.log(arrayToCsv(sorted.slice(0, 20).map(_ => [_[0], _[1].balance])));
    return balances;
  }
  let result = [];
  let balances = {};
  let curPage = 1;
  let maxResult;

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
  return balances;
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
getFuseBalances(false).catch(e => console.log(e));
// main().catch(e => console.log(e));
// fix();
etl();
// fundsByLastSeen();
