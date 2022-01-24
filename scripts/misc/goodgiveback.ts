import { get, range, chunk, flatten, mergeWith, sortBy, uniq } from "lodash";
import fs from "fs";
import { network, ethers, upgrades } from "hardhat";
import { Contract, Provider, setMulticallAddress } from "ethers-multicall";
import Identity from "../../artifacts/contracts/Interfaces.sol/IIdentity.json";

setMulticallAddress(122, "0x3CE6158b7278Bf6792e014FA7B4f3c6c46fe9410");
const fuseProvider = new ethers.providers.JsonRpcProvider(
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
const identityContract = new Contract(IDENTITY_FUSE, Identity.abi);

const getDonations = async recipient => {
  const filter = gd.filters.Transfer(null, recipient);
  const events = await gd.queryFilter(filter, 14300689, 14800689);
  console.log("events found:", events.length);
  const agg = {};
  events.forEach(e => {
    const { from, amount } = e.args;
    agg[from] = (agg[from] || 0) + amount.toNumber();
  });
  const donators = Object.keys(agg);
  const calls = donators.map(d => identityContract.isWhitelisted(d));
  const result = await ethcallProvider.all(calls);
  const final = donators.map((d, i) => [recipient, d, agg[d], result[i]]);
  return final;
};
const main = async () => {
  const recipients = [
    "0x4c841e892d24faf01e7738800db8aed1160098ca",
    "0xf8b4c7098d195d12c1336a09fddaa9afa11bd097",
    "0x834f750aaab09d14a1101a15b185121f9a1475b2",
    "0x956e72df332ee17ecb3d641fca1f600ea19d1d09",
    "0x13dfefdc4713b98c07abdd9f7d93d2b8db716e6c",
    "0xbbc680560a88cf06c9ae8a36b209288577d9a143",
    "0x626c86ff4749043df4dd5e9dce650325955a4e6d",
    "0x82a92d1949498d494189152a040aeb0ef0175730",
    "0x27fb119b81b26104c0865435b741b6031bb35bb6",
    "0x6214D6b492528fc5517f57499c436A5FF72B6D5B"
  ];
  const results = await Promise.all(recipients.map(r => getDonations(r)));

  //   console.log(flatten(flatten(results)));

  fs.writeFileSync(
    "goodgive.csv",
    flatten(results)
      .map(_ => _.join(","))
      .join("\n")
  );
};
main().catch(e => console.log(e));
