# Faucet top-up guide

Use when the user needs native gas top-up via GoodProtocol Faucet.

## Goal

Run deterministic pre-checks and call `topWallet` only when eligibility and limits pass.

## Required inputs

- `rpcUrl`, chain configuration, signer
- Faucet address for the chain (from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) `Faucet` under the matching environment, or `NameService.getAddress` when the deployment documents the key)
- target user address

## Execution flow

1. Resolve Faucet contract address for the active chain from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json).
2. Run `canTop(user)` as preflight.
3. Read `getToppingAmount(user)` and communicate expected top-up.
4. If eligible, call `topWallet(user)`.
5. Return tx hash and resulting top-up context.

## Deterministic snippet

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const faucet = new ethers.Contract(
  process.env.FAUCET_ADDRESS,
  [
    "function canTop(address) view returns (bool)",
    "function getToppingAmount(address) view returns (uint256)",
    "function topWallet(address payable)",
  ],
  signer,
);

const user = process.env.USER;
const canTop = await faucet.canTop(user);
if (!canTop) throw new Error("Faucet canTop returned false");

const amount = await faucet.getToppingAmount(user);
const tx = await faucet.topWallet(user);
const receipt = await tx.wait();

console.log(
  JSON.stringify(
    {
      txHash: receipt.hash,
      user,
      toppingAmount: amount.toString(),
    },
    null,
    2,
  ),
);
```

## Common rejection reasons

- `not authorized`
- daily or weekly cap reached
- banned address
- low effective `toTop` vs minimum threshold
- faucet inactive or wrong chain/address

## Output contract

- network
- faucet address
- `canTop` preflight result
- top-up amount estimate
- tx hash (when executed)
