import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";

import { deployDeterministic, printDeploy } from "./helpers";
import releaser from "../../scripts/releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";

const INITIAL_CAP = 100000000000; //1B G$s
const { name } = network;

export const deployWrapper = async (defaultAdmin = null) => {
  let release: { [key: string]: any } = dao[network.name];

  let [root, ...signers] = await ethers.getSigners();
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

  console.log("MintBurnWrapper deploy params:", [
    release.GoodDollar,
    defaultAdmin || release.GuardiansSafe,
    release.NameService
  ]);

  const Wrapper = (await deployDeterministic(
    {
      name: "GoodDollarMintBurnWrapper",
      salt: "MintBurnWrapper",
      isUpgradeable: true
    },
    [defaultAdmin || release.GuardiansSafe, release.NameService]
  ).then(printDeploy)) as Contract;

  release = {
    GoodDollarMintBurnWrapper: Wrapper.address
  };
  await releaser(release, network.name, "deployment", false);
  return Wrapper;
};

export const main = async (networkName = name) => {
  await deployWrapper().catch(console.log);
};

if (process.argv[1].includes("multichainWrapper")) {
  main();
}
