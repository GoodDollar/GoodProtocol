import { range, chunk, uniq, mapValues, groupBy } from "lodash";
import { ethers, ethers as Ethers } from "hardhat";
import fs from "fs";
import { bulkGetLastAuth } from "../utils";

const ONE_DAY = 24 * 60 * 60;
const ONE_HOUR = 60 * 60;

const main = async () => {
  const signer = (await Ethers.getSigners())[0];
  console.log("signer:", signer.address);
  const ubiScheme = new Ethers.Contract("0xD7aC544F8A570C4d8764c3AAbCF6870CBD960D0D", [
    "function fishMulti(address[] tofish)"
  ]).connect(signer);
  const twoWeeksAgo = parseInt((Date.now() / 1000).toFixed(0)); //
  //parseInt((Date.now() / 1000).toFixed(0)) - 24 * 60 * 60 * 14;

  const daysAgo: number[] = range(0, 180, 1);
  let curDay = twoWeeksAgo;
  const allActive = [];
  for (let day of daysAgo) {
    const query = `
      { 
        walletStats(first:1000, where: { lastClaimed_lte: ${curDay},lastClaimed_gt: ${curDay - ONE_DAY
      } isActiveUser: true }) {
        id        
      }
    }
  `;

    console.log("fetching inactive users since:", { curDay, day }, JSON.stringify({ query }));
    const result = await fetch("https://api.thegraph.com/subgraphs/name/gooddollar/gooddollarfuse", {
      method: "post",
      body: JSON.stringify({ query }),
      headers: { "Content-Type": "application/json" }
    }).then(_ => _.json());


    console.log("got inactive wallets:", result);
    // if (walletStats) {
    //   const accounts = walletStats.map(_ => _.id);
    //   allActive.push(...accounts);
    // }

    // for (let tofish of chunk(accounts, 50)) {
    //   const tx = await ubiScheme.fishMulti(tofish, { gasLimit: 2000000 });
    //   console.log("fishing tx:", tx, tofish);
    //   const res = await tx.wait();
    //   console.log("fishing tx result:", res);
    // }

    curDay = curDay - ONE_DAY;
  }
  const unique = uniq(allActive);
  console.log("active claimers:", unique.length);
};

const countClaimersUsingExplorer = async () => {
  let claimers = [] //JSON.parse(fs.readFileSync("claimers.json").toString())
  const curBlock = await ethers.provider.getBlockNumber()
  const DAYS = 1
  let fromBlock = curBlock - 60 * 60 * 24 * DAYS / 5 //roughly DAYS of blocks
  const querySize = 90// 15 min of blocks
  const blockRanges = range(fromBlock, curBlock, querySize)
  const chunks = chunk(blockRanges, 10)
  for (let idx in chunks) {
    const toFetch = chunks[idx]
    const ps = toFetch.map(async fromBlock => {
      let toBlock = fromBlock + querySize
      toBlock = toBlock > curBlock ? curBlock : toBlock
      const result = await fetch(`https://explorer.celo.org/mainnet/api?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}&address=0x43d72ff17701b2da814620735c39c620ce0ea4a1&topic0=0x89ed24731df6b066e4c5186901fffdba18cd9a10f07494aff900bdee260d1304`).then(_ => _.json())
      fromBlock = toBlock
      const addrs = result.result.map(_ => ethers.utils.defaultAbiCoder.decode(["address"], _.topics[1])[0])
      claimers.push(...addrs);
      console.log("claimers:", addrs.length, "block range:", { fromBlock, toBlock }, addrs[0])
    })
    await Promise.all(ps)
    console.log(`${idx} out of ${chunks.length}`)
  }

  claimers = uniq(claimers)
  fs.writeFileSync("claimers.json", JSON.stringify(claimers))
}

const countLastWhitelisted = async () => {
  const claimers = JSON.parse(fs.readFileSync("claimers.json").toString())
  const DAY = 60 * 60 * 24
  let total = 0
  let howOld = []
  console.log("unique claimers:", claimers.length)
  for (let bulk of chunk(claimers, 1000)) {
    const results = await bulkGetLastAuth(bulk)
    const older = results.filter(_ => _.toNumber() < Date.now() / 1000 - DAY * 180).length
    bulk.forEach((_, i) => howOld.push([_, Math.ceil((Date.now() / 1000 - DAY * 180 - results[i].toNumber()) / (30 * DAY)).toFixed(0)]))
    console.log(older, "out of", results.length)
    total += older
  }

  howOld = howOld.filter(_ => Number(_[1]) > 0)
  console.log({ total })
  howOld = mapValues(groupBy(howOld, _ => _[1]), _ => _.length)
  console.log(howOld)
}

const countActive = async () => {

  const hoursAgo: number[] = range(0, 24 * 30, 1);
  let curDay = parseInt((Date.now() / 1000).toFixed(0));
  const allActive = [];
  for (let hour of hoursAgo) {
    const query = `
      { 
        walletStats(first:1000, where: { lastClaimed_lte: ${curDay},lastClaimed_gt: ${curDay - ONE_HOUR
      } isActiveUser: true }) {
        id        
      }
    }
  `;

    console.log("fetching active users since:", { curDay, hour }, JSON.stringify({ query }));
    const result =

      await fetch("https://gateway-arbitrum.network.thegraph.com/api/3c409250a317ce7b0c6a7a8b9a409ef8/subgraphs/id/F7314rxGdcpKPC1nN5KCoFW84EGRoUyzseY2sAT9PEkw", {
        // await fetch("https://gateway.thegraph.com/api/3c409250a317ce7b0c6a7a8b9a409ef8/subgraphs/id/5cAhhzm7LSqGiFibV1odbbgZWiRmZsYjYrmaoj87UxFd", {
        method: "post",
        body: JSON.stringify({ query }),
        headers: { "Content-Type": "application/json", "origin": "https://wallet.gooddollar.org" }

      }).then(_ => _.json());

    console.log(result)
    const {
      data: { walletStats }
    } = result
    console.log("got active wallets:", walletStats.length);
    if (walletStats) {
      const accounts = walletStats.map(_ => _.id);
      allActive.push(...accounts);
    }
    // for (let tofish of chunk(accounts, 50)) {
    //   const tx = await ubiScheme.fishMulti(tofish, { gasLimit: 2000000 });
    //   console.log("fishing tx:", tx, tofish);
    //   const res = await tx.wait();
    //   console.log("fishing tx result:", res);
    // }

    curDay = curDay - ONE_HOUR;
  }
  const unique = uniq(allActive);
  console.log("active claimers:", unique.length);
};

//main();
// countActive();
// countClaimersUsingExplorer()
countLastWhitelisted()
