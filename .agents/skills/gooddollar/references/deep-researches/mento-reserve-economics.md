# Mento and reserve economics

This note ties **macro G$ economics** (GoodDocs) to **Mento trading surfaces** (broker, reserve, expansion) that agents integrate on-chain.

## Protocol-level story (GoodDocs)

- G$ is **reserve-backed**; issuance and price discovery follow an **augmented bonding curve** (Bancor-style dynamics) described in [How GoodDollar works](https://docs.gooddollar.org/how-gooddollar-works).
- **Buying** from the reserve side increases reserve assets and can support **new G$ supply** within reserve rules; **selling back** burns G$ and returns collateral, with parameters governed by **GoodDAO**.
- Distribution of newly created G$ spans UBI, savings incentives, treasury, and ecosystem allocations (same doc), but execution timing depends on the mint path and distribution trigger used by the deployment flow.

## User-facing buy and sell (historical vs current)

- [Buy and Sell G$](https://docs.gooddollar.org/user-guides) describes reserve interaction, fees (including exit contribution on some paths), and older explorer flows (GoodMarketMaker / exchangeHelper on Ethereum testnets). Treat that page as **product narrative**; **live contract addresses** must come only from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json).

## Mento stack (agent integration)

On networks where GoodDollar uses Mento (see `MentoBroker` and related keys in [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) for your environment):

- **`IBroker`** (implementation in [mento-core `Broker.sol`](https://github.com/mento-org/mento-core)) is the usual **swap entrypoint**: `getAmountIn` / `getAmountOut`, `swapIn` (exact in), `swapOut` (exact out), plus **trading limits** state per exchange id and token.
- **Reserve** holds collateral; **exchange provider** contracts price trades against the reserve; **GoodDollarExpansionController** and related interfaces in GoodProtocol’s [`MentoInterfaces.sol`](https://github.com/GoodDollar/GoodProtocol/blob/master/contracts/MentoInterfaces.sol) describe expansion and avatar wiring for governance-facing changes.
- Agents should not hardcode **exchangeId** or provider addresses: read them from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) or discover via `getExchangeProviders()` after confirming the broker address for the chain from that file.

## Agent guidance

1. Explain **macro** supply and reserve behavior with GoodDocs language.
2. Execute **swaps** with broker quotes, slippage bounds, and allowances per `references/guides/swap.md`.
3. On revert, distinguish **slippage / limit** failures (broker) from **reserve liquidity** messages (see `MentoBroker.abi.yaml` error map and mento-core source).
