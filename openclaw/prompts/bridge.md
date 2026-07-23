---
name: bridge
description: Bridge tokens across chains using the LayerZero OFT adapter (`GoodDollarOFTAdapter`, call `send(...)` with `SendParam`). Use when the user asks to bridge via the OFT path, needs `quoteSend(...)` fee estimation, must set the OFT `peer`, and needs to approve the underlying token to the `minterBurner`.
---

# Bridge Tokens (GoodDollarOFTAdapter + viem)

## Instructions

When the user wants to bridge assets cross-chain:

1. Identify inputs
   - `oftAdapterAddress` (source chain `GoodDollarOFTAdapter` proxy address)
   - `dstEid` (destination LayerZero Endpoint ID used by OFT)
   - `recipient` (address to receive on the destination chain)
   - `amountLD` (amount in local token decimals, used in `SendParam`)
   - `minAmountLD` (min amount for slippage protection; commonly equals `amountLD`)
   - `walletClient` / `publicClient` (viem clients) and the `account` that sends from
   - `privateKey` (if you only have a private key)

2. OFT wiring checks (peer + options)
   - Ensure the destination peer is configured on the source adapter:
     - read `oftAdapter.peers(dstEid)` and confirm it matches the destination adapter address as `bytes32` (normally `hexZeroPad(destOftAdapterAddress, 32)`).
   - If you get enforced-options failures (or `InvalidWorkerOptions`), you likely need correct LayerZero wiring for both chains; then retry with proper `extraOptions` (see step 4).

3. Approve the underlying token to the minter/burner (required)
   - `GoodDollarOFTAdapter.approvalRequired()` returns `false` (adapter itself doesn't pull ERC20), but the *minterBurner* still needs allowance because it calls `burnFrom`.
   - Read `underlyingToken = oftAdapter.token()`
   - Read `minterBurner = oftAdapter.minterBurner()`
   - Check `underlyingToken.allowance(account.address, minterBurner)`
   - If allowance is insufficient, send `underlyingToken.approve(minterBurner, amountLD)`

4. Build `SendParam` and estimate LayerZero fees
   - `SendParam` fields:
     - `dstEid`
     - `to`: `hexZeroPad(recipient, 32)` (OFT expects `bytes32`)
     - `amountLD`
     - `minAmountLD`
     - `extraOptions`: usually `0x` (but may need adapter-specific enforced options)
     - `composeMsg`: `0x` (unless you know you need compose functionality)
     - `oftCmd`: `0x` (unused in default)
   - Optionally build options via `oftAdapter.combineOptions(dstEid, 1 /* SEND */, "0x")` if available and if `0x` fails.
   - Estimate messaging fees:
     - call `oftAdapter.quoteSend(sendParam, false /* payInLzToken */)` to get `{ nativeFee, lzTokenFee }`.

5. Send the OFT transfer
   - call `oftAdapter.send(sendParam, messagingFee, refundAddress, { value: messagingFee.nativeFee })`
   - `refundAddress` is typically `account.address`.

6. Confirm initiation / track completion
   - On the source chain tx receipt, look for the `Send` event (its `amountLD` and `to` tell you what was initiated).
   - Completion on destination is asynchronous via LayerZero; track via [LayerZeroScan](https://layerzeroscan.com/) using the source tx hash (and/or wait for the destination mint/credit, then check the recipient balance).

## Common failure modes (quick diagnosis)

- `NoPeer` / peer mismatch: destination peer not set; configure `oftAdapter.setPeer(dstEid, bytes32(destOftAdapterAddress))` (or run LayerZero wiring).
- `InvalidWorkerOptions` / enforced options failures: `"extraOptions"` needs to be derived via `combineOptions(...)` and/or LayerZero wiring must be completed.

## Output to the user

- tx hash
- recipient
- amountLD / minAmountLD
- (best-effort) destination completion guidance (LayerZero is async)

