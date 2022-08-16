import { range, sortBy, toPairs } from "lodash";
import fetch from "node-fetch";
import PromisePool from "async-promise-pool";
import fs from "fs";
import { ethers } from "hardhat";
import { start } from "repl";
import { JsonRpcProvider } from "@ethersproject/providers";
import { off } from "process";

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

const main = async () => {
  const archive = new JsonRpcProvider("https://explorer-node.fuse.io");
  const blockStep = 10000;
  const pool = new PromisePool({ concurrency: 10 });

  let faucet = await ethers.getContractAt(
    ["event WalletTopped(address indexed user, uint256 amount)"],
    "0x01ab5966C1d742Ae0CFF7f14cC0F4D85156e83d9"
  );
  const endBlock = Number(await ethers.provider.getBlockNumber());
  const daysBack = 30;
  const dayBlocks = 12 * 60 * 24;
  const startBlock = endBlock - dayBlocks * daysBack;
  const days = range(startBlock, endBlock, dayBlocks);
  const dailyBalance = [];
  for (let day of days) {
    dailyBalance.push(
      (
        await archive.getBalance(
          "0x01ab5966C1d742Ae0CFF7f14cC0F4D85156e83d9",
          day
        )
      )
        .div(1e10)
        .toNumber() / 1e8
    );
  }
  let curBlock = startBlock;

  const toppingsByAddress = {};
  const toppingsByAmount = {};
  let totalToppings = 0;
  let totalAmount = 0;
  console.log({ dailyBalance });
  console.log({ startBlock, endBlock });
  while (curBlock <= endBlock) {
    const fromBlock = curBlock;
    const toBlock = Math.min(fromBlock + blockStep, endBlock);
    pool.add(async () => {
      const f = faucet.filters.WalletTopped();
      const events = await faucet
        .queryFilter(f, fromBlock, toBlock)
        .catch(e => {
          console.log("failed", { fromBlock, toBlock });
          return [];
        });
      events.forEach(e => {
        totalToppings += 1;
        totalAmount += Number(e.args.amount);
        toppingsByAddress[e.args.user] =
          (toppingsByAddress[e.args.user] || 0) + 1;
        toppingsByAmount[e.args.amount] =
          (toppingsByAmount[e.args.amount] || 0) + 1;
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
  const totalWallets = topToppers.length;

  const avgToppingsPerWallet = totalToppings / totalWallets;
  const avgToppingAmount = totalAmount / totalToppings;

  fs.writeFileSync("topToppers.csv", arrayToCsv(topToppers));
  fs.writeFileSync("topAmounts.csv", arrayToCsv(topAmounts));
  console.log({
    totalAmount,
    totalToppings,
    avgToppingsPerWallet,
    avgToppingAmount
  });
};
main().catch(e => console.log(e));
