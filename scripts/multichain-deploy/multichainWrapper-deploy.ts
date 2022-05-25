import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";

import { deployDeterministic } from "./helpers";
import releaser from "../../scripts/releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { TransactionResponse } from "@ethersproject/providers";

const INITIAL_CAP = 100000000000; //1B G$s
const { name } = network;

const printDeploy = async (
  c: Contract | TransactionResponse
): Promise<Contract | TransactionResponse> => {
  if (c instanceof Contract) {
    await c.deployed();
    console.log("deployed to: ", c.address);
  }
  if (c.wait) {
    await c.wait();
    console.log("tx done:", c.hash);
  }
  return c;
};

export const deployWrapper = async () => {
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

  const Wrapper = (await deployDeterministic(
    {
      name: "GoodDollarMintBurnWrapper",
      salt: "MintBurnWrapper",
      isUpgradeable: true
    },
    [
      release.GoodDollar,
      1,
      INITIAL_CAP,
      release.GuardiansSafe,
      release.NameService
    ]
  ).then(printDeploy)) as Contract;

  release = {
    MultichainWrapper: Wrapper.address
  };
  await releaser(release, network.name, "deployment", false);
};

export const main = async (networkName = name) => {
  await deployWrapper().catch(console.log);
};
main();
