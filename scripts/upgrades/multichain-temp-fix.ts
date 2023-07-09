/***
 * Disable UBI bridge via multichain
 * Upgrade Plan:
 * - deploy new DistHelper
 * - disable multichain distribution
 * - create new distribution instead to guardians
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";

import { printDeploy, executeViaGuardian, executeViaSafe, verifyProductionSigner } from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
import { verifyContract } from "../multichain-deploy/helpers";
let { name: networkName } = network;

export const upgrade = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let guardian = root;
  // simulate on fork
  if (network.name === "hardhat") {
    networkName = "production-mainnet";
    root = await ethers.getImpersonatedSigner("0x5128E3C1f8846724cc1007Af9b4189713922E4BB");
  }

  let release: { [key: string]: any } = dao[networkName];
  let protocolSettings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);
  //make sure safe has enough eth to simulate txs
  if (network.name === "hardhat") {
    guardian = await ethers.getImpersonatedSigner(protocolSettings.guardiansSafe);
    await root.sendTransaction({ value: ethers.constants.WeiPerEther, to: protocolSettings.guardiansSafe });
  }

  console.log("got signers:", {
    networkName,
    root: root.address,
    guardian: guardian.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString()),
    guardianBalance: await ethers.provider.getBalance(guardian.address).then(_ => _.toString())
  });

  let networkEnv = networkName.split("-")[0];
  const fuseNetwork = networkEnv;
  if (networkEnv === "fuse") networkEnv = "development";
  const celoNetwork = networkEnv + "-celo";

  let f = await ethers.getContractFactory("GoodFundManager");
  console.log("bytecode", f.bytecode.length);
  let newDistHelper = (await ethers.deployContract("DistributionHelper").then(printDeploy)) as Contract;

  if (isProduction) await verifyContract(newDistHelper, "GoodReserveCDai", networkName);

  const proposalContracts = [
    release.DistributionHelper, //controller -> upgrade disthelper
    release.DistributionHelper, //set new distribution params
    release.DistributionHelper //set new distribution params
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)", //upgrade disthelper
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // remove multichain
    "addOrUpdateRecipient((uint32,uint32,address,uint8))" // guardians distribution
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [newDistHelper.address]),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [0, 42220, dao[celoNetwork].UBIScheme, 1]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [8182, 42220, release.GuardiansSafe, 3] //ubi to guardians
    )
  ];

  if (isProduction) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      protocolSettings.guardiansSafe,
      "mainnet"
    );
  } else {
    //simulation or dev envs
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkName
    );
  }

  if (!isProduction) {
    //check simulation results
    let fm = await ethers.getContractAt("GoodFundManager", release.GoodFundManager);
    let dh = await ethers.getContractAt("DistributionHelper", release.DistributionHelper);

    console.log(await dh.distributionRecipients(0));
    console.log(await dh.distributionRecipients(1));
    console.log(await dh.distributionRecipients(2));
    let tx = await (await fm.collectInterest(["0x7b7246c78e2f900d17646ff0cb2ec47d6ba10754"], true)).wait();
    let gd = await ethers.getContractAt("IGoodDollar", "0x67C5870b4A41D4Ebef24d2456547A03F1f3e094B");
    const safeBalance = await gd.balanceOf("0xE0c5daa7CC6F88d29505f702a53bb5E67600e7Ec");
    console.log({ safeBalance }, tx.events);
  }
};

export const main = async () => {
  await upgrade().catch(console.log);
};
if (process.argv[1].includes("multichain-temp-fix")) main();
