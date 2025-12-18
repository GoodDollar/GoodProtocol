/***
 * Script to grant MINTER_ROLE to GoodDollarMinterBurner contract on development-celo
 * Uses genericCall through Avatar/Controller to execute the transaction
 * 
 * Usage:
 *   npx hardhat run scripts/grant-minter-role.ts --network development-celo
 * 
 * Note: This script must be run by a guardian or address with permissions to execute via Controller
 */

import { network, ethers } from "hardhat";
import { executeViaGuardian } from "./multichain-deploy/helpers";
import dao from "../releases/deployment.json";

const main = async () => {
  const networkName = network.name;
  const [signer] = await ethers.getSigners();

  console.log("=== Grant MINTER_ROLE to GoodDollarMinterBurner ===");
  console.log("Network:", networkName);
  console.log("Signer:", signer.address);
  console.log("Signer balance:", ethers.utils.formatEther(await ethers.provider.getBalance(signer.address)), "CELO");

  // Get deployment info
  const release = dao[networkName];
  if (!release) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }

  const tokenAddress = release.GoodDollar;
  const minterBurnerAddress = release.GoodDollarMinterBurner;
  const controllerAddress = release.Controller;
  const avatarAddress = release.Avatar;

  if (!tokenAddress) {
    throw new Error(`GoodDollar token not found in deployment.json for ${networkName}`);
  }

  if (!minterBurnerAddress) {
    throw new Error(`GoodDollarMinterBurner not found in deployment.json for ${networkName}`);
  }

  if (!controllerAddress) {
    throw new Error(`Controller not found in deployment.json for ${networkName}`);
  }

  if (!avatarAddress) {
    throw new Error(`Avatar not found in deployment.json for ${networkName}`);
  }

  console.log("\nContract addresses:");
  console.log("GoodDollar token:", tokenAddress);
  console.log("GoodDollarMinterBurner:", minterBurnerAddress);
  console.log("Controller:", controllerAddress);
  console.log("Avatar:", avatarAddress);

  // Get token contract to check current status
  const token = await ethers.getContractAt("SuperGoodDollar", tokenAddress);
  
  // Check if MinterBurner already has minter role
  const isMinter = await token.isMinter(minterBurnerAddress);
  console.log("\nCurrent status:");
  console.log("MinterBurner has MINTER_ROLE:", isMinter);

  if (isMinter) {
    console.log("\n✅ GoodDollarMinterBurner already has MINTER_ROLE. No action needed.");
    return;
  }

  // Prepare the generic call through Avatar
  // Function signature: addMinter(address)
  const functionSignature = "addMinter(address)";
  
  // Encode the function input (minterBurnerAddress)
  const abiCoder = ethers.utils.defaultAbiCoder;
  const functionInputs = abiCoder.encode(["address"], [minterBurnerAddress]);

  console.log("\nPreparing generic call:");
  console.log("Function:", functionSignature);
  console.log("Target contract:", tokenAddress);
  console.log("Parameter (minterBurner):", minterBurnerAddress);

  // Execute via guardian using the helper function
  // This will use Controller.genericCall() to execute through Avatar
  try {
    console.log("\nExecuting via Controller/Avatar...");
    await executeViaGuardian(
      [tokenAddress],           // contracts array
      ["0"],                    // ethValues array (0 for this call)
      [functionSignature],      // functionSigs array
      [functionInputs],         // functionInputs array
      signer,                   // guardian signer
      networkName               // network name
    );

    // Verify the role was granted
    console.log("\nVerifying role was granted...");
    const isMinterAfter = await token.isMinter(minterBurnerAddress);
    console.log("MinterBurner has MINTER_ROLE:", isMinterAfter);

    if (isMinterAfter) {
      console.log("\n✅ Successfully granted MINTER_ROLE to GoodDollarMinterBurner via Avatar!");
    } else {
      console.log("\n⚠️  Warning: MINTER_ROLE was not granted. Please check the transaction.");
    }

  } catch (error: any) {
    console.error("\n❌ Error granting MINTER_ROLE:");
    if (error.message) {
      console.error("Error message:", error.message);
    }
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    throw error;
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

