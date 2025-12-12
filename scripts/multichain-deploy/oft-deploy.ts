/***
 * Deployment script for GoodDollar OFT (Omnichain Fungible Token) contracts
 * 
 * Deploys:
 * 1. GoodDollarMinterBurner - Contract that handles minting and burning of GoodDollar tokens for OFT
 * 2. GoodDollarOFTAdapter - LayerZero OFT adapter that wraps GoodDollar token for cross-chain transfers
 * 
 * Steps:
 * 1. Deploy GoodDollarMinterBurner with token address and owner
 * 2. Deploy GoodDollarOFTAdapter with token, minterBurner, LayerZero endpoint, and owner
 * 3. Set OFT adapter as operator on GoodDollarMinterBurner
 */

import { network, ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { defaultsDeep } from "lodash";

import {
  deployDeterministic,
  printDeploy,
  verifyProductionSigner
} from "./helpers";
import releaser from "../../scripts/releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
// Types will be inferred from contract instances

const { name: networkName } = network;

export const deployOFTContracts = async () => {
  const isProduction = networkName.includes("production");
  let [root] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let release: { [key: string]: any } = dao[networkName];
  let settings = ProtocolSettings[networkName];

  console.log("got signers:", {
    networkName,
    root: root.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  // Get token address - try SuperGoodDollar first, then GoodDollar
  const tokenAddress = release.GoodDollar;
  if (!tokenAddress) {
    throw new Error(`Token address not found in deployment.json for network ${networkName}. Please deploy SuperGoodDollar or GoodDollar first.`);
  }

  // Get owner - use Avatar if available, otherwise use deployer
  const owner = root.address;

  console.log("settings:", settings);
  // Get LayerZero endpoint from settings or environment variable
  const lzEndpoint = settings.layerZero?.endpoint;
  if (!lzEndpoint) {
    throw new Error(`LayerZero endpoint not found. Please set it in deploy-settings.json under layerZero.endpoint or set LAYERZERO_ENDPOINT environment variable.`);
  }

  console.log("Deployment parameters:", {
    tokenAddress,
    owner,
    lzEndpoint,
    networkName
  });

  // Deploy GoodDollarMinterBurner
  let MinterBurner: Contract;
  if (!release.GoodDollarMinterBurner) {
    console.log("Deploying GoodDollarMinterBurner...");
    MinterBurner = (await deployDeterministic(
      {
        name: "GoodDollarMinterBurner",
        isUpgradeable: false
      },
      [tokenAddress, owner]
    ).then(printDeploy)) as Contract;

    let torelease = {
      GoodDollarMinterBurner: MinterBurner.address
    };

    await releaser(torelease, networkName, "deployment", false);
    console.log("GoodDollarMinterBurner deployed to:", MinterBurner.address);
  } else {
    console.log("GoodDollarMinterBurner already deployed at:", release.GoodDollarMinterBurner);
    MinterBurner = await ethers.getContractAt("GoodDollarMinterBurner", release.GoodDollarMinterBurner);
  }

  // Deploy GoodDollarOFTAdapter
  let OFTAdapter: Contract;
  if (!release.GoodDollarOFTAdapter) {
    console.log("Deploying GoodDollarOFTAdapter...");
    OFTAdapter = (await deployDeterministic(
      {
        name: "GoodDollarOFTAdapter",
        isUpgradeable: false
      },
      [tokenAddress, MinterBurner.address, lzEndpoint, owner]
    ).then(printDeploy)) as Contract;

    let torelease = {
      GoodDollarOFTAdapter: OFTAdapter.address
    };

    await releaser(torelease, networkName, "deployment", false);
    console.log("GoodDollarOFTAdapter deployed to:", OFTAdapter.address);
  } else {
    console.log("GoodDollarOFTAdapter already deployed at:", release.GoodDollarOFTAdapter);
    OFTAdapter = await ethers.getContractAt("GoodDollarOFTAdapter", release.GoodDollarOFTAdapter);
  }

  // Set OFT adapter as operator on MinterBurner if not already set
  // Only if deployer is the owner (not if owner is Avatar/DAO)
  const isOperator = await MinterBurner.operators(OFTAdapter.address);
  const currentOwner = await MinterBurner.owner();
  const deployerAddress = root.address;
  
  if (!isOperator) {
    if (currentOwner.toLowerCase() === deployerAddress.toLowerCase()) {
      console.log("Setting OFT adapter as operator on MinterBurner...");
      const tx = await MinterBurner.setOperator(OFTAdapter.address, true);
      await printDeploy(tx);
      console.log("OFT adapter set as operator");
    } else {
      console.log("WARNING: Owner is not the deployer. Please set OFT adapter as operator manually via governance:");
      console.log(`  MinterBurner.setOperator(${OFTAdapter.address}, true)`);
      console.log(`  MinterBurner address: ${MinterBurner.address}`);
    }
  } else {
    console.log("OFT adapter is already an operator on MinterBurner");
  }

  console.log("\n=== Deployment Summary ===");
  console.log("Network:", networkName);
  console.log("GoodDollarMinterBurner:", MinterBurner.address);
  console.log("GoodDollarOFTAdapter:", OFTAdapter.address);
  console.log("Token:", tokenAddress);
  console.log("Owner:", owner);
  console.log("LayerZero Endpoint:", lzEndpoint);
  console.log("========================\n");

  return {
    MinterBurner: MinterBurner.address,
    OFTAdapter: OFTAdapter.address
  };
};

export const main = async () => {
  await deployOFTContracts();
};

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

