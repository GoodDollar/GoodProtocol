/**
 * LayerZero OApp Configuration
 * 
 * This config file is used by LayerZero Hardhat tools to wire connections
 * between chains and configure messaging libraries, DVNs, and executors.
 * 
 * Usage:
 *   npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts
 *   npx hardhat lz:oapp:config:get --oapp-config layerzero.config.ts
 */

import { EndpointId } from "@layerzerolabs/lz-definitions";
import type { OmniPointHardhat } from "@layerzerolabs/toolbox-hardhat";
import { OAppEnforcedOption } from "@layerzerolabs/toolbox-hardhat";
import { ExecutorOptionType } from "@layerzerolabs/lz-v2-utilities";
import { TwoWayConfig, generateConnectionsConfig } from "@layerzerolabs/metadata-tools";
import dao from "./releases/deployment.json";

// Network names - adjust these based on your deployment
const XDC_NETWORK = "development-xdc";
const CELO_NETWORK = "development-celo";

// Get contract addresses from deployment.json
const xdcOftAdapterAddress = (dao[XDC_NETWORK] as any)?.GoodDollarOFTAdapter;
const celoOftAdapterAddress = (dao[CELO_NETWORK] as any)?.GoodDollarOFTAdapter;

if (!xdcOftAdapterAddress || !celoOftAdapterAddress) {
  throw new Error(
    `OFT Adapter addresses not found in deployment.json. ` +
    `XDC: ${xdcOftAdapterAddress || "missing"}, CELO: ${celoOftAdapterAddress || "missing"}. ` +
    `Please deploy them first or adjust XDC_NETWORK and CELO_NETWORK constants.`
  );
}

// XDC Network contract
const xdcContract: OmniPointHardhat = {
  eid: EndpointId.XDC_V2_MAINNET, // XDC endpoint ID
  contractName: "GoodDollarOFTAdapter",
  address: xdcOftAdapterAddress,
};

// CELO Network contract
const celoContract: OmniPointHardhat = {
  eid: EndpointId.CELO_V2_MAINNET, // CELO endpoint ID
  contractName: "GoodDollarOFTAdapter",
  address: celoOftAdapterAddress,
};

// Enforced execution options for EVM chains
// These set the minimum gas limits for lzReceive on the destination chain
const EVM_ENFORCED_OPTIONS: OAppEnforcedOption[] = [
  {
    msgType: 1, // SEND message type
    optionType: ExecutorOptionType.LZ_RECEIVE,
    gas: 200000, // Gas limit for lzReceive execution on destination
    value: 0, // Native token value to send (0 for now)
  },
];

// Define the pathways between chains
// This creates a bidirectional connection: XDC <-> CELO
const pathways: TwoWayConfig[] = [
  [
    // 1) Destination chain contract (CELO)
    celoContract,

    // 2) Source chain contract (XDC)
    xdcContract,

    // 3) Channel security settings:
    //    • first array = "required" DVN names (must sign)
    //    • second array = "optional" DVN names array + threshold
    //    • third value = threshold (number of optionalDVNs that must sign)
    [["LayerZero Labs" /* Add more DVN names here if needed */], []],

    // 4) Block confirmations:
    //    [confirmations for CELO → XDC, confirmations for XDC → CELO]
    [20, 20],

    // 5) Enforced execution options:
    //    [options for CELO → XDC, options for XDC → CELO]
    [EVM_ENFORCED_OPTIONS, EVM_ENFORCED_OPTIONS],
  ],
];

export default async function () {
  // Generate the connections config based on the pathways
  const connections = await generateConnectionsConfig(pathways);
  return {
    contracts: [
      { contract: xdcContract },
      { contract: celoContract },
    ],
    connections,
  };
}

