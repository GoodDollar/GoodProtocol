import { countBy, chunk, difference, flatten, sortBy } from "lodash";
import fs from "fs";
import { network, ethers, upgrades } from "hardhat";
import { Contract, Provider, setMulticallAddress } from "ethers-multicall";
import Identity from "../../artifacts/contracts/Interfaces.sol/IIdentity.json";

setMulticallAddress(122, "0x3CE6158b7278Bf6792e014FA7B4f3c6c46fe9410");

setMulticallAddress(42220, "0x188C1bf697B66474dC3eaa119Ae691a8352537e3");

const fuseProvider = new ethers.providers.JsonRpcBatchProvider(
  "https://explorer-node.fuse.io/"
  // "https://rpc.fuse.io"
);
const celoProvider = new ethers.providers.JsonRpcBatchProvider(
  "https://forno.celo.org"
  // "https://rpc.fuse.io"
);
const ethcallProvider = new Provider(fuseProvider, 122);
const ethcallProviderCelo = new Provider(celoProvider, 42220);

const GD_FUSE = "0x495d133b938596c9984d462f007b676bdc57ecec";
const GD_CELO = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";

const gdMulti = new Contract(GD_FUSE, [
  "event Transfer(address indexed from, address indexed to, uint amount)",
  "function balanceOf(address) view returns(uint256)"
]);
const gdMultiCelo = new Contract(GD_CELO, [
  "event Transfer(address indexed from, address indexed to, uint amount)",
  "function balanceOf(address) view returns(uint256)"
]);

const hasBalance = async wallets => {
  console.log("checking balances for:", wallets.length);
  const chunks = chunk(wallets, 100);
  let balances = {};
  let users = [];
  for (let batch of chunks) {
    const calls = batch.map(a => gdMultiCelo.balanceOf(a));
    const result = await ethcallProviderCelo.all(calls);
    const found = batch.filter((d, i) => result[i] > 0);
    console.log("batch:", batch.length, calls.length, result.length, found.length);
    users = users.concat(found);
  }
  console.log("got balances for:", Object.entries(balances).length, "found users:", users.length);
  console.log(users);
};

const main = async () => {
  const wallets = fs
    .readFileSync("accounts.csv")
    .toString()
    .split("\n")
    .map(l => l.split(",")[0])
    .filter(a => a.startsWith("0x"));

  const refunded = await hasBalance(wallets);
};
main().catch(e => console.log(e));
