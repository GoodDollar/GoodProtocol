import farmed from "../farming.json";
import farmed2 from "../farming2.json";
import farmed3 from "../farming3.json";
import farmed4 from "../farming4.json";
import farmed5 from "../farming5.json";
import farmed6 from "../farming6.json";
import farmed7 from "../farming7.json";
import farmed8 from "../farming8.json";
import farmed9 from "../farming9.json";
import farmed10 from "../farming10.json";
import farmed11 from "../farming11.json";
import farmed12 from "../farming12.json";
import farmed13 from "../farming13.json";
import farmed14 from "../farming14.json";

import { ethers, network } from "hardhat";
import { chunk } from "lodash";
import contracts from "../releases/deployment.json";
import { bulkIsWhitelisted } from "./utils";
const main = async () => {
  const signer = (await ethers.getSigners())[0];

  console.log("signer", signer.address);
  if (signer.address !== "0x88c11F1fFF51a7D3843Bdf1D9d16eafAda01e0f0") {
    console.error("Please use the correct signer with the ADMIN_KEY environment variable");
    return;
  }
  const whitelist = await ethers.getContractAt("BulkWhitelist", contracts[network.name].BulkWhitelist);
  const notReVerified = farmed14.filter(
    addr =>
      !(
        farmed13.includes(addr) ||
        farmed12.includes(addr) ||
        farmed11.includes(addr) ||
        farmed10.includes(addr) ||
        farmed9.includes(addr) ||
        farmed8.includes(addr) ||
        farmed7.includes(addr) ||
        farmed6.includes(addr) ||
        farmed5.includes(addr) ||
        farmed.includes(addr) ||
        farmed2.includes(addr) ||
        farmed3.includes(addr) ||
        farmed4.includes(addr)
      )
  );
  console.log(`not re-verified count out of ${farmed14.length}:`, notReVerified.length);
  const chunks = chunk(notReVerified, 100).slice(0);
  let nonce = await signer.getTransactionCount();
  let batchSize = 2;
  let gasLimit = 6000000;
  let txs = [];
  console.log("starting nonce:", nonce);
  switch (network.name) {
    case "production-celo":
      batchSize = 10; // to avoid tx replacement
      break;
    case "production-xdc":
      batchSize = 20;
      gasLimit = 10000000;

      break;
    case "production":
      batchSize = 10;
      break;
  }
  for (let batch of chunks) {
    console.log("remove whitelisting batch of", batch.length, batch[0], batch[batch.length - 1], { nonce });
    if (batchSize > 1) {
      txs.push(
        whitelist
          .connect(signer)
          .removeWhitelisted(batch, { gasLimit, nonce: nonce++ })
          .then(_ => _.wait())
      );
      if (txs.length < batchSize && batch.length === 100) continue;
      console.log("queued txs:", txs.length);
      const results = await Promise.allSettled(txs);
      const success = results.filter(r => r.status === "fulfilled").map(_ => _.value);
      console.log(
        `completed txs: ${success.length}/${txs.length}`,
        success.map(r => r.transactionHash)
      );
      nonce = await signer.getTransactionCount();

      txs = [];
    } else {
      const res = await (await whitelist.connect(signer).removeWhitelisted(batch, { gasLimit })).wait();
      console.log("tx:", res.transactionHash);
    }
  }
};

const checkReVerified = async () => {
  // get intersection of farmed and farmed2
  const reVerified = farmed3.filter(addr => farmed.includes(addr) || farmed2.includes(addr));
  console.log("re-verified count:", reVerified.length);
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
// checkReVerified();
main().catch(console.log);
