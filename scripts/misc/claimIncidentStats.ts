import { countBy, chunk, difference, flatten, sortBy } from "lodash";
import fs from "fs";
import { network, ethers, upgrades } from "hardhat";
import { Contract, Provider, setMulticallAddress } from "ethers-multicall";
import Identity from "../../artifacts/contracts/Interfaces.sol/IIdentity.json";

setMulticallAddress(122, "0x3CE6158b7278Bf6792e014FA7B4f3c6c46fe9410");
const CLAIM_START_BLOCK = 17896430;

const fuseProvider = new ethers.providers.JsonRpcBatchProvider(
  "https://rpc.fuse.io"
);
const ethcallProvider = new Provider(fuseProvider, 122);

const GD_FUSE = "0x495d133b938596c9984d462f007b676bdc57ecec";
const IDENTITY_FUSE = "0xFa8d865A962ca8456dF331D78806152d3aC5B84F";

let gd = new ethers.Contract(
  GD_FUSE,
  [
    "event Transfer(address indexed from, address indexed to, uint amount)",
    "function balanceOf(address) view returns(uint256)"
  ],
  fuseProvider
);
const gdMulti = new Contract(GD_FUSE, [
  "event Transfer(address indexed from, address indexed to, uint amount)",
  "function balanceOf(address) view returns(uint256)"
]);

const hasBalanceToRefund = async wallets => {
  const chunks = chunk(wallets, 1000);
  let balances = {};
  for (let batch of chunks) {
    const calls = batch.map(a => gdMulti.balanceOf(a));
    const result = await ethcallProvider.all(calls);
    console.log("batch:", batch.length, calls.length, result.length);
    batch.forEach((d, i) => (balances[d] = result[i]));
  }
  console.log("got balances for:", Object.entries(balances).length);
  const hasBalance = countBy(balances, v => v >= 9622260);
  const noBalance = Object.entries(balances).filter(([k, v]) => v < 9622260);
  console.log({ hasBalance });
  return noBalance.map(_ => _[0]);
};

const hasRefunded = async wallets => {
  const events = await gd.queryFilter(
    gd.filters.Transfer(
      undefined,
      "0xd253A5203817225e9768C05E5996d642fb96bA86"
    ),
    17896430
  );
  const refunded = events.filter(e => e.args.amount >= 9622260);
  return refunded.map(_ => _.args.from.toLowerCase());
};

const whereIsTheMoney = async noBalance => {
  let targets = [];
  for (let batch of chunk(noBalance, 100)) {
    const tos = await Promise.all(
      batch.map(async a => {
        const e = await gd.queryFilter(
          gd.filters.Transfer(a),
          CLAIM_START_BLOCK
        );
        const tos = e.filter(_ => _.args.amount > 1000000).map(_ => _.args.to);
        return tos;
      })
    );
    targets.push(...flatten(tos));
  }
  const targetCounter = countBy(targets, _ => _);
  console.log(
    "transfer targets:",
    sortBy(Object.entries(targetCounter), "1").reverse()
  );
};
const main = async () => {
  const wallets = JSON.parse(fs.readFileSync("torefund.json").toString()).map(
    _ => _.toLowerCase()
  );
  console.log("Total Claimed:", wallets.length);
  const refunded = await hasRefunded(wallets);
  const notRefunded = difference(wallets, refunded);
  console.log(
    "refunded:",
    refunded.length,
    "not refunded:",
    notRefunded.length
  );

  const noBalanceToRefund = await hasBalanceToRefund(notRefunded);
  await whereIsTheMoney(noBalanceToRefund);
};
main().catch(e => console.log(e));
