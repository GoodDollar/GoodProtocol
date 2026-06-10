# On- and off-ramp service guide

Use when implementing service flow where fiat ramps support a listed stable token (for example cUSD), and the app needs stable <-> G$ swap on-chain.

## Goal

Operate deterministic clone-based swap routing with explicit chain/factory verification and slippage guard.

## Required inputs

- target chain and factory address
- owner address used for clone derivation
- stable token and G$ token addresses
- direction: on-ramp or off-ramp
- `minAmount` guard
- signer and rpc url

## Execution flow

1. Resolve factory for target chain from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) (`BuyGDFactory` / `BuyGDFactoryV2` under `production-celo`, or the key your deployment uses).
2. Compute expected clone via `predict(owner)`.
3. If clone not yet deployed for flow, call `create(owner)` or `createAndSwap(owner, minAmount)`.
4. Execute stable -> G$ (on-ramp) or G$ -> stable (off-ramp) through clone path.
5. Return chain id, factory, predicted clone, effective clone, tx hashes.

## Deterministic snippet

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const factory = new ethers.Contract(
  process.env.BUY_GD_CLONE_FACTORY,
  [
    "function predict(address) view returns (address)",
    "function create(address) returns (address)",
    "function createAndSwap(address,uint256) returns (address)",
  ],
  signer,
);

const owner = process.env.OWNER;
const minAmount = ethers.parseUnits(process.env.MIN_AMOUNT, Number(process.env.DECIMALS_OUT));
const predicted = await factory.predict(owner);

const tx = await factory.createAndSwap(owner, minAmount);
const receipt = await tx.wait();

console.log(
  JSON.stringify(
    {
      txHash: receipt.hash,
      owner,
      predictedClone: predicted,
      chainId: (await provider.getNetwork()).chainId.toString(),
    },
    null,
    2,
  ),
);
```

## Failure handling

- predicted clone mismatch with trusted expectation
- wrong chain or wrong factory address
- swap output below `minAmount`
- stale router/oracle or exchange configuration

## Output contract

- network and chain id
- factory address
- predicted and actual clone addresses
- tx hashes
