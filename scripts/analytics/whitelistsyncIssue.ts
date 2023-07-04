import { range, chunk, uniq } from "lodash";
import { ethers } from "hardhat";
import { Contract, Provider, setMulticallAddress } from "ethers-multicall";
import fs from "fs";
import { Retrier } from "@jsier/retrier";

setMulticallAddress(122, "0x3CE6158b7278Bf6792e014FA7B4f3c6c46fe9410");
setMulticallAddress(42220, "0x75F59534dd892c1f8a7B172D639FA854D529ada3");
const celoProvider = new ethers.providers.JsonRpcBatchProvider("https://forno.celo.org");
const ethcallProvider = new Provider(celoProvider, 42220);
const ethcallFuseProvider = new Provider(new ethers.providers.JsonRpcProvider("https://rpc.fuse.io"), 122);

const ONE_DAY = 24 * 60 * 60;
/**
 * find accounts that where whitelisted on celo with diff authentication date than on fuse
 */
const main = async () => {
  const identity = await ethers.getContractAt("IdentityV2", "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42");
  const abi = identity.interface.format(ethers.utils.FormatTypes.full);
  const multiIdentity = new Contract(identity.address, abi as string[]);
  const multiIdentityFuse = new Contract("0x2F9C28de9e6d44b71B91b8BA337A5D82e308E7BE", abi as string[]);

  const celoStartBlock = 18003118;
  const step = 10000;
  const celoLastBlock = await ethers.provider.getBlockNumber();
  const notFuse = [],
    notCelo = [],
    toFixCelo = [],
    toFixFuse = [],
    notBoth = [];
  for (let i = 0; celoStartBlock + step * i < celoLastBlock; i++) {
    try {
      const options = { limit: 3, delay: 2000 };
      const retrier = new Retrier(options);

      const lastBlock = celoStartBlock + step * (i + 1) + 1;
      await retrier.resolve(async attempt => {
        const events = await identity
          .connect(celoProvider)
          .queryFilter(
            identity.filters["WhitelistedAdded"](),
            celoStartBlock + step * i,
            Math.min(celoLastBlock, lastBlock)
          );
        console.log("found events:", events.length);
        const whitelisted = events.map(_ => _.args?.account);
        let found = 0;
        const ps = chunk(whitelisted, 400).map(async addrChunk => {
          const results = await ethcallProvider.all(addrChunk.map(addr => multiIdentity.lastAuthenticated(addr)));
          const resultsFuse = await ethcallFuseProvider.all(
            addrChunk.map(addr => multiIdentityFuse.lastAuthenticated(addr))
          );
          results.forEach((v, i) => {
            const diff = v.toNumber() - resultsFuse[i].toNumber();
            if (v.eq(0) || diff > 3600) {
              found++;
              // console.log("diff:", { i, addr: whitelisted[i], celo: v, fuse: resultsFuse[i] });
              if (v.eq(0) && resultsFuse[i].eq(0)) {
                // notBoth.push(addrChunk[i]);
              } else if (v.eq(0)) {
                notCelo.push(addrChunk[i]);
              } else if (resultsFuse[i].eq(0)) {
                notFuse.push([addrChunk[i], v.toNumber()]);
              } else if (diff > 0) {
                // console.log("mismatch:", addrChunk[i], { diff });
                toFixCelo.push([addrChunk[i], resultsFuse[i].toNumber()]);
              } else {
                toFixFuse.push([addrChunk[i], v.toNumber()]);
              }
            }
          });
        });
        await Promise.all(ps);
        console.log("done day:", { i, attempt, found });
      });
    } catch (e) {
      console.log("failed day:", i, e.message.slice(0, 100));
    }
  }
  fs.writeFileSync("whitelistissue.json", JSON.stringify({ toFixCelo, toFixFuse, notCelo, notFuse }));
  console.log({ toFixFuse: toFixFuse.length, toFixCelo: toFixCelo.length, notCelo, notFuse });
};

const fix = async () => {
  const { toFix, notFuse } = JSON.parse(fs.readFileSync("whitelistissue.json").toString());
};
main();
