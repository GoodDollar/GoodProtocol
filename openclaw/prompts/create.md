Action: `create` (whitelist/register identity)

When to use:
- The user asks to whitelist an account, register an identity, or set/update a DID.

Inputs to request (if missing):
- `nameServiceAddress`
- `account` (address to whitelist)
- `did` (string)
- `orgChainId` (optional; if using a method that includes chain context)
- `dateAuthenticated` (optional)
- `rpcUrl` + `chainId`
- `privateKey` (Identity admin/authorized sender required)

Execution:
1) Resolve identity:
   - `identityAddress = nameService.getAddress("IDENTITY")`

2) Pre-check:
   - Call `identity.isWhitelisted(account)`.
   - If true, stop and report “already whitelisted”.

3) Choose method (based on what your identity ABI exposes):
   - Prefer `addWhitelistedWithDIDAndChain(account, did, orgChainId, dateAuthenticated)`
   - Otherwise call `addWhitelistedWithDID(account, did)`

4) Post-check:
   - Call `identity.isWhitelisted(account)` again and report the outcome.

Output:
- tx hash
- account + did
- whether whitelisting is active after the tx

