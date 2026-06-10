# On- and off-ramp service via stable token swap

Use this note for the service pattern where ramp providers do not list G$ directly. The practical path is: ramp in/out with a listed stable token (for example cUSD), then swap between stable and G$ on-chain.

## Why this is required

- Most on-/off-ramp providers list mainstream stable tokens, not G$.
- Service needs a bridge asset for fiat rails.
- Stable token becomes the integration point with ramp providers, while G$ remains the in-app asset.

## On-chain source of truth

- Solidity: [`contracts/utils/BuyGDClone.sol`](https://github.com/GoodDollar/GoodProtocol/blob/master/contracts/utils/BuyGDClone.sol)
- Components:
  - `BuyGDCloneFactory`
  - `BuyGDCloneV2`
  - `DonateGDClone`
- Deployments: [releases/deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json)

## Service architecture

The factory deploys EIP-1167 minimal clones and wires swap infrastructure (router, oracle, quoter, optional Mento broker configuration, G$ token, stable token).

Swap execution is **dual-path**:

- **Uniswap-style route** (router/quoter path)
- **Mento-based route** (broker/exchange-provider path)

For each swap request, the service compares quoted outputs and selects the route with the **larger `amountOut`** (best execution for the same input amount), then enforces `minAmount` guard on the selected path.

Each user gets a deterministic clone address from owner-based salt:

- `predict(owner)` for buy clone
- `predictDonation(owner, donor)` for donation clone

This is why clone-per-user design is used:

- predictable per-user addresses for audit and routing
- isolated execution context
- cheaper deployment than full contract instances

## Execution surface (conceptual)

The operational surface is intentionally small and deterministic:

- `create(owner)`
- `createAndSwap(owner, minAmount)`
- `predict(owner)`
- `createDonation`, `createDonationAndSwap`, `predictDonation`

This keeps on-/off-ramp architecture auditable and predictable across users.

## Risks

- Wrong factory or wrong chain causes permanent fund loss risk.
- Stale router/oracle/mento config can fail swap or produce bad execution.
- Missing `minAmount` protection increases slippage risk.
- Quote source mismatch or stale quotes across Uniswap/Mento can pick a suboptimal route if not refreshed just before execution.

## Boundary note

This file explains **why** this architecture exists for ramp services and why per-user clones matter.  
For step-by-step service execution flow, use `references/guides/on-off-ramp.md`.

## Cross-reference

- User narrative: [Buy and Sell G$](https://docs.gooddollar.org/user-guides)
- Token integration details: [How to integrate the G$ token](https://docs.gooddollar.org/for-developers/developer-guides/how-to-integrate-the-gusd-token)
- Broker ABI: `references/contracts/MentoBroker.abi.yaml`
