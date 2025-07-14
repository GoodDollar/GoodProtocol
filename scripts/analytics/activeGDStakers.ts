import { ethers } from "ethers";
import "dotenv/config";

// --- CONFIGURATION ---
// For better performance and reliability, use a private RPC endpoint.
const FUSE_RPC_URL = process.env.FUSE_RPC_URL || "https://rpc.fuse.io";
const GOVERNANCE_STAKING_ADDRESS = "0xB7C3e738224625289C573c54d402E9Be46205546";
const GREPUTATION_STAKING_ADDRESS = "0x603B8C0F110E037b51A381CBCacAbb8d6c6E4543";
// This is the standard Multicall3 contract address, available on Fuse and many other EVM chains.
const MULTICALL_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Contract deployment block. We start scanning from here to find all historical events.
const START_BLOCK = 15900000; //15900000

// Chunk sizes to avoid overwhelming the RPC endpoint. Adjust if you get timeout errors.
const BLOCK_CHUNK_SIZE = 50000;
const MULTICALL_CHUNK_SIZE = 100; // Number of stakers to query per multicall batch.

// --- ABIs (derived from GovernanceStaking.sol) ---
const GOVERNANCE_STAKING_ABI = [
  "event Staked(address indexed who,uint256 amount)",
  "function balanceOf(address staker) view returns (uint256)",
  "function getUserPendingReward(address staker) view returns (uint256)"
];

const MULTICALL_ABI = [
  "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"
];

// --- TYPES ---
interface StakerData {
  address: string;
  stakeAmount: bigint;
  pendingGood: bigint;
  goodBalance: bigint;
}

/**
 * Fetches all unique staker addresses by scanning Staked events in block chunks.
 * @param contract The GovernanceStaking contract instance.
 * @param startBlock The block to start scanning from.
 * @param endBlock The block to scan until (usually the latest block).
 * @returns A promise that resolves to an array of unique staker addresses.
 */
async function getAllStakers(contract: ethers.Contract, startBlock: number, endBlock: number): Promise<string[]> {
  console.log(`Fetching all historical stakers from block ${startBlock} to ${endBlock}...`);
  const stakers = new Set<string>();

  for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += BLOCK_CHUNK_SIZE) {
    const toBlock = Math.min(fromBlock + BLOCK_CHUNK_SIZE - 1, endBlock);
    console.log(`  - Scanning blocks ${fromBlock} to ${toBlock} for Staked events...`);

    try {
      const events = await contract.queryFilter(contract.filters.Staked(), fromBlock, toBlock);
      console.log(`    Found ${events.length} Staked events in this block range.`);
      for (const event of events) {
        // The 'who' argument from the event is the staker's address
        if (event.args && event.args.who) {
          stakers.add(event.args.who);
        }
      }
    } catch (error) {
      console.error(`Error fetching events in block range ${fromBlock}-${toBlock}:`, error);
      // Optionally, you could add retry logic here.
    }
  }

  console.log(`Found ${stakers.size} unique historical stakers.`);
  return Array.from(stakers);
}

/**
 * Fetches stake and entitlement data for a list of stakers using multicall.
 * @param provider An ethers provider instance.
 * @param stakerAddresses An array of staker addresses to query.
 * @returns A promise that resolves to an array of StakerData objects.
 */
