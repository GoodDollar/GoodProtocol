import { maxBy, range, sortBy, uniq, sum, flatten, countBy } from "lodash";
import fetch from "node-fetch";
import PromisePool from "async-promise-pool";
import fs from "fs";
import { ethers } from "hardhat";
import { keccak256 } from "web3-utils";

/***
 * fetch all income to certain accounts
 */
const main = async () => {
  const uniques = {};
  let addresses = [];
  let token = "0x495d133B938596C9984d462F007B676bDc57eCEC";
  let startblock = 18710000;
  let stepSize = 5000;
  for (const address of addresses) {
    let result = [];
    let curPage = 1;
    let maxResult;
    let reachedStartBlock = false;
    do {
      const pages = range(curPage, curPage + 5, 1);
      curPage += 5;
      const ps = pages.map(p => {
        const url = `https://explorer.fuse.io/api?module=account&action=tokentx&address=${address}&contractaddress=${token}&page=${p}&offset=${stepSize}`;
        console.log({ url });
        return fetch(url)
          .then(_ => _.json())
          .then(_ => _.result);
      });

      const results = await Promise.all(ps);
      result = result.concat(...results);
      maxResult = maxBy(results, "length");
      reachedStartBlock = result.find(_ => Number(_.blockNumber) <= startblock);
      maxResult && console.log(maxResult.length, result.length);
    } while (maxResult.length === stepSize && !reachedStartBlock);
    const incomingTxs = result
      .filter(
        _ =>
          [
            "0xca2f09c3ccfd7ad5cb9276918bd1868f2b922ea0",
            "0xd253a5203817225e9768c05e5996d642fb96ba86"
          ].includes(_.from) === false
      )
      .filter(_ => _.to === address.toLowerCase());
    const totalEarned = sum(incomingTxs.map(_ => Number(_.value))) / 100;
    const senders = uniq(incomingTxs.map(_ => _.from));
    console.log({ address, totalEarned, uniq: senders.length, senders });
    uniques[address] = senders;
  }
  const intersection = countBy(flatten(Object.values(uniques)), _ => _);
  console.log(sortBy(Object.entries(intersection), _ => _[1]).reverse());
  console.log(JSON.stringify(Object.keys(intersection).map(_ => keccak256(_))));
  console.log(JSON.stringify(addresses.map(_ => keccak256(_))));
};

main().catch(e => console.log(e));
