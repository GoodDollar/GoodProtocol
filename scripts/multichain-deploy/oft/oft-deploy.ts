/***
 * Deployment script for GoodDollar OFT (Omnichain Fungible Token) contracts
 * 
 * Deploys:
 * 1. GoodDollarMinterBurner - DAO-upgradeable contract that handles minting and burning of GoodDollar tokens for OFT
 * 2. GoodDollarOFTAdapter - Non-upgradeable LayerZero OFT adapter that wraps GoodDollar token for cross-chain transfers
 * 
 * Steps:
 * 1. Deploy GoodDollarMinterBurner as upgradeable proxy with token address and NameService
 * 2. Deploy GoodDollarOFTAdapter (non-upgradeable) with token, minterBurner, LayerZero endpoint, and owner (avatar)
 * 3. Set OFT adapter as operator on GoodDollarMinterBurner via DAO
 */

import { network, ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { defaultsDeep } from "lodash";

import {
  deployDeterministic,
  printDeploy,
  verifyProductionSigner
} from "../helpers";
import releaser from "../../../scripts/releaser";
import ProtocolSettings from "../../../releases/deploy-settings.json";
import dao from "../../../releases/deployment.json";
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

  // Get NameService for DAO integration
  const nameServiceAddress = release.NameService;
  if (!nameServiceAddress) {
    throw new Error(`NameService address not found in deployment.json for network ${networkName}. Please deploy NameService first.`);
  }
  const NameService = await ethers.getContractAt("NameService", nameServiceAddress);

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

  // Deploy GoodDollarMinterBurner (upgradeable)
  let MinterBurner: Contract;
  if (!release.GoodDollarMinterBurner) {
    console.log("Deploying GoodDollarMinterBurner as upgradeable contract...");
    MinterBurner = (await deployDeterministic(
      {
        name: "GoodDollarMinterBurner",
        isUpgradeable: true,
        initializer: "initialize"
      },
      [tokenAddress, nameServiceAddress]
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

  // Get Controller and Avatar addresses (used for OFT adapter owner and operator setup)
  const Controller = await ethers.getContractAt("Controller", await NameService.getAddress("CONTROLLER"));
  const avatarAddress = await Controller.avatar();

  // Deploy GoodDollarOFTAdapter (non-upgradeable)
  let OFTAdapter: Contract;
  if (!release.GoodDollarOFTAdapter) {
    console.log("Deploying GoodDollarOFTAdapter (non-upgradeable)...");
    
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
    console.log("Owner set to DAO avatar:", avatarAddress);
  } else {
    console.log("GoodDollarOFTAdapter already deployed at:", release.GoodDollarOFTAdapter);
    OFTAdapter = await ethers.getContractAt("GoodDollarOFTAdapter", release.GoodDollarOFTAdapter);
  }

  // Set OFT adapter as operator on MinterBurner if not already set
  // This must be done via DAO governance since MinterBurner is DAO-controlled
  const isOperator = await MinterBurner.operators(OFTAdapter.address);
  
  if (!isOperator) {
    console.log("Setting OFT adapter as operator on MinterBurner via DAO...");
    console.log(`  MinterBurner address: ${MinterBurner.address}`);
    console.log(`  OFTAdapter address: ${OFTAdapter.address}`);
    
    // Encode the setOperator function call
    const setOperatorEncoded = MinterBurner.interface.encodeFunctionData("setOperator", [
      OFTAdapter.address,
      true
    ]);
    
    // Execute via Controller/Avatar
    try {
      const tx = await Controller.genericCall(
        MinterBurner.address,
        setOperatorEncoded,
        avatarAddress,
        0
      );
      await tx.wait();
      console.log("✅ Successfully set OFT adapter as operator on MinterBurner");
      console.log("Transaction hash:", tx.hash);
      
      // Verify it was set
      const isOperatorAfter = await MinterBurner.operators(OFTAdapter.address);
      if (isOperatorAfter) {
        console.log("✅ Verified: OFT adapter is now an operator");
      } else {
        console.log("⚠️  Warning: Operator status not set. Please check the transaction.");
      }
    } catch (error: any) {
      console.error("❌ Error setting operator:");
      if (error.message) {
        console.error("Error message:", error.message);
      }
      if (error.reason) {
        console.error("Reason:", error.reason);
      }
      throw error;
    }
  } else {
    console.log("OFT adapter is already an operator on MinterBurner");
  }

  console.log("\n=== Deployment Summary ===");
  console.log("Network:", networkName);
  console.log("GoodDollarMinterBurner:", MinterBurner.address, "(upgradeable)");
  console.log("GoodDollarOFTAdapter:", OFTAdapter.address, "(non-upgradeable)");
  console.log("Token:", tokenAddress);
  console.log("OFT Adapter Owner (Avatar):", avatarAddress);
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

