/***
 * Script to bridge 1 G$ token from XDC to CELO using LayerZero OFT adapter
 * 
 * Usage:
 *   npx hardhat run scripts/bridge-oft-xdc-to-celo.ts --network production-xdc
 * 
 * Note: Make sure you have:
 * - GoodDollarOFTAdapter deployed on both XDC and CELO
 * - Sufficient G$ balance on XDC
 * - Sufficient native token (XDC) for gas and LayerZero fees
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import dao from "../releases/deployment.json";

// IERC20 interface for token operations
const IERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// LayerZero Endpoint IDs (eid)
// These are LayerZero v2 endpoint IDs, not chain IDs
// NOTE: These endpoint IDs need to be verified from LayerZero documentation
// You can override via CELO_LZ_ENDPOINT_ID environment variable
const CELO_ENDPOINT_ID = process.env.CELO_LZ_ENDPOINT_ID 
  ? parseInt(process.env.CELO_LZ_ENDPOINT_ID) 
  : 30125; // Default CELO LayerZero endpoint ID (verify this is correct!)

const main = async () => {
  const networkName = network.name;
  const [sender] = await ethers.getSigners();

  console.log("=== Bridge G$ from XDC to CELO ===");
  console.log("Network:", networkName);
  console.log("Sender:", sender.address);
  console.log("Sender balance:", ethers.utils.formatEther(await ethers.provider.getBalance(sender.address)), "XDC");

  // Validate we're on XDC network
  if (!networkName.includes("xdc")) {
    throw new Error(`This script should be run on XDC network. Current network: ${networkName}`);
  }

  // Get deployment info
  const release = dao[networkName];
  if (!release) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }

  const oftAdapterAddress = release.GoodDollarOFTAdapter;
  const tokenAddress = release.GoodDollar;
  const minterBurnerAddress = release.GoodDollarMinterBurner;

  if (!oftAdapterAddress) {
    throw new Error(`GoodDollarOFTAdapter not found in deployment.json for ${networkName}`);
  }

  if (!tokenAddress) {
    throw new Error(`GoodDollar token not found in deployment.json for ${networkName}`);
  }

  if (!minterBurnerAddress) {
    throw new Error(`GoodDollarMinterBurner not found in deployment.json for ${networkName}`);
  }

  console.log("\nContract addresses:");
  console.log("OFT Adapter:", oftAdapterAddress);
  console.log("Token:", tokenAddress);
  console.log("MinterBurner:", minterBurnerAddress);

  // Get contracts
  const token = new ethers.Contract(tokenAddress, IERC20_ABI, sender);
  const oftAdapter = await ethers.getContractAt("GoodDollarOFTAdapter", oftAdapterAddress);

  // Amount to bridge: 1 G$ = 1e18
  const amount = ethers.utils.parseEther("1");
  console.log("\nAmount to bridge:", ethers.utils.formatEther(amount), "G$");

  // Check token balance
  const balance = await token.balanceOf(sender.address);
  console.log("Current G$ balance:", ethers.utils.formatEther(balance), "G$");

  if (balance.lt(amount)) {
    throw new Error(`Insufficient balance. Need ${ethers.utils.formatEther(amount)} G$, have ${ethers.utils.formatEther(balance)} G$`);
  }

  // Check and approve MinterBurner if needed (required for burning tokens)
  // The MinterBurner contract needs approval to call burnFrom on the token
  const minterBurnerAllowance = await token.allowance(sender.address, minterBurnerAddress);
  console.log("\nChecking MinterBurner allowance...");
  console.log("Current MinterBurner allowance:", ethers.utils.formatEther(minterBurnerAllowance), "G$");

  if (minterBurnerAllowance.lt(amount)) {
    console.log("\nApproving MinterBurner to burn tokens...");
    const approveMinterBurnerTx = await token.approve(minterBurnerAddress, amount);
    await approveMinterBurnerTx.wait();
    console.log("MinterBurner approval confirmed:", approveMinterBurnerTx.hash);
  } else {
    console.log("Sufficient MinterBurner allowance already set");
  }

  // Check and approve OFT adapter if needed
  const allowance = await token.allowance(sender.address, oftAdapterAddress);
  console.log("\nChecking OFT adapter allowance...");
  console.log("Current OFT adapter allowance:", ethers.utils.formatEther(allowance), "G$");

  if (allowance.lt(amount)) {
    console.log("\nApproving OFT adapter to spend tokens...");
    const approveTx = await token.approve(oftAdapterAddress, amount);
    await approveTx.wait();
    console.log("OFT adapter approval confirmed:", approveTx.hash);
  } else {
    console.log("Sufficient OFT adapter allowance already set");
  }

  // Recipient address (same address on CELO)
  const recipient = sender.address;
  console.log("\nRecipient on CELO:", recipient);

  // Check if peer is set for CELO
  console.log("\nChecking if CELO peer is configured...");
  const celoPeer = await oftAdapter.peers(CELO_ENDPOINT_ID);
  console.log("Current CELO peer:", celoPeer);
  
  // Get CELO OFT adapter address
  // Can be provided via environment variable or from deployment.json
  let celoOFTAdapter = dao["development-celo"].GoodDollarOFTAdapter;
  
  if (!celoOFTAdapter) {
    const celoRelease = dao["production-celo"] || dao["development-celo"] || dao["celo"];
    if (celoRelease) {
      celoOFTAdapter = celoRelease.GoodDollarOFTAdapter;
    }
  }
  
  if (!celoOFTAdapter) {
    throw new Error(
      "CELO OFT adapter address not found. Please either:\n" +
      "  1. Set CELO_OFT_ADAPTER environment variable, or\n" +
      "  2. Deploy OFT adapter on CELO and add it to deployment.json, or\n" +
      "  3. Manually set the peer using: scripts/set-oft-peer.ts"
    );
  }
  
  const expectedPeer = ethers.utils.hexZeroPad(celoOFTAdapter, 32);
  console.log("Expected CELO peer (OFT adapter on CELO):", celoOFTAdapter);
  console.log("Expected peer (bytes32):", expectedPeer);
  
  // Compare case-insensitively (addresses can have different case)
  const celoPeerLower = celoPeer.toLowerCase();
  const expectedPeerLower = expectedPeer.toLowerCase();
  
  if (celoPeerLower === ethers.constants.HashZero.toLowerCase() || celoPeerLower !== expectedPeerLower) {
    console.log("\n⚠️  WARNING: CELO peer is not configured correctly!");
    console.log("You need to set the peer before bridging. Run this command:");
    console.log(`  oftAdapter.setPeer(${CELO_ENDPOINT_ID}, "${expectedPeer}")`);
    console.log("\nOr use a script to set peers. The owner of the OFT adapter must call setPeer().");
    throw new Error(`NoPeer: CELO peer (endpoint ${CELO_ENDPOINT_ID}) is not set. Expected: ${celoOFTAdapter}`);
  }
  
  console.log("✅ CELO peer is configured correctly");

  // Double-check approvals before calling quoteSend
  console.log("\nVerifying approvals before quoteSend...");
  const finalMinterBurnerAllowance = await token.allowance(sender.address, minterBurnerAddress);
  const finalOFTAllowance = await token.allowance(sender.address, oftAdapterAddress);
  console.log("Final MinterBurner allowance:", ethers.utils.formatEther(finalMinterBurnerAllowance), "G$");
  console.log("Final OFT adapter allowance:", ethers.utils.formatEther(finalOFTAllowance), "G$");
  
  if (finalMinterBurnerAllowance.lt(amount)) {
    throw new Error(
      `MinterBurner allowance insufficient. Need ${ethers.utils.formatEther(amount)} G$, have ${ethers.utils.formatEther(finalMinterBurnerAllowance)} G$`
    );
  }

  // Estimate LayerZero fee using quoteSend
  console.log("\nEstimating LayerZero fee...");
  try {
    // LayerZero v2 OFT uses quoteSend with SendParam struct
    // SendParam: { dstEid, to, amountLD, minAmountLD, extraOptions, composeMsg, oftCmd }
    const sendParam = {
      dstEid: CELO_ENDPOINT_ID, // destination endpoint ID
      to: ethers.utils.hexZeroPad(recipient, 32), // recipient address (bytes32 encoded)
      amountLD: amount, // amount to send in local decimals
      minAmountLD: amount, // minimum amount to receive (slippage protection)
      extraOptions: "0x", // extra options
      composeMsg: "0x", // compose message (empty for simple send)
      oftCmd: "0x" // OFT command (unused in default)
    };

    // Quote the fee (payInLzToken = false means pay in native token)
    const msgFee = await oftAdapter.quoteSend(sendParam, false);

    console.log("Estimated native fee:", ethers.utils.formatEther(msgFee.nativeFee), "XDC");
    console.log("Estimated LZ token fee:", ethers.utils.formatEther(msgFee.lzTokenFee), "LZ");

    // Check if sender has enough native token for fee
    const senderBalance = await ethers.provider.getBalance(sender.address);
    if (senderBalance.lt(msgFee.nativeFee)) {
      throw new Error(
        `Insufficient native token for fee. Need ${ethers.utils.formatEther(msgFee.nativeFee)} XDC, have ${ethers.utils.formatEther(senderBalance)} XDC`
      );
    }

    // Send tokens
    console.log("\nSending tokens via LayerZero OFT...");
    console.log("This may take a few minutes...");

    const sendTx = await oftAdapter.send(
      sendParam, // SendParam struct
      msgFee, // MessagingFee struct
      sender.address, // refund address
      { value: msgFee.nativeFee } // send native fee
    );

    console.log("Transaction sent:", sendTx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await sendTx.wait();
    console.log("\n✅ Transaction confirmed!");
    console.log("Block number:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Look for Send event
    const sendEvent = receipt.events?.find((e: any) => e.event === "Send");
    if (sendEvent) {
      console.log("\nSend event found:");
      console.log("  Amount:", ethers.utils.formatEther(sendEvent.args?.amountLD || 0), "G$");
      console.log("  Recipient:", sendEvent.args?.to);
    }

    console.log("\n=== Bridge Initiated Successfully ===");
    console.log("Transaction hash:", sendTx.hash);
    console.log("Recipient on CELO:", recipient);
    console.log("Amount:", ethers.utils.formatEther(amount), "G$");
    console.log("\nYou can track the cross-chain message at:");
    console.log(`https://layerzeroscan.com/tx/${sendTx.hash}`);
    console.log("\nNote: The tokens will arrive on CELO after the LayerZero message is delivered.");
    console.log("This typically takes a few minutes.");

  } catch (error: any) {
    console.error("\n❌ Error during bridge:");
    if (error.message) {
      console.error("Error message:", error.message);
    }
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    if (error.data) {
      console.error("Error data:", error.data);
      
      // Try to decode common LayerZero OFT errors
      const errorData = error.data;
      if (typeof errorData === 'string' && errorData.startsWith('0x')) {
        const errorSelector = errorData.slice(0, 10);
        console.error("Error selector:", errorSelector);
        
        // Common error selectors (first 4 bytes of keccak256(error signature))
        const errorMap: { [key: string]: string } = {
          '0x6592671c': 'LZ_ULN_InvalidWorkerOptions - Invalid extraOptions format',
          '0xdcbaa175': 'InsufficientAllowance',
          '0xf6deaa04': 'InsufficientBalance',
          '0x830d2e7b': 'InvalidSendParam',
          '0xdaffed9a': 'NoPeer - Destination peer not configured',
          '0x5bb2ebcc': 'InvalidPeer',
        };
        
        if (errorMap[errorSelector]) {
          console.error("Likely error:", errorMap[errorSelector]);
        }
        
        // If it's the LZ_ULN_InvalidWorkerOptions error, provide specific guidance
        if (errorSelector === '0x6592671c') {
          console.error("\n💡 LZ_ULN_InvalidWorkerOptions error means:");
          console.error("   - The extraOptions in SendParam are invalid or incorrectly formatted");
          console.error("   - extraOptions must be properly encoded LayerZero options");
          console.error("   - For simple sends, you may need to use empty bytes '0x' or properly formatted options");
          console.error("   - Check if you need to encode executor options or DVN options");
          console.error("\n   Solution: Ensure extraOptions are correctly formatted or use the OApp's");
          console.error("   combineOptions() helper to build proper options.");
        }
      }
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

