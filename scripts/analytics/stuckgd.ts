import { range } from "lodash";
import PromisePool from "async-promise-pool";
import fs from "fs";
import { Provider, setMulticallAddress } from "ethers-multicall";

import { ethers } from "hardhat";
import { Retrier } from "@jsier/retrier";

setMulticallAddress(122, "0x3CE6158b7278Bf6792e014FA7B4f3c6c46fe9410");
const celoProvider = new ethers.providers.JsonRpcBatchProvider(
  "https://forno.celo.org"
);

const GD_CELO = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";

let gd = new ethers.Contract(
  GD_CELO,
  [
    "event Transfer(address indexed from, address indexed to, uint amount)",
    "function balanceOf(address) view returns(uint256)"
  ],
  celoProvider
);

/**
 * in/out G$ to a specific address (here used for invites)
 */
const main = async () => {
  const curBlock = await celoProvider.getBlockNumber();
  let txs = [];
  const f = gd.filters.Transfer(null, GD_CELO);
  const STEP_SIZE = 5000;
  const fromBlocks = range(curBlock - 6e6, curBlock, STEP_SIZE); //600k blocks roughly a month
  const pool = new PromisePool({ concurrency: 2 });
  console.log({ curBlock });
  fromBlocks.forEach(fromBlock => {
    pool.add(async () => {
      const options = { limit: 20, delay: 2000 };
      const retrier = new Retrier(options);

      const results = await retrier
        .resolve(() => gd.queryFilter(f, fromBlock, fromBlock + STEP_SIZE))
        .catch(e => console.warn("queryfilter failed:", { fromBlock }));
      if (!results) return;

      txs = txs.concat(results);
      console.log({ fromBlock }, results.length);
    });
  });

  await pool.all();

  console.log(txs.length);
  fs.writeFileSync("stuckgd.json", JSON.stringify(txs));
};

const analyze = () => {
  const txs = JSON.parse(fs.readFileSync("stuckgd.json").toString());
  let value = 0;
  console.log(txs[0]);
  txs.forEach(tx => {
    value += Number(tx.args[2].hex);
    console.log(
      `erc20,${GD_CELO},${tx.args[0]},${Number(tx.args[2].hex) / 1e18},`
    );
  });
  console.log(txs.length, { value });
};
analyze();
// main().catch(e => console.error("Error:", e.message));
