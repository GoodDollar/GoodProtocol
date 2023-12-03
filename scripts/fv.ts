import fetch from "cross-fetch";
import fs from "fs";
import { chunk, uniqBy } from "lodash";
import { bulkIsWhitelisted, bulkLastAuth } from "./utils";

const main = async () => {
  const data = JSON.parse(fs.readFileSync("fvtriplets.txt").toString());
  const triplets = uniqBy(chunk(data, 3), _ => _.join("_"));

  const accounts = triplets.map(_ => _[0]);
  const whitelisted = await bulkIsWhitelisted(accounts);
  const failed = triplets.filter(_ => whitelisted.includes(_[0]) === false);
  console.log("Total accounts:", accounts.length);
  console.log("Total whitelisted:", whitelisted.length);
  console.log("Total failed re-auth:", failed.length);
  const notfetched = triplets.filter(a => {
    const key = "fvimages/" + a.join("_") + "-a.jpg";
    return fs.existsSync(key) === false;
  });
  console.log({ notfetched });
  const ps = notfetched.map(async a => {
    const i1 = await fetch("http://localhost:9090/enrollment-3d/" + a[1]).then(
      _ => _.json()
    );
    const i2 = await fetch("http://localhost:9090/enrollment-3d/" + a[2]).then(
      _ => _.json()
    );
    if (i1.auditTrailBase64 && i2.auditTrailBase64) {
      fs.writeFileSync(
        "fvimages/" + a.join("_") + "-a.jpg",
        i1.auditTrailBase64,
        {
          encoding: "base64"
        }
      );
      fs.writeFileSync(
        "fvimages/" + a.join("_") + "-b.jpg",
        i2.auditTrailBase64,
        {
          encoding: "base64"
        }
      );
    } else
      console.log("not found", a, !!i1.auditTrailBase64, !!i2.auditTrailBase64);
  });

  await Promise.all(ps);
};

const deleteIdentifiers = async () => {
  const data = JSON.parse(fs.readFileSync("todeletefvtriplets.txt").toString());
  const triplets = uniqBy(chunk(data, 3), _ => _.join("_"));
  const accounts = triplets.map(_ => _[0]);
  const whitelisted = await bulkIsWhitelisted(accounts);
  const lastAuth = await bulkLastAuth(accounts);
  const failed = triplets.filter(
    _ =>
      whitelisted.includes(_[0]) === false && lastAuth.includes(_[0]) === true
  );

  let ps = [];
  console.log({ failed });

  for (let record of failed) {
    ps.push(
      fetch("https://goodserver.gooddollar.org/admin/verify/face/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password,
          enrollmentIdentifier: record[1]
        })
      })
        .then(_ => _.json())
        .catch(_ => record[1])
    );
    ps.push(
      fetch("https://goodserver.gooddollar.org/admin/verify/face/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password,
          enrollmentIdentifier: record[2]
        })
      })
        .then(_ => _.json())
        .catch(_ => record[2])
    );
    if (ps.length % 10 === 0) {
      console.log("waiting...", ps.length);
      const r = await Promise.all(ps);
      console.log(r);
      ps = [];
    }
  }
  const res = await Promise.all(ps);
  console.log(res);
};

deleteIdentifiers();
// main();
