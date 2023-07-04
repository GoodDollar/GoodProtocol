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

  console.log("deploying onetime payments", { gasprice: protocolSettings.gasPrice });
  const OTP = (await deployDeterministic(
    {
      name: "OneTimePaymentsV2",
      salt: "OneTimePaymentsV2",
      isUpgradeable: false
    },
    [release.NameService]
  ).then(printDeploy)) as Contract;

  // const OTP = await ethers.getContractAt("OneTimePayments", release.OneTimePayments);

  const torelease = {
    OneTimePaymentsV2: OTP.address
  };
  await releaser(torelease, network.name, "deployment", false);

  const constructorArgs = ethers.utils.defaultAbiCoder.encode(["address"], [release.NameService]);
  await verifyContract(OTP.address, "OneTimePaymentsV2", network.name, undefined, constructorArgs);
};

export const main = async () => {
  await deployHelpers();
};
if (process.argv[1].includes("2b_otp-deploy")) main();
