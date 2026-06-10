# GoodDAO and DAOStack surface

GoodProtocol’s on-chain **governance shell** is largely **DAOStack-shaped**: an **Avatar** holds protocol assets and reputation context; a **Controller** registers **schemes** and routes privileged calls. GoodDocs summarizes DAO-facing roles; **Avatar**, **Controller**, and other DAO contract addresses live only in [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json). Implementation follows [DAOStack Arc](https://github.com/daostack/arc) patterns.

## Core interfaces (GoodProtocol)

[`DAOStackInterfaces.sol`](https://github.com/GoodDollar/GoodProtocol/blob/master/contracts/DAOStackInterfaces.sol) defines the pieces most integrations touch:

### Avatar

- **`nativeToken()`** — often the G$ token address for the deployment.
- **`nativeReputation()`** — **`GReputation`** token for voting weight (see `GReputation` in `deployment.json`).
- **`owner()`** — owner of the Avatar, typically the **`Controller`** contract.

### Controller

- **`avatar()`** — address of the Avatar contract.
- **`registerScheme` / `unregisterScheme` / `unregisterSelf` / `isSchemeRegistered` / `getSchemePermissions`** — scheme lifecycle and permission bitmask per scheme+avatar.
- **`genericCall(contract, data, avatar, value)`** — executes arbitrary calls **as the avatar** (used heavily by DAO-backed contracts to move tokens or call NameService).
- **`mintTokens`**, **`externalTokenTransfer`**, **`sendEther`** — treasury-style operations through the controller/avatar.

## How GoodProtocol contracts use it

- **`DAOUpgradeableContract`** / **`DAOContract`** descendants resolve **`dao`** (Controller) and **`avatar`** from **NameService** keys such as **`CONTROLLER`** and **`AVATAR`** (also written during **NameService.initialize**).
- **Avatar-gated writes** (for example **NameService.setAddress**, **UBISchemeV2** admin functions, **IdentityV3** after `initDAO`) require **`msg.sender == dao.avatar()`** (or equivalent role), not EOAs.
- Schemes that upgrade themselves (for example staking **`upgrade()`**) use **`dao.genericCall`** and **`unregisterSelf`** against the avatar.

## What agents should do

1. Treat **DAO calls** as **governance-only** unless the user explicitly controls the avatar or a registered scheme.
2. For **read-only** work, use **NameService** and per-contract **view** functions; use **Controller.isSchemeRegistered** when validating that a target contract is an approved scheme (for example staking migrations).
3. Never fabricate **Avatar** or **Controller** addresses — use [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) or NameService.

## References

- [Core contracts — DAO contracts](https://docs.gooddollar.org/for-developers/core-contracts) (narrative only; addresses from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) only)
- DAOStack Arc controller and avatar concepts in the upstream repo linked from GoodDocs.
