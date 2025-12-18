/***
 * Script to bridge 1 G$ token between XDC and CELO using LayerZero OFT adapter
 * 
 * Usage:
 *   # Bridge from XDC to CELO:
 *   npx hardhat run scripts/multichain-deploy/oft/bridge-oft-token.ts --network production-xdc
 *   # or
 *   npx hardhat run scripts/multichain-deploy/oft/bridge-oft-token.ts --network development-xdc
 * 
 *   # Bridge from CELO to XDC:
 *   npx hardhat run scripts/multichain-deploy/oft/bridge-oft-token.ts --network production-celo
 *   # or
 *   npx hardhat run scripts/multichain-deploy/oft/bridge-oft-token.ts --network development-celo
 * 
 * Note: Make sure you have:
 * - GoodDollarOFTAdapter deployed on both XDC and CELO
 * - Sufficient G$ balance on the source chain
 * - Sufficient native token (XDC or CELO) for gas and LayerZero fees
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import dao from "../../../releases/deployment.json";

// IERC20 interface for token operations
const IERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// LayerZero Endpoint IDs (eid)
// These are LayerZero v2 endpoint IDs, not chain IDs
const XDC_ENDPOINT_ID = EndpointId.XDC_V2_MAINNET;
const CELO_ENDPOINT_ID = process.env.CELO_LZ_ENDPOINT_ID 
  ? parseInt(process.env.CELO_LZ_ENDPOINT_ID) 
  : EndpointId.CELO_V2_MAINNET; // Default CELO LayerZero endpoint ID

const main = async () => {
  const networkName = network.name;
  const [sender] = await ethers.getSigners();

  // Detect source and destination networks
  const isXDC = networkName.includes("xdc");
  const isCELO = networkName.includes("celo");

  if (!isXDC && !isCELO) {
    throw new Error(
      `Network must be XDC or CELO. Current network: ${networkName}\n` +
      `Supported networks: production-xdc, development-xdc, production-celo, development-celo`
    );
  }

  const sourceNetwork = isXDC ? "XDC" : "CELO";
  const destNetwork = isXDC ? "CELO" : "XDC";
  const sourceEndpointId = isXDC ? XDC_ENDPOINT_ID : CELO_ENDPOINT_ID;
  const destEndpointId = isXDC ? CELO_ENDPOINT_ID : XDC_ENDPOINT_ID;
  const nativeTokenName = isXDC ? "XDC" : "CELO";

  console.log("=== Bridge G$ ===");
  console.log(`Bridging from ${sourceNetwork} to ${destNetwork}`);
  console.log("Source Network:", networkName);
  console.log("Sender:", sender.address);
  console.log(`Sender balance: ${ethers.utils.formatEther(await ethers.provider.getBalance(sender.address))} ${nativeTokenName}`);

  // Get deployment info for source network
  const sourceRelease = dao[networkName];
  if (!sourceRelease) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }

  const oftAdapterAddress = sourceRelease.GoodDollarOFTAdapter;
  const tokenAddress = sourceRelease.GoodDollar;
  const minterBurnerAddress = sourceRelease.GoodDollarMinterBurner;

  if (!oftAdapterAddress) {
    throw new Error(`GoodDollarOFTAdapter not found in deployment.json for ${networkName}`);
  }

  if (!tokenAddress) {
    throw new Error(`GoodDollar token not found in deployment.json for ${networkName}`);
  }

  if (!minterBurnerAddress) {
    throw new Error(`GoodDollarMinterBurner not found in deployment.json for ${networkName}`);
  }

  console.log("\nSource chain contract addresses:");
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

  // Recipient address (same address on destination chain)
  const recipient = sender.address;
  console.log(`\nRecipient on ${destNetwork}:`, recipient);

  // Get destination network OFT adapter address
  let destNetworkName: string;
  if (isXDC) {
    // Bridging to CELO - try production-celo first, then development-celo
    destNetworkName = "development-celo";
  } else {
    // Bridging to XDC - try production-xdc first, then development-xdc
    destNetworkName = "development-xdc";
  }

  const destRelease = dao[destNetworkName] as any;
  if (!destRelease) {
    throw new Error(`No deployment found for destination network: ${destNetworkName}`);
  }

  const destOFTAdapter = destRelease.GoodDollarOFTAdapter;
  
  if (!destOFTAdapter) {
    throw new Error(
      `${destNetwork} OFT adapter address not found in deployment.json.\n` +
      `Please either:\n` +
      `  1. Deploy OFT adapter on ${destNetwork} and add it to deployment.json, or\n` +
      `  2. Manually set the peer using: scripts/set-oft-peer.ts`
    );
  }

  console.log(`\nDestination chain (${destNetwork}):`);
  console.log(`OFT Adapter: ${destOFTAdapter}`);
  console.log(`Network name: ${destNetworkName}`);

  // Check if peer is set for destination chain
  console.log(`\nChecking if ${destNetwork} peer is configured...`);
  const destPeer = await oftAdapter.peers(destEndpointId);
  console.log(`Current ${destNetwork} peer:`, destPeer);
  
  const expectedPeer = ethers.utils.hexZeroPad(destOFTAdapter, 32);
  console.log(`Expected ${destNetwork} peer (OFT adapter on ${destNetwork}):`, destOFTAdapter);
  console.log("Expected peer (bytes32):", expectedPeer);
  
  // Compare case-insensitively (addresses can have different case)
  const destPeerLower = destPeer.toLowerCase();
  const expectedPeerLower = expectedPeer.toLowerCase();
  
  if (destPeerLower === ethers.constants.HashZero.toLowerCase() || destPeerLower !== expectedPeerLower) {
    console.log(`\n⚠️  WARNING: ${destNetwork} peer is not configured correctly!`);
    console.log("You need to set the peer before bridging. Run this command:");
    console.log(`  oftAdapter.setPeer(${destEndpointId}, "${expectedPeer}")`);
    console.log("\nOr use the LayerZero wire command:");
    console.log(`  npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts --network ${networkName}`);
    throw new Error(`NoPeer: ${destNetwork} peer (endpoint ${destEndpointId}) is not set. Expected: ${destOFTAdapter}`);
  }
  
  console.log(`✅ ${destNetwork} peer is configured correctly`);

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
      dstEid: destEndpointId, // destination endpoint ID
      to: ethers.utils.hexZeroPad(recipient, 32), // recipient address (bytes32 encoded)
      amountLD: amount, // amount to send in local decimals
      minAmountLD: amount, // minimum amount to receive (slippage protection)
      extraOptions: "0x", // extra options
      composeMsg: "0x", // compose message (empty for simple send)
      oftCmd: "0x" // OFT command (unused in default)
    };

    // Quote the fee (payInLzToken = false means pay in native token)
    const msgFee = await oftAdapter.quoteSend(sendParam, false);

    console.log(`Estimated native fee: ${ethers.utils.formatEther(msgFee.nativeFee)} ${nativeTokenName}`);
    console.log("Estimated LZ token fee:", ethers.utils.formatEther(msgFee.lzTokenFee), "LZ");

    // Check if sender has enough native token for fee
    const senderBalance = await ethers.provider.getBalance(sender.address);
    if (senderBalance.lt(msgFee.nativeFee)) {
      throw new Error(
        `Insufficient native token for fee. Need ${ethers.utils.formatEther(msgFee.nativeFee)} ${nativeTokenName}, have ${ethers.utils.formatEther(senderBalance)} ${nativeTokenName}`
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
    console.log(`Bridging from ${sourceNetwork} to ${destNetwork}`);
    console.log("Transaction hash:", sendTx.hash);
    console.log(`Recipient on ${destNetwork}:`, recipient);
    console.log("Amount:", ethers.utils.formatEther(amount), "G$");
    console.log("\nYou can track the cross-chain message at:");
    console.log(`https://layerzeroscan.com/tx/${sendTx.hash}`);
    console.log(`\nNote: The tokens will arrive on ${destNetwork} after the LayerZero message is delivered.`);
    console.log("This typically takes a few minutes.");

  } catch (error: any) {
    console.error("\n❌ Error during bridge:");
    throw error;
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

