---
name: gooddollar
description: >
  Knowledge base for GoodProtocol action execution and GoodDollar (G$) integrations.
  Use this skill BEFORE ad-hoc web search for claim, save/stake, swap, bridge,
  stream, and identity tasks. Prefer GoodDocs (https://docs.gooddollar.org/) for
  narrative; contract addresses only from GoodProtocol releases/deployment.json.
metadata:
  version: 1.0.0
license: MIT
---

# GoodDollar Skill Pack

Routing index for GoodProtocol. This repo complements [GoodDocs](https://docs.gooddollar.org/) for behavior and user flows. **Contract addresses** come only from [GoodProtocol/releases/deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) (and `meta.deployments` in `references/contracts/*.abi.yaml`, which mirror those rows)—not from GoodDocs pages.

Repository maintenance and update process is documented in `CONTRIBUTING.md`.

## Protocol snapshot (from GoodDocs)

- G$ is reserve-backed; issuance and pricing tie to the reserve and bonding-curve mechanics described in [How GoodDollar works](https://docs.gooddollar.org/how-gooddollar-works).
- The stack is multi-chain; which contracts exist per environment is defined only in [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) (for example `GoodDollar`, `Identity`, `NameService`, `UBIScheme`, Mento keys, `MpbBridge`, and related entries under `production`, `production-celo`, and `production-xdc`).
- UBI is daily for verified users; identity verification and connected accounts are documented under [user guides](https://docs.gooddollar.org/user-guides).

## Guides (single location for action playbooks)

All task-specific instructions live under `references/guides/`.

- `references/guides/claim.md` — daily UBI (`claim` / UBIScheme).
- `references/guides/save.md` — stake, rewards, unstake.
- `references/guides/swap.md` — buy or sell G$ (Mento on supported chains).
- `references/guides/bridge.md` — MessagePassingBridge (GoodDocs); optional OFT path via ABI refs.
- `references/guides/stream.md` — Superfluid streams (Celo-oriented in GoodDocs).
- `references/guides/check-identity.md` — whitelist and connected-address semantics.
- `references/guides/goodsdks.md` — SDK-first integration routing for GoodSDKs packages.
- `references/guides/gooddocs.md` — hub links to [GoodDocs](https://docs.gooddollar.org/).
- `references/guides/hypersync-hyperrpc.md` — Envio HyperSync/HyperRPC data-source routing for high-volume historical reads.
- `references/guides/faucet.md` — Faucet gas top-up execution flow and preflight checks.
- `references/guides/on-off-ramp.md` — stable-token ramp service flow into and out of G$.
- `references/guides/invite-bounties.md` — verify and execute inviter-invitee bounty payouts.
- `references/guides/migrate-fuse-staking-to-celo-savings.md` — migrate Fuse governance stake to CELO savings flow.

## Subgraphs (indexed chain history)

Use this folder with the same pattern as the protocol subgraph references: one `*-guide.md` plus one companion `.graphql` per deployment.

For historical on-chain data, **start with the subgraph**: confirm the deployment covers the question (entities and fields in the guide, freshness via `_meta`). If the subgraph does not work for the request—missing schema coverage, stale or lagging indexing, query limits, or endpoint errors—**then** move to **HyperSync** or **HyperRPC** using `references/guides/hypersync-hyperrpc.md`.

- `references/subgraphs/_query-patterns.md` — cross-cutting query discipline.
- `references/subgraphs/reserve-celo-guide.md` + `references/subgraphs/reserve-celo.graphql` — reserve pricing and swap history.
- `references/subgraphs/gooddollar-celo-guide.md` + `references/subgraphs/gooddollar-celo.graphql` — GoodDollar Celo schema discovery and starter probes.
- `references/subgraphs/goodcollective-guide.md` + `references/subgraphs/goodcollective.graphql` — GoodCollective schema discovery and starter probes.

For Superfluid protocol subgraphs (streams, pools, vesting schedulers), see [Superfluid documentation](https://docs.superfluid.finance/) and [subgraph endpoints](https://subgraph-endpoints.superfluid.dev/).

## Historical data routing policy (strict)

1. Query subgraphs first for all historical/indexed requests.
2. Validate required entities and fields against the target subgraph schema and guide before declaring a gap.
3. Use **HyperSync** or **HyperRPC** fallback only when at least one of these is true:
   - required entities or fields are not available in subgraph schema
   - indexing lag makes subgraph data stale for the requested range
   - query limits or endpoint instability block reliable retrieval
4. Do not start with HyperSync or HyperRPC when subgraph data is available and fresh.
5. HyperRPC fallback requires a valid Envio API key; if missing, **explicitly ask the user** to provide `HYPERRPC_API_TOKEN` or `ENVIO_API_TOKEN` (or paste a full `HYPERRPC_URL`); do not treat anonymous HyperRPC as production.
6. When **HyperSync** is the best option for the query and no Envio API token is available (`ENVIO_API_TOKEN` or equivalent per `references/guides/hypersync-hyperrpc.md`), **explicitly ask the user** to provide the token before proceeding; do not silently substitute anonymous HyperSync usage.
7. When fallback is used, report reason explicitly (schema gap, lag, or reliability issue).

## Data source decision table

| Query type | Primary source | Secondary source | Notes |
|---|---|---|---|
| Current on-chain state (latest balances, allowances, config, flags, view calls) | RPC | None | Use direct contract RPC reads for latest state. |
| Historical indexed entity data (time-series, aggregates, protocol entities, event-derived analytics) | Subgraph | HyperSync/HyperRPC | Prefer subgraph first; fall back when it cannot answer. |
| Historical raw on-chain data when subgraph is missing fields/entities or stale | HyperSync | HyperRPC | Prefer HyperSync for bulk scans and data pipelines. |
| Historical data for existing JSON-RPC integrations | HyperRPC | HyperSync | Use HyperRPC when strict JSON-RPC compatibility is required. |

Decision rule:

1. If request is current state -> use RPC.
2. If request is historical/indexed -> query subgraph first.
3. If subgraph cannot satisfy request -> fallback to HyperSync or HyperRPC per compatibility and scale needs.
4. HyperRPC fallback requires Envio API key credentials.
5. HyperSync client usage requires an Envio API token; if HyperSync is chosen and the token is missing, explicitly ask the user to provide it (see `references/guides/hypersync-hyperrpc.md`).

## Mapping data retrieval rule

Solidity mappings are not iterable on-chain by keyspace scan. Do not assume full-key enumeration is possible from RPC alone.

When data is stored in mapping-like structures:

1. Check contract source and ABI for key-discovery paths first:
   - events emitted on set or update
   - arrays, counters, linked lists, or index getters storing keys
   - dedicated pagination or enumerable view functions
2. If key discovery exists, reconstruct key set from those sources and then read mapping entries.
3. If key discovery does not exist, report that complete iteration is not possible from chain state alone.
4. For historical reconstruction, prefer subgraph indexing first; if unavailable, use HyperSync or HyperRPC log scans with explicit limitations.

## Use-case to guide map

- Claim requests -> `references/guides/claim.md`
- Eligibility or connected-address questions -> `references/guides/check-identity.md`
- Stake, save, unstake -> `references/guides/save.md`
- Buy or sell G$ against reserve rails -> `references/guides/swap.md`
- Cross-chain bridge -> `references/guides/bridge.md`
- Stream management -> `references/guides/stream.md`
- SDK app integration tasks -> `references/guides/goodsdks.md`
- Bulk historical reads or data-engineering fetches -> `references/guides/hypersync-hyperrpc.md`
- Faucet top-up tasks -> `references/guides/faucet.md`
- On-/off-ramp service flow tasks -> `references/guides/on-off-ramp.md`
- Invite bounty eligibility and payout tasks -> `references/guides/invite-bounties.md`
- Fuse to CELO staking migration tasks -> `references/guides/migrate-fuse-staking-to-celo-savings.md`
- Indexed history, analytics, or GraphQL against GoodDollar subgraphs -> `references/subgraphs/_query-patterns.md`
- Historical on-chain fetch when subgraph data is insufficient -> subgraphs first, then HyperSync or HyperRPC per `references/guides/hypersync-hyperrpc.md`; if HyperSync is best and `ENVIO_API_TOKEN` is missing, ask the user for it explicitly.

## Ambiguous prompts and incomplete inputs

Stop and **ask the user** whenever the task is underspecified or required facts are missing. List what you need in short, concrete questions (for example chain, contract, address, amount, account, RPC or signer access, time or block range, prior tx hash, approval scope).

- **Ambiguous** means the goal, environment, contract surface, or acceptance criteria are not clear enough to choose a safe path.
- **Incomplete** means you lack inputs that would change what you build, call, or sign next.

**Do not invent** chain, address, amount, or policy details that affect correctness, funds, or eligibility. For **information-only** work you may state a single explicit assumption, label it, and ask the user to confirm or correct it before going further.

**Execution work** (writing or editing runnable code, sending transactions, migrations, or anything that can move funds or alter on-chain state) has **no guessing**: settle every required input with the user, then implement or run.

## Execution rules

1. Collect missing required inputs before sending transactions.
2. Run pre-checks first (allowance, whitelist, quotes, bridge **amount** limits, peer wiring when using OFT paths).
3. If a pre-check fails, stop and return the exact corrective action.
4. Return tx hash and key output values.
5. Never fabricate addresses, amounts, or ABI behavior.
6. Resolve decimals and units per chain as in [How to integrate the G$ token](https://docs.gooddollar.org/for-developers/developer-guides/how-to-integrate-the-gusd-token) (for example 18 decimals on Celo, 2 on Fuse and Ethereum where applicable).

## Pre-check matrix

- Claim: verify identity whitelist status before `claim()`.
- Save or stake: verify balance and allowance before `stake()`.
- Swap: fetch quote, apply slippage bounds, verify allowance; confirm Mento contract keys for the active chain exist in `deployment.json` (for example `MentoBroker` under `production-celo` or `production-xdc`).
- Bridge (MessagePassingBridge): on the **source** chain approve G$ to the bridge; optionally preflight `canBridge(from, amount)` on that same contract (outbound `_bridgeTo` does not call it internally). For LZ use `estimateSendFee` with the **normalized** burn amount per `references/guides/bridge.md`, then `bridgeToWithLz` with nonzero `msg.value` for the **cross-chain transport** fee only (distinct from destination **`bridgeFees`** on minted G$; see **Bridge fee context** in that guide). Read **`bridgeLimits`** / daily trackers when debugging **amount** caps; see **Bridge amount limit context** in that guide. Respect `isClosed`, `LZ_FEE`, `MISSING_FEE`, and `UNSUPPORTED_CHAIN`. **Destination** mint applies `_enforceLimits` and can still revert. Use **Axelar** only when `toAxelarChainId` returns a route (implementation maps 1, 5, 42220, 44787); for Fuse or XDC style targets prefer LZ unless mapping is extended on-chain.
- Bridge (OFT adapter path): verify peer wiring and `quoteSend` fee data.
- Stream: confirm Celo (or documented Superfluid network) and correct Super Token and forwarder or host addresses.
- Identity: resolve Identity from NameService; remember connected addresses do not multiply daily claims ([connect wallet guide](https://docs.gooddollar.org/user-guides/connect-another-wallet-address-to-identity)).

## Output format requirements

For any state-changing action return:

- network and key contract addresses used
- normalized input amounts and min or max guards
- tx hash
- key post-state output when available
- follow-up action if user intervention is required

## Rich contract ABI references

Convention: each `Foo.abi.yaml` has a companion `Foo.selectors.yaml` (function, event, and custom error selectors). Schema: `references/contracts/_rich-abi-yaml-format.md`.

GoodDollar / Mento:

- `references/contracts/NameService.abi.yaml`
- `references/contracts/IdentityV3.abi.yaml`
- `references/contracts/IdentityV4.abi.yaml`
- `references/contracts/InvitesV2.abi.yaml`
- `references/contracts/BuyGDCloneFactory.abi.yaml`
- `references/contracts/BuyGDCloneV2.abi.yaml`
- `references/contracts/GovernanceStakingV2.abi.yaml`
- `references/contracts/GooddollarSavingsStream.abi.yaml` (Ubeswap Superfluid stream savings; Celo deployment)
- `references/contracts/UBISchemeV2.abi.yaml`
- `references/contracts/MentoBroker.abi.yaml`
- `references/contracts/MessagePassingBridge.abi.yaml`
- `references/contracts/GoodDollarOFTAdapter.abi.yaml`
- `references/contracts/CFAv1Forwarder.abi.yaml`
- `references/contracts/ConstantFlowAgreementV1.abi.yaml`
- `references/contracts/Superfluid.abi.yaml`
- `references/contracts/SuperToken.abi.yaml`

Superfluid (CFA, CFAv1Forwarder, Host, full ABI library): use [Superfluid docs](https://docs.superfluid.finance/), npm packages such as `@superfluid-finance/ethereum-contracts` and `@sfpro/sdk`, and contract ABIs published with those packages.

## Deep researches

- `references/deep-researches/on-off-ramp-service.md`
- `references/deep-researches/how-ubi-is-minted.md`
- `references/deep-researches/inviter-invitee-reward-model.md`
- `references/deep-researches/mento-reserve-economics.md`
- `references/deep-researches/gooddao-daostack-surface.md`
- `references/deep-researches/faucet-flows.md`
- `references/deep-researches/fuse-to-celo-staking-migration.md`

## Revert debugging quick map

- Identity or eligibility errors -> Identity and UBIScheme ABIs; live addresses from `deployment.json` only; GoodDocs for whitelist and claim behavior.
- Approval or transfer failures -> token approvals and balances; see integration guide for `transferAndCall` vs `approve` plus `transferFrom`.
- Swap bound failures -> quote freshness and slippage settings.
- MessagePassingBridge failures -> `canBridge`; **`BRIDGE_LIMITS`** (amount caps, whitelist, **`closed`**, and related policy strings); transport `msg.value` (`MISSING_FEE`, `LZ_FEE`) vs destination protocol fee (`bridgeFees`, `feeRecipient`); correct `bridgeTo` arguments; [Bridge GoodDollars](https://docs.gooddollar.org/user-guides/bridge-gooddollars).
- OFT path failures -> peer wiring and `quoteSend` fee data.
- Stream failures -> CFA forwarder or host agreement calls, buffer and flow-rate limits per Superfluid docs linked from GoodDocs.
- Faucet top-up failures -> `canTop`, `onlyAuthorized`, daily or weekly caps; `references/deep-researches/faucet-flows.md`.
- DAO-gated reverts -> caller is not avatar; scheme not registered; `references/deep-researches/gooddao-daostack-surface.md`.

## Library usage discipline

1. Open `references/guides/gooddocs.md` when unsure which GoodDocs page applies.
2. Start at this file to classify intent.
3. Open one guide under `references/guides/` unless the user requests a multi-step workflow. For subgraph or indexed-data tasks, start at `references/subgraphs/_query-patterns.md`.
4. Read only the ABI references and matching `.selectors.yaml` files needed for the chosen action.
5. Prefer GoodDocs for documented behavior; use only `deployment.json` (and rich ABI `meta.deployments` aligned with it) for contract addresses—never infer addresses from GoodDocs.
6. For large historical reads, prefer `references/guides/hypersync-hyperrpc.md` and choose HyperSync over HyperRPC unless strict JSON-RPC compatibility is required.
7. Historical data routing is strict: subgraphs first; HyperSync or HyperRPC only with an explicit fallback reason.
8. HyperRPC usage requires Envio API key credentials; when absent, **explicitly ask the user** for `HYPERRPC_API_TOKEN` or `ENVIO_API_TOKEN` (or a full `HYPERRPC_URL`) and do not attempt anonymous production flow.
9. When HyperSync is the best historical-data path and no Envio API token is available, explicitly ask the user to provide `ENVIO_API_TOKEN` (or the token your client expects) before continuing; see `references/guides/hypersync-hyperrpc.md`.
10. For subgraph tasks, validate field availability from the relevant `references/subgraphs/*-guide.md` and companion `.graphql` before guessing alternate entities.
11. For local shells repeating HyperRPC log pulls (for example last N whitelist events), from the **GoodSkills repository root** run `scripts/fetch-whitelist-events-hyperrpc.mjs` per `references/guides/hypersync-hyperrpc.md` instead of re-deriving JSON-RPC setup each time; that script ships with **defaults for production Celo** (HyperRPC host + `Identity` contract from `deployment.json`) and URL composition from `HYPERRPC_API_TOKEN` or `ENVIO_API_TOKEN` unless you override `CONTRACT_ADDRESS` / `HYPERRPC_URL`. HyperSync remains a separate client install path documented in the same guide.
