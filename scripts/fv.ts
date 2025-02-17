import fs from "fs";
import { chunk, uniqBy } from "lodash";
import delay from "delay";
import { bulkIsWhitelisted, bulkLastAuth } from "./utils";

//create tunnel to fv server ssh -L 9090:server:8080 -N user@server -i sshkey

const saveImage = async (id, idx) => {
  const age = await fetch("http://localhost:9090/estimate-age-3d-v2", {
    method: "POST",
    body: JSON.stringify({ externalDatabaseRefID: id }),
    headers: { "content-type": "applcation/json" }
  }).then(_ => _.json());
  console.log({ age });
  const i1 = await fetch("http://localhost:9090/enrollment-3d/" + id).then(_ => _.json());
  fs.writeFileSync("fvimages/" + id + "_" + idx + ".jpg", i1.auditTrailBase64, {
    encoding: "base64"
  });
};
const saveImages = async a => {
  const i1 = await fetch("http://localhost:9090/enrollment-3d/" + a[1]).then(_ => _.json());
  const i2 = await fetch("http://localhost:9090/enrollment-3d/" + a[2]).then(_ => _.json());
  if (i1.auditTrailBase64 && i2.auditTrailBase64) {
    fs.writeFileSync("fvimages/" + a.join("_") + "-a.jpg", i1.auditTrailBase64, {
      encoding: "base64"
    });
    fs.writeFileSync("fvimages/" + a.join("_") + "-b.jpg", i2.auditTrailBase64, {
      encoding: "base64"
    });
  } else console.log("not found", a, !!i1.auditTrailBase64, !!i2.auditTrailBase64);
};

const main = async () => {
  const data = JSON.parse(fs.readFileSync("fvtriplets2.txt").toString());
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
  const ps = notfetched.map(saveImages);

  await Promise.all(ps);
};

// check which ids have been indexed, if not then make sure they are whitelisted
const checkIndexedOrDelete = async () => {
  const data = JSON.parse(
    "[" + fs.readFileSync("fvids.json").toString().replace(/\n$/, "").replaceAll(/\n/g, ",\n") + "]"
  );
  const triplets = uniqBy(data, _ => _["wallet"]);

  const accounts = triplets.map(_ => _["wallet"]);
  console.log("Total accounts:", accounts.length, accounts[0]);
  let whitelisted = [];
  for (let batch of chunk(accounts, 200)) {
    whitelisted.push(...(await bulkIsWhitelistedFuse(batch)));
  }
  const failed = triplets.filter(_ => whitelisted.includes(_["wallet"]) === false);

  console.log("Total whitelisted:", whitelisted.length);
  console.log("Total not whitelisted:", failed.length);
  let ps = [];

  ps = [];
  for (let record of triplets) {
    const isEnrolled = fetch("http://localhost:9090/enrollment-3d/" + record["identifier"].slice(0, 42))
      .then(_ => _.json())
      .then(_ => _.success);
    // const isEnrolled = "unknown";
    const isIndexed = fetch("http://localhost:9090/3d-db/get", {
      method: "POST",
      body: JSON.stringify({ identifier: record["identifier"].slice(0, 42), groupName: "GoodDollar" })
    })
      .then(_ => _.json())
      .then(_ => _.success);

    ps.push(
      Promise.all([isEnrolled, isIndexed]).then(_ => ({
        ...record,
        isEnrolled: _[0],
        isIndexed: _[1],
        isWhitelisted: whitelisted.includes(record.wallet)
      }))
    );
    if (ps.length % 50 === 0) {
      console.log("waiting...", ps.length);
      await Promise.all(ps);
    }
  }
  console.log("waiting...", ps.length);
  const r = await Promise.all(ps);
  const toDelete = r.filter(
    _ => (_.isWhitelisted && (!_.isEnrolled || !_.isIndexed)) || (!_.isWhitelisted && _.isIndexed && !_.isEnrolled)
  );
  const toWhitelist = r.filter(_ => !_.isWhitelisted && _.isEnrolled && _.isIndexed);

  console.log("toDelete:", toDelete.length);

  console.log("toWhitelist:", toWhitelist.length);
  fs.writeFileSync("fvIndexedOrEnrolled.json", JSON.stringify(r));
};

