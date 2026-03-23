Action: `check identity` (is account whitelisted/authenticated?)

When to use:
- The user asks whether an address is eligible to claim UBI.
- The agent needs to validate identity status before submitting actions.

Inputs to request (if missing):
- `nameServiceAddress`
- `account` to check
- `rpcUrl` + `chainId`

Execution:
1) Resolve:
   - `identityAddress = nameService.getAddress("IDENTITY")`

2) Prefer root-based check (UBISchemeV2 claim logic compatibility):
   - Call `identity.getWhitelistedRoot(account)`.
   - If it returns `0x0000000000000000000000000000000000000000`:
     - isWhitelisted = false
   - Else:
     - isWhitelisted = true

3) Fallback check:
   - Call `identity.isWhitelisted(account)` if root-based call is not available.

4) Optional:
   - Call `identity.lastAuthenticated(account)` if available and include it in the response.

Output to the user:
- `isWhitelisted`: boolean
- `whitelistedRoot`: address or `0x0`
- `lastAuthenticated`: timestamp (if fetched)

