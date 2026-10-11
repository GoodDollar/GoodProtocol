import { config as loadDotenv } from "dotenv";
import { ethers } from "hardhat";
import deployment from "../../releases/deployment.json";

loadDotenv();

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"
];

const CONTROLLER_ABI = [
  "event RegisterScheme(address indexed _sender, address indexed _scheme)",
  "event UnregisterScheme(address indexed _sender, address indexed _scheme)",
  "function avatar() view returns (address)",
  "function isSchemeRegistered(address _scheme, address _avatar) view returns (bool)"
];

const CHAIN_CONFIG = {
  fuse: {
    chainId: 122,
    rpcUrl: process.env.FUSE_RPC_URL || "https://rpc.fuse.io",
    controllerAddress: deployment["production"]["Controller"],
    blocksPerYear: 6_300_000
  },
  xdc: {
    chainId: 50,
    rpcUrl: process.env.XDC_RPC_URL || "",
    controllerAddress: deployment["production-xdc"]["Controller"],
    blocksPerYear: 15_800_000
  },
  celo: {
    chainId: 42220,
    rpcUrl: process.env.CELO_RPC_URL || "",
    controllerAddress: deployment["production-celo"]["Controller"],
    blocksPerYear: 6_300_000
  },
  ethereum: {
    chainId: 1,
    rpcUrl: process.env.ETHEREUM_RPC_URL || "",
    controllerAddress: deployment["production-mainnet"]["Controller"],
    blocksPerYear: 2_600_000
  }
} as const;

const getRpcUrl = (name: string) =>
  process.env[`${name.toUpperCase()}_RPC_URL`] || CHAIN_CONFIG[name as keyof typeof CHAIN_CONFIG].rpcUrl;
const getControllerAddress = (name: string) =>
  process.env[`${name.toUpperCase()}_CONTROLLER_ADDRESS`] ||
  CHAIN_CONFIG[name as keyof typeof CHAIN_CONFIG].controllerAddress;

const decodeSchemeAddress = (event: any) => {
  if (!event || !event.args) return undefined;
  return event.args._scheme || event.args[1] || event.args.scheme;
};

async function getHistoricalSchemes(
  controller: ethers.Contract,
  fromBlock: number,
  toBlock: number
): Promise<Map<string, { lastRegisterBlock?: number; lastUnregisterBlock?: number }>> {
  const [registerEvents, unregisterEvents] = await Promise.all([
    controller.queryFilter(controller.filters.RegisterScheme(), fromBlock, toBlock),
    controller.queryFilter(controller.filters.UnregisterScheme(), fromBlock, toBlock)
  ]);

  const schemeHistory = new Map<string, { lastRegisterBlock?: number; lastUnregisterBlock?: number }>();

  for (const event of registerEvents) {
    const scheme = decodeSchemeAddress(event);
    if (!scheme) continue;

    const existing = schemeHistory.get(scheme) || {};
    existing.lastRegisterBlock = event.blockNumber;
    schemeHistory.set(scheme, existing);
  }

  for (const event of unregisterEvents) {
    const scheme = decodeSchemeAddress(event);
    if (!scheme) continue;

    const existing = schemeHistory.get(scheme) || {};
    existing.lastUnregisterBlock = event.blockNumber;
    schemeHistory.set(scheme, existing);
  }

  return schemeHistory;
}

async function reportChain(name: "fuse" | "xdc" | "celo" | "ethereum") {
  const config = CHAIN_CONFIG[name];
  const controllerAddress = getControllerAddress(name);

  if (!controllerAddress) {
    console.log(`Skipping ${name}: set ${name.toUpperCase()}_CONTROLLER_ADDRESS to enable the DAO controller check.`);
    return;
  }

  const rpcUrl = getRpcUrl(name);
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const controller = new ethers.Contract(controllerAddress, CONTROLLER_ABI, provider);

  const [latestBlock, fromBlock] = await Promise.all([
    provider.getBlockNumber(),
    provider.getBlockNumber().then(block => Math.max(0, block - config.blocksPerYear))
  ]);

  console.log(`\n=== ${name.toUpperCase()} (${config.chainId}) ===`);
  console.log(`controller=${controllerAddress}`);
  console.log(`scanning blocks ${fromBlock} to ${latestBlock} (~1 year)`);

  const schemeHistory = await getHistoricalSchemes(controller, fromBlock, latestBlock);
  const uniqueSchemes = Array.from(schemeHistory.keys());

  console.log(
    `Found ${uniqueSchemes.length} unique scheme addresses in the last ~year of register/unregister history.`
  );

  const avatarAddress = await controller.avatar();
  const iface = new ethers.utils.Interface(CONTROLLER_ABI);
  const multicall = new ethers.Contract(
    config.chainId === 50 ? "0x0B1795ccA8E4eC4df02346a082df54D437F8D9aF" : MULTICALL3_ADDRESS,
    MULTICALL3_ABI,
    provider
  );

  const registeredSchemes: string[] = [];
  for (let i = 0; i < uniqueSchemes.length; i += 200) {
    const chunk = uniqueSchemes.slice(i, i + 200);
    const calls = chunk.map(scheme => ({
      target: controllerAddress,
      callData: iface.encodeFunctionData("isSchemeRegistered", [scheme, avatarAddress])
    }));

    const [, returnData] = await multicall.aggregate(calls);

    for (let j = 0; j < chunk.length; j += 1) {
      const isRegistered = iface.decodeFunctionResult("isSchemeRegistered", returnData[j])[0] as boolean;
      if (isRegistered) {
        registeredSchemes.push(chunk[j]);
      }
    }
  }

  if (registeredSchemes.length === 0) {
    console.log("No schemes are currently registered.");
    return;
  }

  registeredSchemes.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  console.log(`CURRENTLY REGISTERED (${registeredSchemes.length}):`);
  for (const scheme of registeredSchemes) {
    const lastRegisterBlock = schemeHistory.get(scheme)?.lastRegisterBlock;
    console.log(`- ${scheme}${lastRegisterBlock ? ` (last register at block ${lastRegisterBlock})` : ""}`);
  }
}

async function main() {
  const selectedChains = process.argv.slice(2);
  const chains = selectedChains.length
    ? selectedChains.map(v => v.toLowerCase())
    : (Object.keys(CHAIN_CONFIG) as Array<keyof typeof CHAIN_CONFIG>);

  for (const chain of chains) {
    if (!(chain in CHAIN_CONFIG)) {
      console.log(`Unknown chain: ${chain}. Supported: ${Object.keys(CHAIN_CONFIG).join(", ")}`);
      continue;
    }

    await reportChain(chain as "fuse" | "xdc" | "celo" | "ethereum");
  }
}

main().catch(error => {
  console.error("checkSchemes failed:", error);
  process.exit(1);
});
