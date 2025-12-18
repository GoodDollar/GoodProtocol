/***
 * Script to set weekly and monthly mint/burn limits for GoodDollarMinterBurner contract
 * Uses genericCall through Avatar/Controller to execute the transaction
 * 
 * Usage:
 *   npx hardhat run scripts/multichain-deploy/oft/set-minter-burner-limits.ts --network development-celo
 * 
 * Note: This script must be run by a guardian or address with permissions to execute via Controller
 */

import { network, ethers } from "hardhat";
import { executeViaGuardian } from "../helpers";
import dao from "../../../releases/deployment.json";

const main = async () => {
  const networkName = network.name;
  const [signer] = await ethers.getSigners();

  console.log("=== Set Weekly and Monthly Mint/Burn Limits for GoodDollarMinterBurner ===");
  console.log("Network:", networkName);
  console.log("Signer:", signer.address);
  console.log("Signer balance:", ethers.utils.formatEther(await ethers.provider.getBalance(signer.address)), "ETH/CELO");

  // Get deployment info
  const release = dao[networkName];
  if (!release) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }

  const minterBurnerAddress = release.GoodDollarMinterBurner;
  const controllerAddress = release.Controller;
  const avatarAddress = release.Avatar;

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
  console.log("GoodDollarMinterBurner:", minterBurnerAddress);
  console.log("Controller:", controllerAddress);
  console.log("Avatar:", avatarAddress);

  // Get current limits from contract
  const minterBurner = await ethers.getContractAt("GoodDollarMinterBurner", minterBurnerAddress);
  
  const currentWeeklyMintLimit = await minterBurner.weeklyMintLimit();
  const currentMonthlyMintLimit = await minterBurner.monthlyMintLimit();
  const currentWeeklyBurnLimit = await minterBurner.weeklyBurnLimit();
  const currentMonthlyBurnLimit = await minterBurner.monthlyBurnLimit();

  console.log("\nCurrent limits:");
  console.log("Weekly Mint Limit:", ethers.utils.formatEther(currentWeeklyMintLimit), "G$");
  console.log("Monthly Mint Limit:", ethers.utils.formatEther(currentMonthlyMintLimit), "G$");
  console.log("Weekly Burn Limit:", ethers.utils.formatEther(currentWeeklyBurnLimit), "G$");
  console.log("Monthly Burn Limit:", ethers.utils.formatEther(currentMonthlyBurnLimit), "G$");

  const weeklyMintLimit = Number(process.env.WEEKLY_MINT_LIMIT);
  const monthlyMintLimit = Number(process.env.MONTHLY_MINT_LIMIT);
  const weeklyBurnLimit = Number(process.env.WEEKLY_BURN_LIMIT);
  const monthlyBurnLimit = Number(process.env.MONTHLY_BURN_LIMIT);

  // Check if any limits are being set
  if (weeklyMintLimit == undefined && monthlyMintLimit == undefined && weeklyBurnLimit == undefined && monthlyBurnLimit == undefined) {
    console.log("\n⚠️  No limits specified. Please provide at least one limit to set.");
    console.log("\nUsage examples:");
    console.log("  WEEKLY_MINT_LIMIT=1000000 npx hardhat run scripts/multichain-deploy/oft/set-minter-burner-limits.ts --network development-celo");
    console.log("\nTo disable a limit, set it to 0");
    return;
  }

  // Prepare transactions
  const proposalContracts: string[] = [];
  const proposalEthValues: string[] = [];
  const proposalFunctionSignatures: string[] = [];
  const proposalFunctionInputs: string[] = [];

  const abiCoder = ethers.utils.defaultAbiCoder;

  if (weeklyMintLimit != null) {
    const limit = weeklyMintLimit;
    if (limit != currentWeeklyMintLimit) {
      console.log(`\n📝 Setting Weekly Mint Limit: ${ethers.utils.formatEther(limit)} G$`);
      proposalContracts.push(minterBurnerAddress);
      proposalEthValues.push("0");
      proposalFunctionSignatures.push("setWeeklyMintLimit(uint256)");
      proposalFunctionInputs.push(abiCoder.encode(["uint256"], [limit]));
    } else {
      console.log(`\n⏭️  Skipping Weekly Mint Limit (already set to ${ethers.utils.formatEther(limit)} G$)`);
    }
  }

  if (monthlyMintLimit != null) {
    const limit = monthlyMintLimit;
    if (limit != currentMonthlyMintLimit) {
      console.log(`\n📝 Setting Monthly Mint Limit: ${ethers.utils.formatEther(limit)} G$`);
      proposalContracts.push(minterBurnerAddress);
      proposalEthValues.push("0");
      proposalFunctionSignatures.push("setMonthlyMintLimit(uint256)");
      proposalFunctionInputs.push(abiCoder.encode(["uint256"], [limit]));
    } else {
      console.log(`\n⏭️  Skipping Monthly Mint Limit (already set to ${ethers.utils.formatEther(limit)} G$)`);
    }
  }

  if (weeklyBurnLimit != null) {
    const limit = weeklyBurnLimit;
    if (limit != currentWeeklyBurnLimit) {
      console.log(`\n📝 Setting Weekly Burn Limit: ${ethers.utils.formatEther(limit)} G$`);
      proposalContracts.push(minterBurnerAddress);
      proposalEthValues.push("0");
      proposalFunctionSignatures.push("setWeeklyBurnLimit(uint256)");
      proposalFunctionInputs.push(abiCoder.encode(["uint256"], [limit]));
    } else {
      console.log(`\n⏭️  Skipping Weekly Burn Limit (already set to ${ethers.utils.formatEther(limit)} G$)`);
    }
  }

  if (monthlyBurnLimit != null) {
    const limit = monthlyBurnLimit;
    if (limit != currentMonthlyBurnLimit) {
      console.log(`\n📝 Setting Monthly Burn Limit: ${ethers.utils.formatEther(limit)} G$`);
      proposalContracts.push(minterBurnerAddress);
      proposalEthValues.push("0");
      proposalFunctionSignatures.push("setMonthlyBurnLimit(uint256)");
      proposalFunctionInputs.push(abiCoder.encode(["uint256"], [limit]));
    } else {
      console.log(`\n⏭️  Skipping Monthly Burn Limit (already set to ${ethers.utils.formatEther(limit)} G$)`);
    }
  }

  if (proposalContracts.length === 0) {
    console.log("\n✅ All limits are already set to the requested values. No transactions needed.");
    return;
  }

  console.log(`\n📋 Preparing ${proposalContracts.length} transaction(s)...`);

  // Execute via guardian using the helper function
  try {
    console.log("\nExecuting via Controller/Avatar...");
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      signer,
      networkName
    );

    // Verify the limits were set
    console.log("\nVerifying limits were set...");
    const updatedWeeklyMintLimit = await minterBurner.weeklyMintLimit();
    const updatedMonthlyMintLimit = await minterBurner.monthlyMintLimit();
    const updatedWeeklyBurnLimit = await minterBurner.weeklyBurnLimit();
    const updatedMonthlyBurnLimit = await minterBurner.monthlyBurnLimit();

    console.log("\nUpdated limits:");
    console.log("Weekly Mint Limit:", ethers.utils.formatEther(updatedWeeklyMintLimit), "G$");
    console.log("Monthly Mint Limit:", ethers.utils.formatEther(updatedMonthlyMintLimit), "G$");
    console.log("Weekly Burn Limit:", ethers.utils.formatEther(updatedWeeklyBurnLimit), "G$");
    console.log("Monthly Burn Limit:", ethers.utils.formatEther(updatedMonthlyBurnLimit), "G$");

    console.log("\n✅ Successfully set limits via Avatar!");

  } catch (error: any) {
    console.error("\n❌ Error setting limits:");
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