const fixInvalidIndexed = async () => {
  const indexedOrEnrolled = JSON.parse(fs.readFileSync("fvIndexedOrEnrolled.json").toString());
  const toDelete = indexedOrEnrolled.filter(
    _ => (_.isWhitelisted && (!_.isEnrolled || !_.isIndexed)) || (!_.isWhitelisted && _.isIndexed && !_.isEnrolled)
  );
  const toWhitelist = indexedOrEnrolled.filter(_ => !_.isWhitelisted && _.isEnrolled && _.isIndexed);

  console.log("toDelete:", toDelete.length);

  console.log("toWhitelist:", toWhitelist.length);

  console.log(toWhitelist);
  return;
  let ps = [];
  for (let record of toWhitelist) {
    ps.push(fetch(`https://goodserver.gooddollar.org/syncWhitelist/${record.wallet}`).then(_ => _.json()));
    if (ps.length > 0 && ps.length % 3 === 0) {
      console.log("waiting...", ps.length);
      await Promise.all(ps).catch(e => console.log(e));
      console.log("waiting 60 seconds for rate limit");
      await delay(50000);
    }
  }
  if (ps.length > 0) {
    console.log("waiting...", ps.length);
    await Promise.all(ps).catch(e => console.log(e));
  }

  const removeWhitelist = toDelete.filter(_ => _.isWhitelisted).map(_ => _.wallet);
  // removeWhitelist.push(...toWhitelist.map(_ => _.wallet));
  ps = [];
  for (let record of toDelete) {
    if (record.isIndexed) {
      // console.log("removing record from index and queuing for whitelist removal", record.wallet);
      const isIndexed = fetch("http://localhost:9090/3d-db/delete", {
        method: "POST",
        body: JSON.stringify({ identifier: record["identifier"].slice(0, 42), groupName: "GoodDollar" })
      }).then(_ => _.json());

      ps.push(
        isIndexed.then(_ => {
          if (!_.success) throw new Error(`delete index failed: ${record.wallet}`);
        })
      );
    }
    if (ps.length > 0 && ps.length % 10 === 0) {
      console.log("waiting...", ps.length);
      await Promise.all(ps).catch(e => console.log(e));
    }
  }
  console.log("waiting...", ps.length);
  await Promise.all(ps).catch(e => console.log(e));
  console.log({ removeWhitelist }, removeWhitelist.length);
  fs.writeFileSync("removeWhitelist.json", JSON.stringify(removeWhitelist));
};

const deleteIdentifiers = async password => {
  const data = JSON.parse(fs.readFileSync("fvtriplets2.txt").toString());
  const triplets = uniqBy(chunk(data, 3), _ => _.join("_"));
  const accounts = triplets.map(_ => _[0]);
  const whitelisted = await bulkIsWhitelisted(accounts);
  const lastAuth = await bulkLastAuth(accounts);
  console.log(
    "no last auth",
    Object.entries(lastAuth).filter(_ => _[1] === 0)
  );
  const dateYearsAgo = new Date();
  dateYearsAgo.setFullYear(dateYearsAgo.getFullYear() - 3);
  const failed = triplets.filter(
    _ => whitelisted.includes(_[0]) === false && lastAuth[_[0]] > 0 && lastAuth[_[0]] < dateYearsAgo.getTime() / 1000
  );

  let ps = [];
  console.log("old lastauth:", failed.length, "out of:", triplets.length);
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

const exportScans = async ids => {
  console.log(ids.length, "unique:", uniqBy(ids).length);
  const exports = ids.map(async (_, idx) => {
    if (fs.existsSync("fvimages/" + idx + ".jpg")) return;
    const { faceMapBase64, auditTrailBase64 } = await fetch("http://localhost:9090/enrollment-3d/" + _).then(_ =>
      _.json()
    );
    const { exportedFaceTecDataForDebugBase64 } = await fetch("http://localhost:9090/export-for-facetec/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faceScanOrFaceMapOrIDScan: faceMapBase64 })
    }).then(_ => _.json());
    console.log(_, exportedFaceTecDataForDebugBase64.length);
    fs.writeFileSync("fvimages/export_" + idx + ".txt", exportedFaceTecDataForDebugBase64);
    fs.writeFileSync("fvimages/" + idx + ".jpg", auditTrailBase64, {
      encoding: "base64"
    });
  });
  await Promise.all(exports);
};
// checkIndexedOrDelete();
// fixInvalidIndexed();
// console.log(process.env.ADMIN_PASSWORD);
// deleteIdentifiers(process.env.ADMIN_PASSWORD);
// main();
saveImages(["", "", ""]);
