/***
 * This script will deploy a fixed goodfundmanager that doenst disable staking contracts if rewards=0
 * It will also then re submit the staking contracts
 */

import { network, ethers } from "hardhat";

import {
  executeViaGuardian,
  executeViaSafe
} from "../multichain-deploy/helpers";

import releaser from "../releaser";
import dao from "../../releases/deployment.json";
const { name: networkName } = network;

export const deployMainnet = async () => {
  let [root, ...signers] = await ethers.getSigners();

  let executionMethod = networkName === "localhost" ? "guardians" : "safe";

  const networkKey =
    networkName === "localhost" ? "production-mainnet" : networkName;
  let release: { [key: string]: any } = dao[networkKey];

  let safeOwner = new ethers.Wallet(
    process.env.SAFEOWNER_PRIVATE_KEY || ethers.constants.HashZero,
    ethers.provider
  );

  //test with guardians safe on hardhat mainnet fork
  if (network.name === "localhost") {
    root = await ethers.getImpersonatedSigner(
      "0xE0c5daa7CC6F88d29505f702a53bb5E67600e7Ec"
    );
    await signers[0].sendTransaction({
      to: root.address,
      value: ethers.constants.WeiPerEther
    });
  }

  console.log("got signers:", {
    networkName,
    networkKey,
    root: root.address,
    safeOwner: safeOwner.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then(_ => _.toString())
  });

  console.log("deploying goodfundmanager implementation");
  const gfmImpl = await (
    await ethers.getContractFactory("GoodFundManager")
  ).deploy();

  const proposalContracts = [
    release.GoodFundManager, //Fundmanager -> upgrade to new version
    release.GoodFundManager, //Fundmanager -> set staking rewards compound to 0
    release.GoodFundManager //Fundmanager -> set staking rewards aave to 0
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)",
    "setStakingReward(uint32,address,uint32,uint32,bool)",
    "setStakingReward(uint32,address,uint32,uint32,bool)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [gfmImpl.address]), //upgradeTo(address)
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "address", "uint32", "uint32", "bool"],
      [
        "0",
        "0x7b7246c78e2f900d17646ff0cb2ec47d6ba10754",
        "14338692",
        "4294967295",
        false
      ]
    ), //setstakingrewards to 0
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "address", "uint32", "uint32", "bool"],
      [
        "0",
        "0x3ff2d8eb2573819a9ef7167d2ba6fd6d31b17f4f",
        "14338692",
        "4294967295",
        false
      ]
    ) //setstakingrewards to 0
  ];

  if (executionMethod === "safe") {
    return executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      networkName === "localhost"
        ? "0xE0c5daa7CC6F88d29505f702a53bb5E67600e7Ec"
        : release.GuardiansSafe,
      safeOwner
    );
  } else {
    return executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      root
    );
  }
};

export const main = async () => {
  await deployMainnet().catch(console.log);
};
if (process.argv[1].includes("v3-fix")) main();
