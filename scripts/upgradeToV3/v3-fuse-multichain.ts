/***
 * This script will deploy a reserve upgrade and the DistributionHelper so that some of the expansion can be allocated
 * for non-ubi purposes
 * Upgrade process:
 * mainnet:
 * - deploy reserve
 * - deploy distributionHelper
 * - create proposal that:
 *  - upgrades the reserve
 *  - sets the distributionHelper at reserve with the agreed bps
 *  - add to the distributionHelper the contracts addresses to receive part of the UBI
 */

import { network, ethers } from "hardhat";
import { defaultsDeep } from "lodash";
import {
  deployDeterministic,
  printDeploy,
  executeViaGuardian,
  executeViaSafe,
  verifyProductionSigner
} from "../multichain-deploy/helpers";
import { deployWrapper } from "../multichain-deploy/multichainWrapper-deploy";

import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { BigNumber } from "ethers";
const { name: networkName } = network;

export const deployFuse = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let executionMethod = "safe";

  const networkKey = networkName === "localhost" ? "production-mainnet" : networkName;
  let release: { [key: string]: any } = dao[networkKey];
  let settings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

  console.log("got signers:", {
    networkName,
    networkKey,
    root: root.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  const Wrapper = await deployWrapper();
  // const Wrapper = await ethers.getContractAt("GoodDollarMintBurnWrapper", release.GoodDollarMintBurnWrapper);

  const proposalContracts = [
    release.NameService, //nameservice add Wrapper,MultiChainRouter
    release.GoodDollar, // give mint rights to Wrapper
    Wrapper.address //add multichainrouter as minter
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setAddresses(bytes32[],address[])",
    "addMinter(address)",
    "addMinter(address,uint256,uint256,uint32,uint256,uint256,uint32,bool)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32[]", "address[]"],
      [
        [
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTBURN_WRAPPER")),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MULTICHAIN_ROUTER"))
        ],
        [Wrapper.address, release.MultichainRouter]
      ]
    ), //setAddresses(bytes32[],address[])"
    ethers.utils.defaultAbiCoder.encode(["address"], [Wrapper.address]), //addMinter(address)
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "uint256", "uint32", "uint256", "uint256", "uint32", "bool"],
      [
        release.MultichainRouter,
        0,
        0,
        0,
        0,
        300 * 1e6 * 100, //300M G$ 2 decimals
        1000, //10%
        false
      ]
    ) //addMinter(address,uint256,uint256,uint32,uint256,uint256,uint32,bool)
  ];

  if (executionMethod === "safe") {
    return executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      networkName === "localhost" ? "0xE0c5daa7CC6F88d29505f702a53bb5E67600e7Ec" : release.GuardiansSafe,
      "fuse"
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
  await deployFuse().catch(console.log);
};
if (process.argv[1].includes("v3-fuse-multichain")) main();
