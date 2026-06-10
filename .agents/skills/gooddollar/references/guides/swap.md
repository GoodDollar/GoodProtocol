# Swap guide

Use for buying or selling G$ through Mento-connected contracts on networks where they appear in [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) (for example `MentoBroker`, `MentoReserve`, `MentoExchangeProvider`, `MentoExpansionController` keys under `production-celo` or `production-xdc`). GoodDocs describes Mento product behavior, not deployment addresses.

## GoodDocs alignment

- Reserve and buy or sell mechanics at the protocol level: [How GoodDollar works](https://docs.gooddollar.org/how-gooddollar-works) and [Buy and Sell G$ user guide](https://docs.gooddollar.org/user-guides) (includes reserve AMM narrative; older explorer step-by-step for Ethereum testnets remains in that page for reference).
- Integration patterns and decimals: [How to integrate the G$ token](https://docs.gooddollar.org/for-developers/developer-guides/how-to-integrate-the-gusd-token).

## Goal

Execute bounded swaps using broker quotes and correct allowances.

## Required inputs

- `direction` as buy or sell
- broker and exchange identifiers for the deployment
- amounts in correct token decimals for the chain
- `rpcUrl`, chain configuration, signer

## Execution flow

1. Confirm Mento Broker (and related) addresses for the chain from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) only.
2. Fetch quote (`getAmountOut` or `getAmountIn` depending on direction and ABI).
3. Apply slippage bounds.
4. Approve the spent token for the broker when required.
5. Call `swapIn` or `swapOut` per your integration.
6. Return tx hash and effective amounts.

## Deterministic snippet

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const broker = new ethers.Contract(
  process.env.BROKER_ADDRESS,
  [
    "function getAmountOut(address,address,uint256) view returns (uint256)",
    "function swapIn(address,address,uint256,uint256) returns (uint256)",
  ],
  signer,
);

const tokenIn = new ethers.Contract(
  process.env.TOKEN_IN,
  [
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ],
  signer,
);

const amountIn = ethers.parseUnits(process.env.AMOUNT_IN, Number(process.env.DECIMALS_IN));
const quotedOut = await broker.getAmountOut(process.env.TOKEN_IN, process.env.TOKEN_OUT, amountIn);
const slippageBps = BigInt(process.env.SLIPPAGE_BPS);
const minOut = quotedOut * (10000n - slippageBps) / 10000n;

const owner = await signer.getAddress();
const allowance = await tokenIn.allowance(owner, process.env.BROKER_ADDRESS);
if (allowance < amountIn) {
  const approveTx = await tokenIn.approve(process.env.BROKER_ADDRESS, amountIn);
  await approveTx.wait();
}

const tx = await broker.swapIn(process.env.TOKEN_IN, process.env.TOKEN_OUT, amountIn, minOut);
const receipt = await tx.wait();
console.log(
  JSON.stringify(
    { txHash: receipt.hash, amountIn: amountIn.toString(), minOut: minOut.toString() },
    null,
    2,
  ),
);
```

## Failure handling

- No deployment on chain: direct the user to an environment that defines the needed keys in [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) (for example `production-celo` with `MentoBroker`).
- Stale quote or tight slippage: refresh quote or relax bounds with user consent.
- Allowance or balance shortfall: report exact delta.
