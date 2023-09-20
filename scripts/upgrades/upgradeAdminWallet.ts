import { network, ethers } from "hardhat";
import { Contract } from "ethers";

import { printDeploy, verifyProductionSigner } from "../multichain-deploy/helpers";

import dao from "../../releases/deployment.json";
import { verifyContract } from "../multichain-deploy/helpers";

let { name: networkName } = network;

export const upgrade = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let guardian = root;
  const isCelo = networkName.includes("celo");
  let release: { [key: string]: any } = dao[networkName];

  const deployed = await ethers.deployContract(isCelo ? "AdminWallet" : "AdminWalletFuse");
  console.log("new impl:", deployed.address);
  await verifyContract(deployed.address, isCelo ? "AdminWallet" : "AdminWalletFuse", networkName);
  const old = await ethers.getContractAt("AdminWallet", release.AdminWallet);
  await old.upgradeTo(deployed.address).then(printDeploy);
  await deployed.attach(release.AdminWallet).upgrade().then(printDeploy);
};

upgrade().catch(console.log);
