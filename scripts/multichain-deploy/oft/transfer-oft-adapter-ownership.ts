/***
 * Script to transfer ownership of GoodDollarOFTAdapter to DAO Avatar
 * 
 * Usage:
 *   npx hardhat run scripts/multichain-deploy/oft/transfer-oft-adapter-ownership.ts --network development-celo
 * 
 * Note: This script must be run by the current owner of the OFT adapter.
 * If the current owner is not the signer, you'll need to run this script from the owner's account.
 */

import { network, ethers } from "hardhat";
import dao from "../../../releases/deployment.json";

const main = async () => {
  const networkName = network.name;
  const [signer] = await ethers.getSigners();

  console.log("=== Transfer GoodDollarOFTAdapter Ownership to Avatar ===");
  console.log("Network:", networkName);
  console.log("Signer:", signer.address);
  console.log("Signer balance:", ethers.utils.formatEther(await ethers.provider.getBalance(signer.address)), "ETH/CELO");

  // Get deployment info
  const release = dao[networkName];
  if (!release) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }

  const oftAdapterAddress = release.GoodDollarOFTAdapter;
  const avatarAddress = release.Avatar;

  if (!oftAdapterAddress) {
    throw new Error(`GoodDollarOFTAdapter not found in deployment.json for ${networkName}`);
  }

  if (!avatarAddress) {
    throw new Error(`Avatar not found in deployment.json for ${networkName}`);
  }

  console.log("\nContract addresses:");
  console.log("GoodDollarOFTAdapter:", oftAdapterAddress);
  console.log("Avatar:", avatarAddress);

  // Get OFT adapter contract
  const oftAdapter = await ethers.getContractAt("GoodDollarOFTAdapter", oftAdapterAddress);
  
  // Get current owner
  const currentOwner = await oftAdapter.owner();
  console.log("\nCurrent owner:", currentOwner);
  console.log("Target owner (Avatar):", avatarAddress);

  // Check if already owned by Avatar
  if (currentOwner.toLowerCase() === avatarAddress.toLowerCase()) {
    console.log("\n✅ GoodDollarOFTAdapter is already owned by Avatar. No action needed.");
    return;
  }

  // Check if signer is the current owner
  if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
    console.log("\n❌ Error: Current owner is not the signer.");
    console.log(`Current owner: ${currentOwner}`);
    console.log(`Signer: ${signer.address}`);
    console.log("\nTo transfer ownership, you must run this script from the owner's account.");
    console.log("Alternatively, the current owner can manually call:");
    console.log(`  oftAdapter.transferOwnership("${avatarAddress}")`);
    throw new Error("Signer is not the current owner");
  }

  console.log("\n✅ Signer is the current owner. Proceeding with ownership transfer...");

  // Transfer ownership to Avatar
  try {
    console.log("\nTransferring ownership to Avatar...");
    const tx = await oftAdapter.transferOwnership(avatarAddress);
    console.log("Transaction hash:", tx.hash);
    console.log("Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log("Block number:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Verify ownership was transferred
    console.log("\nVerifying ownership transfer...");
    const newOwner = await oftAdapter.owner();
    console.log("New owner:", newOwner);

    if (newOwner.toLowerCase() === avatarAddress.toLowerCase()) {
      console.log("\n✅ Successfully transferred ownership to Avatar!");
    } else {
      console.log("\n⚠️  Warning: Ownership was not transferred correctly.");
      console.log("Expected:", avatarAddress);
      console.log("Got:", newOwner);
    }

  } catch (error: any) {
    console.error("\n❌ Error transferring ownership:");
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

