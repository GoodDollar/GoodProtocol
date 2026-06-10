# GoodCollective — Subgraph Usage Guide

Companion to `goodcollective.graphql`.

## Endpoint

- Explorer: [GoodCollective](https://thegraph.com/explorer/subgraphs/3LbJh9DXhJVvuVDdm5i6StNboJmL9oMNNkBaKyzc4Y8Y?view=Query&chain=arbitrum-one)
- Gateway form: `https://gateway.thegraph.com/api/subgraphs/id/3LbJh9DXhJVvuVDdm5i6StNboJmL9oMNNkBaKyzc4Y8Y`

---

## Terminology: “claim” here is not daily UBI

In this subgraph, **Claim** and **ClaimEvent** refer to **GoodCollective reward or pool claim flows**, not the protocol’s **daily UBI claim** from `UBIScheme` / `UBISchemeV2`.

When a user says **“claim”** in normal GoodDollar product language, they almost always mean **claim daily UBI**. For that, use the GoodDollar Celo subgraph (`walletStats` / claim-related aggregates) and on-chain `claim` per `references/guides/claim.md` — do not answer “last N UBI claims” from GoodCollective **Claim** alone.

---

## Entity Overview

### Core collective graph

**Collective** — pool identity, limits/settings links, totals, and claim/payment counters.  
**Donor** / **Steward** — participant-level donation/support state.  
**DonorCollective** / **StewardCollective** — join entities tying participants to a collective.

### Claim and support flow

**Claim** and **ClaimEvent** — GoodCollective **reward** claim lifecycle and per-claim reward events (not daily UBI from UBIScheme).  
**SupportEvent** — support/donation change events across donor/collective links.

### Metadata and policy entities

**IpfsCollective** — IPFS metadata projection.  
**PoolSettings**, **UBILimits**, **SafetyLimits** — pool policy and operational bounds.  
**ProvableNFT** — NFT linkage used in claim/reward flows.

---

## Typical Questions This Subgraph Answers

- Which donors/stewards are attached to a collective?
- How much was donated/rewarded per collective and per participant?
- Which claim events occurred and what reward quantities were emitted?
- What limits and settings govern a specific collective pool?

---

## Query Discipline

- Use authenticated gateway access for programmatic queries.
- Lowercase address-like identifiers where applicable.
- Validate `_meta` before operational dashboards or reporting exports.
