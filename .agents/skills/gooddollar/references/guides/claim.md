# Claim guide

Use when the user wants to claim daily UBI. Protocol context: [How GoodDollar works](https://docs.gooddollar.org/how-gooddollar-works) and [UBIScheme (GoodDocs behavior)](https://docs.gooddollar.org/for-developers/core-contracts/ubischeme)—contract addresses only from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json).

## Goal

Execute a safe `claim()` with identity pre-checks and clear outputs.

## GoodDocs alignment

- UBI is distributed daily to verified users; the active pool is split among claimers in each period (see [How GoodDollar works](https://docs.gooddollar.org/how-gooddollar-works)).
- UBIScheme deployments vary by chain (Fuse, Celo, XDC); resolve live contract addresses only from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) (`UBIScheme` under `production`, `production-celo`, or `production-xdc`). Use [Core contracts / UBIScheme](https://docs.gooddollar.org/for-developers/core-contracts/ubischeme) for documented behavior, not for addresses.

## Required inputs

- `nameServiceAddress` or explicit UBIScheme and Identity addresses from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json)
- `rpcUrl` and chain configuration
- signer context

## Execution flow

1. Resolve `IDENTITY` and `UBISCHEME` from NameService when NameService is the source of truth for the deployment.
2. Confirm whitelist status for the claiming account.
3. Optionally read entitlement or claimable state before sending `claim()`.
4. Call `claim()` on the resolved UBIScheme (contract generation may differ by deployment; align ABI with your target).
5. Return tx hash and claimed amount when derivable from events or balance delta.

## Deterministic snippet

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const nameService = new ethers.Contract(
  process.env.NAMESERVICE_ADDRESS,
  ["function getAddress(string) view returns (address)"],
  provider,
);

const identityAddress = await nameService.getAddress("IDENTITY");
const ubiAddress = await nameService.getAddress("UBISCHEME");

const identity = new ethers.Contract(
  identityAddress,
  [
    "function isWhitelisted(address) view returns (bool)",
    "function getWhitelistedRoot(address) view returns (address)",
  ],
  provider,
);

const account = await signer.getAddress();
const isWhitelisted = await identity.isWhitelisted(account);
if (!isWhitelisted) throw new Error("Account is not whitelisted");

const root = await identity.getWhitelistedRoot(account);
if (root === ethers.ZeroAddress) throw new Error("No whitelisted root");

const ubi = new ethers.Contract(
  ubiAddress,
  ["function claim()", "event UBICalculated(address,uint256,uint256,uint256)"],
  signer,
);

const tx = await ubi.claim();
const receipt = await tx.wait();
console.log(JSON.stringify({ txHash: receipt.hash, account, root }, null, 2));
```

## Pre-check failures

- Not whitelisted: stop and point the user to identity verification flows in GoodDocs.
- Missing contract address: stop; use [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) only.
- Zero entitlement: communicate that nothing is claimable in the current period without guessing amounts.

## Output contract

- network
- resolved contract addresses
- tx hash
- claim outcome details when available
