import { range, sortBy, toPairs } from "lodash";
import PromisePool from "async-promise-pool";
import fs from "fs";
import { ethers } from "hardhat";
import { JsonRpcProvider } from "@ethersproject/providers";
import fetch from "node-fetch";

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

const celoStats = async () => {};
const main = async (isCelo = true) => {
  const archive = new JsonRpcProvider(
    isCelo ? "https://celo-mainnet-archive.allthatnode.com" : "https://explorer-node.fuse.io"
  );
  const faucetAddr = isCelo
    ? "0x4F93Fa058b03953C851eFaA2e4FC5C34afDFAb84"
    : "0x01ab5966C1d742Ae0CFF7f14cC0F4D85156e83d9";

  const adminAddr = "0x7119CD89D4792aF90277d84cDffa3F2Ab22a0022";
  const blockStep = 10000;
  const pool = new PromisePool({ concurrency: 5 });

  let faucet = await ethers.getContractAt(
    [
      "event WalletTopped(address indexed account, uint256 amount,address whitelistedRoot,address indexed relayerOrWhitelisted)"
    ],
    faucetAddr
  );
  const endBlock = Number(await archive.getBlockNumber());
  const daysBack = 90;
  const dayBlocks = 12 * 60 * 24;
  const startBlock = endBlock - dayBlocks * daysBack;
  const days = range(startBlock, endBlock, dayBlocks);
  console.log({ startBlock, endBlock });
  const dailyBalance = [];
  const dailyAdminBalance = [];
  for (let day of days) {
    dailyBalance.push(
      await Promise.all([
        archive.getBalance(faucetAddr, day).then(_ => _.div(1e10).toNumber() / 1e8),
        archive.getBalance("0x7119CD89D4792aF90277d84cDffa3F2Ab22a0022", day).then(_ => _.div(1e10).toNumber() / 1e8)
      ])
    );
    console.log({ day });
  }

  let curBlock = startBlock;
  const toppingsByAddress = {};
  const toppingsByAmount = {};
  const toppingsByRelayer = {};
  let totalToppings = 0;
  let totalAmount = 0;
  const dailyUsage = dailyBalance.map((v, i) => (i < dailyBalance.length - 1 ? v[0] - dailyBalance[i + 1][0] : 0));
  const dailyAdminUsage = dailyBalance.map((v, i) => (i < dailyBalance.length - 1 ? v[1] - dailyBalance[i + 1][1] : 0));

  console.log({ dailyUsage, dailyAdminUsage });
  fs.writeFileSync("celospend.csv", arrayToCsv(dailyBalance));
  console.log(arrayToCsv(dailyBalance));

  console.log({ startBlock, endBlock });
  while (curBlock <= endBlock) {
    const fromBlock = curBlock;
    const toBlock = Math.min(fromBlock + blockStep, endBlock);
    pool.add(async () => {
      const f = faucet.filters.WalletTopped();
      const events = await faucet.queryFilter(f, fromBlock, toBlock).catch(e => {
        console.log("failed", { fromBlock, toBlock });
        return [];
      });
      events.forEach(e => {
        totalToppings += 1;
        totalAmount += Number(e.args.amount);
        toppingsByAddress[e.args.whitelistedRoot] = (toppingsByAddress[e.args.whitelistedRoot] || 0) + 1;
        if (e.args.account !== e.args.relayerOrWhitelisted)
          toppingsByRelayer[e.args.relayerOrWhitelisted] = (toppingsByRelayer[e.args.relayerOrWhitelisted] || 0) + 1;
        toppingsByAmount[e.args.amount] = (toppingsByAmount[e.args.amount] || 0) + 1;
      });
      console.log("fetched events", {
        fromBlock,
        toBlock,
        events: events.length
      });
    });
    curBlock += blockStep;
  }
  await pool.all();

  const topToppers = sortBy(toPairs(toppingsByAddress), "1").reverse();
  const topAmounts = sortBy(toPairs(toppingsByAmount), "1").reverse();
  const topRelayers = sortBy(toPairs(toppingsByRelayer), "1").reverse();

  const totalWallets = topToppers.length;

  const avgToppingsPerWallet = totalToppings / totalWallets;
  const avgToppingAmount = totalAmount / totalToppings;

  console.log(topRelayers.slice(0, 50));
  fs.writeFileSync("topToppers.csv", arrayToCsv(topToppers));
  fs.writeFileSync("topAmounts.csv", arrayToCsv(topAmounts));
  fs.writeFileSync("topRelayers.csv", arrayToCsv(topRelayers));

  console.log({
    totalAmount,
    totalToppings,
    avgToppingsPerWallet,
    avgToppingAmount
  });
};
main(true).catch(e => console.log(e));
