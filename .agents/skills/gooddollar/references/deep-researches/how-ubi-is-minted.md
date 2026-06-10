# How UBI is minted

This document aligns agent explanations with [How GoodDollar works](https://docs.gooddollar.org/how-gooddollar-works) and GoodDocs component pages; **contract addresses** come only from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json).

## Monetary creation (protocol level)

- New G$ is created in connection with reserve mechanics: purchases into the reserve and reserve-side parameters (including reserve ratio) influence how much G$ can be issued while maintaining backing (see sustainability and issuance sections in GoodDocs).
- Selling G$ back to the reserve burns supply in that model.
- G$ that the protocol creates is allocated across UBI, savings incentives, treasury, and ecosystem uses per the distribution section of GoodDocs.

## Where G$ is actually created

Creation happens at the G$ token `mint(...)` call site, not inside `UBIScheme.claim()`.

Current implementation uses the Mento-core expansion path:

- `GoodDollarExpansionController` mints and routes to distribution helper.

**DistributionHelper recipients** decide how much eventually lands in the UBI pool.

## Claim vs reserve minting (important distinction)

- **Reserve path:** Buying G$ through the reserve-backed AMM (or related Mento rails) is where mint and burn tied to the reserve model most directly apply at the token level.
- **Daily UBI `claim()`:** On `UBISchemeV2`, a successful claim typically **transfers G$ from the scheme contract’s balance** to the user (`token.transfer` in `_transferTokens`). The scheme may be **refilled** from the DAO avatar via internal `_withdrawFromDao` when configured, not necessarily minting in the same transaction as `claim()`. So describe user-facing UBI as **receipt from the UBI scheme balance**; reserve **minting** is the macro story, **transfer** is the usual claim-time mechanism.

## Mento-core expansion flow (detailed)

This is the detailed path for modern reserve-ratio-aware expansion.

1. A caller triggers `mintUBIFromExpansion(exchangeId)` on `GoodDollarExpansionController`.
2. Expansion is time-gated by config (`expansionFrequency`, `lastExpansion`), so it does not run every block.
3. Controller computes a reserve-ratio scalar (effectively compounding `(1 - expansionRate)` for elapsed periods).
4. Controller calls `GoodDollarExchangeProvider.mintFromExpansion(exchangeId, reserveRatioScalar)`.
5. Exchange provider updates exchange state (including reserve-ratio math) and returns `amountToMint`.
6. Controller mints G$ to `distributionHelper`.
7. Controller triggers distribution (`onDistribution`) so recipients (including UBIScheme when configured) receive allocation.

Also in `GoodDollarExpansionController`:

- `mintUBIFromInterest(exchangeId, reserveInterest)`
- `mintUBIFromReserveBalance(exchangeId)`

These are additional funding paths that mint to distribution helper as part of reserve-driven policy.

## Reserve ratio, expansion, and risk

- Practical reserve-ratio intuition: collateral backing strength per unit of G$ supply.
- Lower reserve ratio means weaker backing and higher risk when adding new supply.
- Expansion uses reserve-ratio-aware math instead of blind fixed minting, but aggressive params can still increase sell pressure.
- Key policy levers are expansion rate and expansion frequency (plus caller cadence/automation quality).

## What claimers experience

- Verified users receive daily UBI from a pool split among those who claim in each period (GoodDocs).
- The user-facing transaction is a UBIScheme-style `claim` on chains where it is deployed; ABI and version follow your deployment.

## On-chain components (typical)

- Identity system for verification and whitelist roots.
- UBIScheme (or successor) for entitlement and claim execution.
- G$ token: value reaches users via **transfer** from scheme balance and/or broader minting economics from the reserve side depending on which action you analyze.
- DistributionHelper: bridge layer between mint source and recipient buckets (UBI, others).

## Agent guidance

- Use GoodDocs for macro issuance and allocation; use UBIScheme + token transfer behavior for **claim** explanations.
- Use [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) for contract addresses instead of guessing.
- When users ask "why no UBI funding today", check whether mint functions were executed, then verify DistributionHelper recipient config and UBIScheme balance.
