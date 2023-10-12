import fetch from "cross-fetch";
import fs from "fs";
import { chunk } from "lodash";
import { bulkIsWhitelisted } from "./utils";

const main = async () => {
  const data = JSON.parse(fs.readFileSync("fvtriplets.tx").toString());
  const triplets = chunk(data, 3);
  const accounts = triplets.map(_ => _[0]);
  const whitelisted = await bulkIsWhitelisted(accounts);
  const failed = triplets.filter(_ => whitelisted.includes(_[0]) === false);
  console.log("Total accounts:", accounts.length);
  console.log("Total whitelisted:", whitelisted.length);
  console.log("Total failed re-auth:", failed.length);
  return;
  const ps = triplets.map(async a => {
    const i1 = await fetch("http://localhost:9090/enrollment-3d/" + a[1]).then(
      _ => _.json()
    );
    const i2 = await fetch("http://localhost:9090/enrollment-3d/" + a[2]).then(
      _ => _.json()
    );
    if (i1.auditTrailBase64 && i2.auditTrailBase64) {
      fs.writeFileSync(a.join("_") + "-a.jpg", i1.auditTrailBase64, {
        encoding: "base64"
      });
      fs.writeFileSync(a.join("_") + "-b.jpg", i2.auditTrailBase64, {
        encoding: "base64"
      });
    } else console.log("not found", a);
  });

  await Promise.all(ps);
};

main();