async function fetchStakersData(
  provider: ethers.providers.JsonRpcProvider,
  stakerAddresses: string[]
): Promise<StakerData[]> {
  console.log(`\nFetching current stake and pending GOOD for ${stakerAddresses.length} stakers using multicall...`);
  const allStakerData: StakerData[] = [];
  const govStakingInterface = new ethers.Contract(ethers.constants.AddressZero, GOVERNANCE_STAKING_ABI);
  const multicall = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, provider);

  for (let i = 0; i < stakerAddresses.length; i += MULTICALL_CHUNK_SIZE) {
    const chunk = stakerAddresses.slice(i, i + MULTICALL_CHUNK_SIZE);
    console.log(`  - Processing multicall batch ${i / MULTICALL_CHUNK_SIZE + 1} for ${chunk.length} stakers...`);

    const calls = chunk.flatMap(address => [
      // Call 1: Get current G$ stake amount
      {
        target: GOVERNANCE_STAKING_ADDRESS,
        callData: govStakingInterface.interface.encodeFunctionData("balanceOf", [address])
      },
      // Call 2: Get pending GOOD tokens
      {
        target: GOVERNANCE_STAKING_ADDRESS,
        callData: govStakingInterface.interface.encodeFunctionData("getUserPendingReward", [address])
      },
      {
        target: GREPUTATION_STAKING_ADDRESS,
        callData: govStakingInterface.interface.encodeFunctionData("balanceOf", [address])
      }
    ]);

    try {
      const [, returnData] = await multicall.aggregate(calls);

      for (let j = 0; j < chunk.length; j++) {
        const address = chunk[j];
        // Each staker has two return values in the flat array
        const stakeResult = returnData[j * 3];
        const entitlementResult = returnData[j * 3 + 1];
        const goodResult = returnData[j * 3 + 2];

        const stakeAmount = govStakingInterface.interface.decodeFunctionResult("balanceOf", stakeResult)[0];
        const pendingGood = govStakingInterface.interface.decodeFunctionResult(
          "getUserPendingReward",
          entitlementResult
        )[0];
        const goodBalance = govStakingInterface.interface.decodeFunctionResult("balanceOf", goodResult)[0];

        allStakerData.push({
          address,
          stakeAmount,
          pendingGood,
          goodBalance
        });
      }
    } catch (error) {
      console.error(`Error during multicall batch ${i / MULTICALL_CHUNK_SIZE + 1}:`, error);
    }
  }

  return allStakerData;
}

/**
 * Main execution function.
 */
async function main() {
  console.log("--- Fuse GovernanceStaking Analysis ---");
  const provider = new ethers.providers.JsonRpcProvider(FUSE_RPC_URL);
  const governanceStaking = new ethers.Contract(GOVERNANCE_STAKING_ADDRESS, GOVERNANCE_STAKING_ABI, provider);

  const latestBlock = await provider.getBlockNumber();
  console.log(`Connected to Fuse Network. Latest block: ${latestBlock}`);

  // Step 1: Get all unique addresses that have ever staked.
  const allHistoricalStakers = await getAllStakers(governanceStaking, START_BLOCK, latestBlock);
  if (allHistoricalStakers.length === 0) {
    console.log("No stakers found. Exiting.");
    return;
  }

  // Step 2: Use multicall to get current data for all historical stakers.
  const allStakerData = await fetchStakersData(provider, allHistoricalStakers);

  // Step 3: Filter for active stakers (stake > 0) and present the results.
  const activeStakers = allStakerData.filter(data => data.stakeAmount > 0n);

  console.log("\n--- Analysis Complete ---");
  console.log(`Total unique historical stakers: ${allHistoricalStakers.length}`);
  console.log(`Total active stakers (current stake > 0): ${activeStakers.length}`);
  console.log("-------------------------\n");

  // Optional: Print details for the top 5 active stakers by stake amount
  //   activeStakers.sort((a, b) => (Number(b.stakeAmount) > Number(a.stakeAmount) ? 1 : -1));
  activeStakers.sort((a, b) =>
    BigInt(b.goodBalance) + BigInt(b.pendingGood) > BigInt(a.goodBalance) + BigInt(a.pendingGood) ? 1 : -1
  );
  console.log("Top 100 Active Stakers by G$ Stake:");
  activeStakers.slice(0, 100).forEach((staker, index) => {
    console.log(`  ${index + 1}. Address: ${staker.address}`);
    console.log(`     Stake: ${ethers.utils.formatUnits(staker.stakeAmount, 2)} G$`);
    console.log(`     Pending: ${ethers.utils.formatEther(staker.pendingGood)} GOOD`);
    console.log(
      `     Total Good: ${ethers.utils.formatEther(BigInt(staker.goodBalance) + BigInt(staker.pendingGood))} GOOD`
    );
  });
}

main().catch(error => {
  console.error("An unexpected error occurred:", error);
  process.exit(1);
});
