# Reserve Celo — Subgraph Usage Guide

Companion to `reserve-celo.graphql`. This guide is for reserve pricing and broker swap indexing on Celo.

## Endpoint

- Goldsky: `https://api.goldsky.com/api/public/project_cmizuamdtfouu01x4csuk5dk1/subgraphs/reserve_celo/1.0/gn`

---

## Entity Overview

### Core entity

**ReservePrice** — one indexed reserve pricing point produced from broker swap flow plus exchange-provider price read.  
Key fields: `exchangeId`, `exchangeProvider`, `price`, `timestamp`, `day`, `tokenIn`, `tokenOut`, `amountIn`, `amountOut`, `user`, `blockNumber`, `transactionHash`.

---

## Typical Questions This Subgraph Answers

- What are the most recent reserve prices?
- What was the reserve price on a specific day window?
- Which token pair and user triggered a pricing point?
- Which tx hash/block produced a given price point?

---

## Query Discipline

- Lowercase all address values in filters.
- Use string values for large integer variables.
- Use `_meta` before analytics queries when stale indexing is suspected.

---

## Practical Start

1. Check `_meta` block height and `hasIndexingErrors`.
2. Pull latest `ReservePrice` records sorted by `timestamp desc`.
3. Add `day`-based narrowing for historical windows.
