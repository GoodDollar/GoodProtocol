import farmed from "../farming.json";
import { ethers, network } from "hardhat";
import { chunk } from "lodash";
import contracts from "../releases/deployment.json";
import { bulkIsWhitelisted } from "./utils";
const main = async () => {
  const signer = (await ethers.getSigners())[0];

  console.log("signer", signer.address);
  const whitelist = await ethers.getContractAt("BulkWhitelist", contracts[network.name].BulkWhitelist);
  const chunks = chunk(farmed, 300);
  for (let batch of chunks) {
    console.log("whitelisting batch of", batch.length, batch[0], batch[batch.length - 1]);
    const res = await (await whitelist.connect(signer).removeWhitelisted(batch, { gasLimit: 25000000 })).wait();
    console.log("tx:", res.transactionHash);
  }
};

const checkReVerified = async () => {
  const chunks = chunk(farmed, 300);
  let total = 0;
  for (let batch of chunks) {
    console.log("check whitelisting batch of", batch.length, batch[0], batch[batch.length - 1]);
    const res = await bulkIsWhitelisted(batch);
    console.log(`${res.length}/${batch.length}`);
    total += res.length;
  }
  console.log(`total: ${total}/${farmed.length}`);
};
checkReVerified();
// main().catch(console.log);
