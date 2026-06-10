# GoodDocs hub

Canonical protocol documentation lives at [GoodDocs](https://docs.gooddollar.org/).

This is a **routing guide** (quick link map), not a deep protocol analysis note.

## Start here

- [Welcome](https://docs.gooddollar.org/)
- [How GoodDollar works](https://docs.gooddollar.org/how-gooddollar-works)

## User guides

- [Buy and Sell G$](https://docs.gooddollar.org/user-guides) (reserve-backed buy/sell; includes historical Ethereum/Kovan explorer workflows in the doc)
- [Bridge GoodDollars](https://docs.gooddollar.org/user-guides/bridge-gooddollars) (MessagePassingBridge, fees, limits, troubleshooting)
- [Connect another wallet address to identity](https://docs.gooddollar.org/user-guides/connect-another-wallet-address-to-identity)

## Developers

- [Core contracts](https://docs.gooddollar.org/for-developers/core-contracts) (module overview; **do not** read contract addresses from GoodDocs—use [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) only)
- [Developer guides index](https://docs.gooddollar.org/for-developers/developer-guides)
- [Integrate the G$ token](https://docs.gooddollar.org/for-developers/developer-guides/how-to-integrate-the-gusd-token) (ERC-677, ERC-777, decimals by chain, `transferAndCall`, fees)
- [Use G$ streaming](https://docs.gooddollar.org/for-developers/developer-guides/use-gusd-streaming) (Superfluid on Celo, CFAv1Forwarder)

## Chain IDs (bridge doc)

| Network  | Chain ID |
| -------- | -------- |
| Ethereum | 1        |
| Fuse     | 122      |
| Celo     | 42220    |
| XDC      | 50       |

## This repo

- Action playbooks: `references/guides/*.md`.
- Rich ABIs: `references/contracts/*.abi.yaml`.
