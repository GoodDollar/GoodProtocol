# GoodDollar Celo — Subgraph Usage Guide

Companion to `gooddollar-celo.graphql`.

## Endpoint

- Explorer: [GoodDollarCelo](https://thegraph.com/explorer/subgraphs/F7314rxGdcpKPC1nN5KCoFW84EGRoUyzseY2sAT9PEkw?view=Query&chain=arbitrum-one)
- Gateway form: `https://gateway.thegraph.com/api/subgraphs/id/F7314rxGdcpKPC1nN5KCoFW84EGRoUyzseY2sAT9PEkw`

---

## Entity Overview

### UBI and usage statistics

**DailyUBI** — day-level UBI pool/quota activity and cycle fields.  
**WalletStat** — wallet behavior aggregates: tx counts/values, claim stats, active/whitelist indicators.  
**TransactionStat** — day-level transaction totals and circulation view.  
**GlobalStatistics** — global claim and distribution rollups.

### Additional UBI history entities

**UBICollected** — collected UBI/community-pool values by block event.  
**UBIHistory** — timeline totals for daily UBI/community-pool.

---

## Field Availability Reference (use before drafting queries)

Use this section to validate what the subgraph already provides before switching data sources.

### DailyUBI

- `id` — day index key (`unix / 86400`)
- `pool` — UBI cycle pool for that day
- `quota` — daily UBI amount per eligible claimer
- `activeUsers` — active users count in scheme context
- `totalUBIDistributed` — amount actually claimed/distributed that day
- `totalClaims` — claim tx count for that day
- `newClaimers` — newly whitelisted users for that day
- `timestamp` — last update timestamp for the record
- `ubiSchemeAddress` — UBIScheme address used for the record
- `balance` — G$ balance held by UBIScheme
- `cycleLength` — current cycle length
- `dayInCycle` — current day position inside cycle

### WalletStat

- `id` — wallet address
- `dateAppeared` — first indexed wallet activity timestamp
- `balance` — running token balance from transfers
- `inTransactionsCount`, `inTransactionsValue` — incoming tx count and value
- `outTransactionsCount`, `outTransactionsValue` — outgoing tx count and value
- `totalTransactionsCount`, `totalTransactionsValue` — total tx count and value
- `inTransactionsCountClean`, `inTransactionsValueClean` — incoming metrics excluding contract-address flows
- `outTransactionsCountClean`, `outTransactionsValueClean` — outgoing metrics excluding contract-address flows
- `totalTransactionsCountClean`, `totalTransactionsValueClean` — total clean traffic metrics
- `lastClaimed` — timestamp of latest UBI claim
- `totalClaimedCount`, `totalClaimedValue` — total claims and cumulative claimed value
- `claimStreak`, `longestClaimStreak` — current and best historical streaks
- `isWhitelisted` — current whitelist status
- `isActiveUser` — current active-user status
- `dateJoined` — first-whitelist timestamp
- `lastTransactionFrom`, `lastTransactionTo` — latest outgoing and incoming tx timestamps

### TransactionStat

- `id` — bucket key (day key or `"aggregated"`)
- `dayStartBlockNumber` — first block in bucket
- `transactionsCount`, `transactionsValue` — all transfer tx count and value
- `transactionsCountClean`, `transactionsValueClean` — transfer metrics excluding contract-address flows
- `totalInCirculation` — inferred circulating supply from mint or burn behavior

### GlobalStatistics

- `id` — fixed key (`"statistics"`)
- `TransactionStat` — link to aggregated transaction stats
- `totalUBIDistributed` — lifetime distributed UBI
- `uniqueClaimers` — tracked unique claimers via whitelist add or remove
- `totalClaims` — lifetime UBI claim events

### Explorer naming

- Singular names (`dailyUBI`, `walletStat`) fetch by `id`
- Plural names (`dailyUBIs`, `walletStats`) query lists with filters and pagination

---

## Typical Questions This Subgraph Answers

- How much UBI was distributed on a day/cycle?
- Which wallets are active or recently claiming?
- What are aggregate tx/circulation trends?
- How did collected UBI/community-pool values evolve over time?

---

## Query Discipline

- Use lowercase address strings in filters.
- Use string-safe handling for large integer values.
- Use `_meta` to validate freshness before cross-day analytics.
- Use authenticated gateway access for programmatic queries.
- Before claiming a field or entity is missing, verify availability from this guide and schema first.
