import hre, { network, ethers } from "hardhat";
import { Contract } from "ethers";

import { deployDeterministic, printDeploy, verifyProductionSigner } from "../multichain-deploy/helpers";

import dao from "../../releases/deployment.json";
import { verifyContract } from "../multichain-deploy/helpers";
import { Faucet, ProxyAdmin } from "../../types";

let { name: networkName } = network;

export const upgrade = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let guardian = root;
  const isNotFuse = networkName.includes("-");
  let release: { [key: string]: any } = dao[networkName];

  const artifact = await hre.artifacts.readArtifact(isNotFuse ? "Faucet" : "FuseFaucetV2");
  const result = await hre.deployments.deterministic("Faucet", {
    skipIfAlreadyDeployed: true,
    contract: artifact,
    from: root.address
  });
  const deployed = await result.deploy();

  console.log("new impl:", deployed.address);
  await verifyContract(
    deployed.address,
    isNotFuse ? "contracts/fuseFaucet/Faucet.sol:Faucet" : "contracts/fuseFaucet/FuseFaucetV2.sol:FuseFaucetV2",
    networkName
  );

  if (isNotFuse) {
    const old = await ethers.getContractAt("Faucet", release.Faucet);
    await old.upgradeTo(deployed.address).then(printDeploy);
  } else {
    const proxyadmin = (await ethers.getContractAt("ProxyAdmin", release.ProxyAdmin)) as ProxyAdmin;
    proxyadmin.upgrade(release.FuseFaucet, deployed.address).then(printDeploy);
  }
};

upgrade().catch(console.log);
