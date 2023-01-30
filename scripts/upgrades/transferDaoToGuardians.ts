/***
 * give genericcall to gaurdian safe, unregister deployer as scheme
 */
import { network, ethers, upgrades, run } from "hardhat";
import { defaultsDeep } from "lodash";

import {
  deployDeterministic,
  deploySuperGoodDollar,
  executeViaGuardian,
  printDeploy,
  verifyProductionSigner
} from "../multichain-deploy/helpers";
import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { Controller } from "../../types";

const main = async () => {
  let protocolSettings = defaultsDeep(
    {},
    ProtocolSettings[network.name],
    ProtocolSettings["default"]
  );

  let release: { [key: string]: any } = dao[network.name];
  const isProduction = network.name.includes("production");

  let [root] = await ethers.getSigners();
  const daoOwner = root.address;
  if (isProduction) verifyProductionSigner(root);

  console.log("got signers:", {
    network,
    daoOwner,
    root: root.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then(_ => _.toString()),
    release
  });

  if (isProduction) {
    const ctrl = (await ethers.getContractAt(
      "Controller",
      release.Controller
    )) as Controller;
    await ctrl
      .registerScheme(
        protocolSettings.guardiansSafe,
        ethers.constants.HashZero,
        "0x0000001f",
        release.Avatar
      )
      .then(printDeploy);
    await ctrl.unregisterSelf(release.Avatar).then(printDeploy);
  } else {
    console.log("simulating transfer...");
    const ctrl = (await ethers.getContractAt(
      "Controller",
      release.Controller
    )) as Controller;
    console.log(
      "register safe result:",
      await ctrl.callStatic.registerScheme(
        protocolSettings.guardiansSafe,
        ethers.constants.HashZero,
        "0x0000001f",
        release.Avatar
      )
    );

    console.log(
      "unregister result",
      await ctrl.callStatic.unregisterSelf(release.Avatar)
    );
  }
};

main();
