# Save and stake guide

Use when the user wants to stake G$, withdraw rewards, or exit stake. Staking economics sit alongside other protocol allocations described in [How GoodDollar works](https://docs.gooddollar.org/how-gooddollar-works).

## GoodDocs alignment

- Token integration and fee awareness: [How to integrate the G$ token](https://docs.gooddollar.org/for-developers/developer-guides/how-to-integrate-the-gusd-token) (`_processFees`, decimals per chain).
- Contract addresses: [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) only (for example staking and G$ token keys under `production` / `production-celo`). GoodDocs covers behavior and decimals patterns, not canonical deployment addresses.

## Goal

Run staking actions with balance and allowance safety checks.

## Required inputs

- `nameServiceAddress` or explicit staking and token addresses
- `amount` or `shares` depending on the action
- `rpcUrl`, chain configuration, signer

## Execution flow

1. Resolve staking and G$ token addresses from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) or, when the deployment documents the key, from `NameService.getAddress` on chain.
2. Read token balance and allowance.
3. Approve the staking contract when `stake` uses `transferFrom`.
4. Execute `stake`, `withdrawRewards`, or `withdrawStake` as requested.
5. Return tx hash and key resulting balances or events.

## Deterministic snippets

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const token = new ethers.Contract(
  process.env.GOODDOLLAR_ADDRESS,
  [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ],
  signer,
);

const staking = new ethers.Contract(
  process.env.STAKING_ADDRESS,
  [
    "function stake(uint256)",
    "function withdrawRewards()",
    "function withdrawStake(uint256)",
  ],
  signer,
);
```

Stake:

```js
const amount = ethers.parseUnits(process.env.AMOUNT, Number(process.env.DECIMALS));
const owner = await signer.getAddress();
const allowance = await token.allowance(owner, process.env.STAKING_ADDRESS);
if (allowance < amount) {
  const approveTx = await token.approve(process.env.STAKING_ADDRESS, amount);
  await approveTx.wait();
}
const tx = await staking.stake(amount);
const receipt = await tx.wait();
console.log(JSON.stringify({ txHash: receipt.hash, action: "stake" }, null, 2));
```

Withdraw rewards:

```js
const tx = await staking.withdrawRewards();
const receipt = await tx.wait();
console.log(JSON.stringify({ txHash: receipt.hash, action: "withdrawRewards" }, null, 2));
```

Withdraw stake:

```js
const shares = ethers.parseUnits(process.env.SHARES, Number(process.env.DECIMALS));
const tx = await staking.withdrawStake(shares);
const receipt = await tx.wait();
console.log(JSON.stringify({ txHash: receipt.hash, action: "withdrawStake" }, null, 2));
```

## Failure handling

- Insufficient balance: report shortfall.
- Approval issues: report token, spender, and required allowance.
- Reverts: return attempted function and parameters without guessing custom errors.
