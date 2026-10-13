---
name: claim
description: Claim daily GoodDollar UBI via `UBIScheme.claim()` using `IDENTITY` whitelist checks.
---

Action: `claim` (GoodProtocol UBI claim)

When to use:
- The user asks to claim, claim UBI, claim daily income, or similar.

Inputs to request (if missing):
- `nameServiceAddress`
- `claimer` address (optional; default to signer address)
- `rpcUrl` + `chainId`
- `privateKey` (or other signer) for sending the tx

Execution:
1) Resolve addresses:
   - `identityAddress = nameService.getAddress("IDENTITY")`
   - `ubiSchemeAddress = nameService.getAddress("UBISCHEME")`

2) Pre-check whitelist (avoid revert):
   - Call `identity.getWhitelistedRoot(claimer)` (view).
   - If it returns `0x0000000000000000000000000000000000000000`, stop and report: not whitelisted.

3) Optional entitlement check:
   - Call `UBISchemeV2.checkEntitlement()` *as if `msg.sender = claimer`* (it has no parameters and is `msg.sender`-dependent).
   - If the returned entitlement is `0`, report that claiming may be unavailable (likely already claimed today).

4) Send tx:
   - Call `UBISchemeV2.claim()` with the active signer.
   - If the deployed ABI is `UBIScheme` (non-V2), call `UBIScheme.claim()` instead.

Output to the user:
- tx hash
- brief success/failure message
- if possible, summarize claim result (event decoding when available; otherwise confirm tx succeeded)

