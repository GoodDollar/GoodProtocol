const fse = require("fs-extra");

module.exports = async function (
  deployment,
  network,
  filename = "deployment",
  log = true
) {
  const dir = "releases/";
  console.log("releaser:", { network, dir });
  const previousDeployment =
    (await fse.readJson(dir + `/${filename}.json`).catch(_ => {})) || {};
  await fse.ensureDir(dir);
  let finalDeployment = {
    ...previousDeployment,
    [network]: { ...previousDeployment[network], ...deployment }
  };
  log &&
    console.log("releaser:", {
      previousDeployment: previousDeployment[network],
      finalDeployment: finalDeployment[network]
    });
  return fse.writeJson(dir + `/${filename}.json`, finalDeployment);
};
