# GoodSDKs integration guide

Use this guide when the task is SDK-first (app integration), not raw contract-first.

## Scope

GoodSDKs is the app integration layer for GoodDollar:

- `@goodsdks/citizen-sdk` for identity and claim flows.
- `@goodsdks/react-hooks` for Wagmi React hooks.
- `@goodsdks/good-reserve` for reserve buy or sell flows.
- `@goodsdks/engagement-sdk` for engagement rewards flows.
- `@goodsdks/ui-components` and `@goodsdks/savings-widget` for web components.

## Routing map

- Check whitelist, identity root, FV link -> `@goodsdks/citizen-sdk` (`IdentitySDK`)
- Claim UBI with entitlement checks and fallback chains -> `@goodsdks/citizen-sdk` (`ClaimSDK`)
- React app with Wagmi and minimal glue code -> `@goodsdks/react-hooks`
- Buy or sell via reserve rails (Celo or XDC support rules) -> `@goodsdks/good-reserve`
- Reward app registration, claims, reward history -> `@goodsdks/engagement-sdk`
- Embeddable UI in non-React or mixed stacks -> `@goodsdks/ui-components` or `@goodsdks/savings-widget`

## Deterministic setup

Monorepo prerequisites:

```bash
cd ~/Projects/GoodSDKs
corepack enable
yarn install --immutable
yarn build
```

Target one workspace:

```bash
yarn workspace @goodsdks/citizen-sdk build
yarn workspace @goodsdks/react-hooks build
```

## Deterministic usage snippets

Identity SDK:

```ts
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { IdentitySDK } from "@goodsdks/citizen-sdk";

const publicClient = createPublicClient({ transport: http("https://forno.celo.org") });
const walletClient = createWalletClient({ transport: custom(window.ethereum) });

const identitySDK = await IdentitySDK.init({
  publicClient,
  walletClient,
  env: "production",
});

const { isWhitelisted, root } = await identitySDK.getWhitelistedRoot("0xYourAccount");
console.log({ isWhitelisted, root });
```

Claim SDK:

```ts
import { ClaimSDK, IdentitySDK } from "@goodsdks/citizen-sdk";

const identitySDK = await IdentitySDK.init({ publicClient, walletClient, env: "production" });
const claimSDK = await ClaimSDK.init({
  publicClient,
  walletClient,
  identitySDK,
  env: "production",
});

const entitlement = await claimSDK.checkEntitlement();
if (entitlement.amount > 0n) {
  const receipt = await claimSDK.claim();
  console.log(receipt.transactionHash);
}
```

React hooks:

```tsx
import { useIdentitySDK, useClaimSDK, useGoodReserve } from "@goodsdks/react-hooks";

const identity = useIdentitySDK("production");
const claim = useClaimSDK("production");
const reserve = useGoodReserve("production");
```

Reserve SDK:

```ts
import { GoodReserveSDK } from "@goodsdks/good-reserve";

const sdk = new GoodReserveSDK(publicClient, walletClient, "production");
const quote = await sdk.getBuyQuote(CUSD_ADDRESS, amountIn);
const tx = await sdk.buy(CUSD_ADDRESS, amountIn, (quote * 95n) / 100n);
console.log(tx.hash);
```

## Agent rules

1. Prefer SDK methods first for app tasks.
2. Use contract-level guides only when SDK does not expose required behavior.
3. Do not invent SDK method names; align with package READMEs and exported types.
4. For chain support errors, report chain and env explicitly (do not silently fallback).
5. For UI tasks, prefer hooks or components over bespoke wallet and viem plumbing.
