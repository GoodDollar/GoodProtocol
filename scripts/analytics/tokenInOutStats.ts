import { maxBy, range, sortBy } from "lodash";
import PromisePool from "async-promise-pool";
import fs from "fs";
import { ethers } from "hardhat";

/**
 * in/out G$ to a specific address (here used for invites)
 */
const main = async () => {
  let address = "0xCa2F09c3ccFD7aD5cB9276918Bd1868f2b922ea0";
  let token = "0x495d133B938596C9984d462F007B676bDc57eCEC";
  let startblock = 14710000;
  let stepSize = 5000;
  let result = [];
  let incoming = 0;
  let outgoing = 0;
  let ins = [];
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
  result.forEach(r => {
    if (r.from === address.toLowerCase()) outgoing += Number(r.value);
    else {
      incoming += Number(r.value);
      ins.push(r);
    }
  });
  fs.writeFileSync("tokenInOut.json", JSON.stringify({ incoming, outgoing, ins }));
};

main().catch(e => console.log(e));
