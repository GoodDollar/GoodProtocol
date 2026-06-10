# Check identity guide

Use when the user asks whether an address is eligible for UBI or how identity links wallets.

## GoodDocs alignment

- [Connect another wallet address to identity](https://docs.gooddollar.org/user-guides/connect-another-wallet-address-to-identity): associated addresses resolve to a verified root in the Identity contract; `connectAccount` links wallets.
- One claim per day applies across all connected addresses for the same verified identity (see the hint on that page).

## Goal

Determine whitelist or authentication status with deterministic on-chain reads.

## Metric semantics

- **Passed whitelisting (historical):** use `lastAuthenticated(account) > 0`.
- **Still whitelisted (current):** use `getWhitelistedRoot(account) != 0x0` or `isWhitelisted(account) == true`.
- `getWhitelistedRoot(account) != 0x0` is a current-state signal, not an "ever passed" signal.

## Required inputs

- `nameServiceAddress` or explicit Identity address
- `account` to check
- `rpcUrl` and chain configuration

## Execution flow

1. Resolve `IDENTITY` from NameService when used on the deployment.
2. Read `getWhitelistedRoot(account)` or equivalent for the deployed Identity version.
3. Treat non-zero root as tied to a whitelisted identity tree when that is the protocol rule for the deployment.
4. Read `lastAuthenticated(account)` for historical pass status and `getWhitelistedRoot(account)` or `isWhitelisted(account)` for current status.

## Deterministic snippet

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const nameService = new ethers.Contract(
  process.env.NAMESERVICE_ADDRESS,
  ["function getAddress(string) view returns (address)"],
  provider,
);

const identityAddress = await nameService.getAddress("IDENTITY");
const identity = new ethers.Contract(
  identityAddress,
  [
    "function getWhitelistedRoot(address) view returns (address)",
    "function isWhitelisted(address) view returns (bool)",
    "function lastAuthenticated(address) view returns (uint256)",
  ],
  provider,
);

const account = process.env.ACCOUNT;
const root = await identity.getWhitelistedRoot(account);
const isWhitelisted = await identity.isWhitelisted(account);
const lastAuthenticated = await identity.lastAuthenticated(account);

console.log(
  JSON.stringify(
    {
      account,
      identityAddress,
      whitelistedRoot: root,
      isWhitelisted,
      lastAuthenticated: lastAuthenticated.toString(),
    },
    null,
    2,
  ),
);
```

## Return shape

- `isWhitelisted` or equivalent boolean summary
- `whitelistedRoot` or equivalent
- `lastAuthenticated` for historical-pass classification
- optional metadata fields when available

## Failure handling

- NameService cannot resolve `IDENTITY`: stop and fix inputs using [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) (`Identity` / `NameService` for the target environment)—not GoodDocs tables.
- Read failures: return the failing call and next step.
