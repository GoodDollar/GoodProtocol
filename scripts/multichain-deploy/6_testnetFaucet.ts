/***
 * Deploy helper contracts
 * AdminWallet, Faucet, Invites
 */
import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import { deployDeterministic, verifyProductionSigner, verifyContract } from "./helpers";
import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { TransactionResponse } from "@ethersproject/providers";

const { name } = network;

const printDeploy = async (c: Contract | TransactionResponse): Promise<Contract | TransactionResponse> => {
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

export const deployHelpers = async () => {
  let protocolSettings = defaultsDeep({}, ProtocolSettings[network.name], ProtocolSettings["default"]);

  let release: { [key: string]: any } = dao[network.name];

  let [root] = await ethers.getSigners();
  const isProduction = network.name.includes("production");

  if (isProduction) verifyProductionSigner(root);

  //generic call permissions
  let schemeMock = root;

  console.log("got signers:", {
    network,
    root: root.address,
    schemeMock: schemeMock.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  const GDFaucet = release.GDFaucet
    ? await ethers.getContractAt("GDFaucet", release.GDFaucet)
    : ((await deployDeterministic(
        {
          name: "GDFaucet",
          salt: "GDFaucet",
          isUpgradeable: false
        },
        [release.NameService, 10000]
      ).then(printDeploy)) as Contract);

  const torelease = {
    GDFaucet: GDFaucet.address
  };
  await releaser(torelease, network.name, "deployment", false);

  const controller = await ethers.getContractAt("Controller", release.Controller);

  const tx = await controller
    .registerScheme(GDFaucet.address, ethers.constants.HashZero, "0x00000001", release.Avatar)
    .then(printDeploy);

  console.log("TokenFaucet deployed and registered as a scheme via the controller");

  await verifyContract(
    GDFaucet.address,
    "GDFaucet",
    network.name,
    undefined,
    ethers.utils.defaultAbiCoder.encode(["address", "uint"], [release.NameService, 10000])
  );
};

export const main = async () => {
  await deployHelpers();
};
if (process.argv[1].includes("6_testnetFaucet")) main();
