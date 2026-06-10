# Fuse to CELO staking migration guide

Use when the user wants to migrate an existing Fuse governance stake into a CELO destination savings flow. In this flow, Fuse `GovernanceStakingV2` is the old staking contract (source) and **`GooddollarSavingsStream`** on Celo is the destination savings contract ([`GooddollarSavingsStream.sol`](https://github.com/Ubeswap/gooddollar-contracts/blob/main/contracts/GooddollarSavingsStream.sol), [CeloScan](https://celoscan.io/address/0x059ee811414230d1Fb157878D2b491240F4D8d3B)).

## Goal

Close a user stake on Fuse, bridge the resulting G$ to CELO, and stake on CELO for that user in a controlled backend flow.

## Required inputs

- user address on Fuse and corresponding destination address on CELO
- Fuse `GovernanceStakingV2` address (`production.GovernanceStakingV2` in [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json))
- Fuse G$ token address and bridge contract address (from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json): `GoodDollar`, `MpbBridge` under `production`)
- CELO G$ token address (from `production-celo` in the same file) and destination savings contract address
- backend signer or service wallet with required execution permissions
- chain RPC URLs for Fuse and CELO

## Address resolution quick table

| Purpose | Network | Source key/path | Value |
|---|---|---|---|
| Governance staking (source close) | Fuse (`production`, `networkId: 122`) | `deployment.json` -> `production.GovernanceStakingV2` | `0xB7C3e738224625289C573c54d402E9Be46205546` |
| Governance staking (previous) | Fuse (`production`, `networkId: 122`) | `deployment.json` -> `production.GovernanceStaking` | `0xFAF457Fb4A978Be059506F6CD41f9B30fCa753b0` |
| Fuse G$ token | Fuse (`production`, `networkId: 122`) | `deployment.json` -> `production.GoodDollar` | `0x495d133B938596C9984d462F007B676bDc57eCEC` |
| Fuse bridge | Fuse (`production`, `networkId: 122`) | `deployment.json` -> `production.MpbBridge` | `0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5` |
| Destination savings | CELO (`networkId: 42220`) | [CeloScan](https://celoscan.io/address/0x059ee811414230d1Fb157878D2b491240F4D8d3B) / `GooddollarSavingsStream` | `0x059ee811414230d1Fb157878D2b491240F4D8d3B` (`process.env.CELO_SAVINGS`) |

Canonical sources:

- [GoodProtocol deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json)
- [Fuse explorer contract (GovernanceStakingV2 address)](https://explorer.fuse.io/address/0xB7C3e738224625289C573c54d402E9Be46205546?tab=contract)
- [Ubeswap gooddollar-contracts](https://github.com/Ubeswap/gooddollar-contracts)
- [GoodBridge bridge helper normalization](https://github.com/GoodDollar/GoodBridge/blob/master/packages/bridge-contracts/contracts/messagePassingBridge/BridgeHelperLibrary.sol)

## Token decimals and `MessagePassingBridge` LZ fees

Production deployments checked on-chain: Fuse `GoodDollar` uses **2** decimals and Celo `GoodDollar` uses **18**. Fuse `GovernanceStakingV2` (sG$) uses **2** decimals. Resolve `decimals()` from each live token in your runner so you stay correct if deployments change.

On the Fuse `MpbBridge` (`MessagePassingBridge`), `canBridge(from, amount)` and `bridgeToWithLz(..., amount, ...)` use the **raw G$ burn amount** in source token decimals. Off-chain **`estimateSendFee`’s `_normalizedAmount` argument** must match what the contract builds internally: **`normalizeFromTokenTo18Decimals(amount, IERC20(nativeToken()).decimals())`** ([`BridgeHelperLibrary`](https://github.com/GoodDollar/GoodBridge/blob/master/packages/bridge-contracts/contracts/messagePassingBridge/BridgeHelperLibrary.sol)). Format displayed amounts per chain (`formatUnits`/UI) using each chain’s G$ decimals.

## Execution flow

1. Confirm allowance for whichever asset your flow spends first (for example sG$ allowance to the backend on Fuse `GovernanceStakingV2`, or Fuse G$ allowance if you pull G$ directly), before any transfers or bridges.
2. Verify current stake state on Fuse before closing:
   - stake token balance
   - withdrawable stake amount
   - pending rewards if any
3. Execute Fuse unstake or close flow on governance staking (`withdrawStake` or equivalent full-close path).
4. Compute net G$ available for migration after unstake completion and any reward claim behavior.
5. Bridge G$ from Fuse to CELO using the configured bridge path and track the transfer id or tx hash pair.
6. Wait for destination finalization on CELO and verify credited G$ balance at the backend execution wallet.
7. Approve destination savings contract to spend migrated G$ amount.
8. Stake for the user on CELO with `stakeFor(amount, recipient)` on `GooddollarSavingsStream` (G$ native Super Token; approve the savings contract, not only ERC20 GoodDollar from `deployment.json` if your wallet holds the Super Token).
9. Return a migration result with both chain tx hashes and final CELO staked amount.

## Deterministic snippet

```js
import { ethers } from "ethers";

const fuse = new ethers.JsonRpcProvider(process.env.FUSE_RPC_URL);
const celo = new ethers.JsonRpcProvider(process.env.CELO_RPC_URL);
const signerFuse = new ethers.Wallet(process.env.BACKEND_PK, fuse);
const signerCelo = new ethers.Wallet(process.env.BACKEND_PK, celo);

const user = process.env.USER_ADDRESS;
const migrateAmount = BigInt(process.env.MIGRATE_AMOUNT);

const celoGd = new ethers.Contract(
  process.env.CELO_GD_TOKEN,
  [
    "function approve(address spender,uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ],
  signerCelo,
);

const savings = new ethers.Contract(
  process.env.CELO_SAVINGS,
  ["function stakeFor(uint256 amount,address recipient)"],
  signerCelo,
);

const approveTx = await celoGd.approve(process.env.CELO_SAVINGS, migrateAmount);
await approveTx.wait();

const stakeTx = await savings.stakeFor(migrateAmount, user);
const receipt = await stakeTx.wait();

console.log(
  JSON.stringify(
    {
      user,
      celoStakeTx: receipt.hash,
      migratedAmount: migrateAmount.toString(),
    },
    null,
    2,
  ),
);
```

## Pre-check failures

- User allowance missing on Fuse: stop and request allowance tx from user.
- Stake close fails on Fuse: stop and return exact revert reason before bridge.
- Bridge transfer not finalized on CELO: do not call `stakeFor` until destination balance is confirmed.
- CELO savings approval missing or too low: re-approve exact amount before staking.

## Output contract

- user address
- Fuse unstake tx hash
- bridge tx hash or transfer identifier
- CELO stake tx hash
- final staked amount on CELO
