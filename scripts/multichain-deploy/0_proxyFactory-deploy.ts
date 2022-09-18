import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";

import { deployDeterministic, printDeploy } from "./helpers";
import releaser from "../../scripts/releaser";
import dao from "../../releases/deployment.json";

const { name } = network;

export const deployProxy = async (defaultAdmin = null) => {
  let release: { [key: string]: any } = dao[network.name] || {};

  if (network.name.match(/production|staging|fuse/) && release.ProxyFactory) {
    throw new Error("ProxyFactory already exists for env");
  }
  let [root] = await ethers.getSigners();
  //generic call permissions
  let schemeMock = root;

  console.log("got signers:", {
    network,
    root: root.address,
    schemeMock: schemeMock.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then(_ => _.toString())
  });

  const proxyFactory = await (
    await ethers.getContractFactory("ProxyFactory1967")
  ).deploy();

  release = {
    ProxyFactory: proxyFactory.address
  };
  await releaser(release, network.name, "deployment", false);
};

export const main = async (networkName = name) => {
  await deployProxy().catch(console.log);
};

if (process.argv[1].includes("proxyFactory-deploy")) {
  main();
}
