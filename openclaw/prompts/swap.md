Action: `swap` (MentoReserve + Mento exchange via `MentoBroker.swapIn` / `swapOut`)

When to use:
- The user wants to buy `G$` using `cUSD` (`direction = "buy"`).
- The user wants to sell `G$` to receive `cUSD` (`direction = "sell"`).
- Execute the swap through Mento directly via `MentoBroker.swapIn` (buy) or `MentoBroker.swapOut` (sell).

Inputs to request (if missing):
Common:
- `rpcUrl` + `chainId`
- `privateKey` (or other signer) for sending the tx

Mento config (required):
- `mentoBrokerAddress` (address)
- `mentoExchangeProviderAddress` (address)
- `exchangeId` (bytes32; e.g. the CUSD->G$ exchange id)

Tokens (required):
- `cUSDAddress` (address)
- `gdAddress` (address; usually `nameService.getAddress("GOODDOLLAR")`)

Route:
- `direction` (string)
  - `"buy"`: `cUSDInputAmount -> G$` using `MentoBroker.swapIn`
  - `"sell"`: `G$ -> cUSD` using `MentoBroker.swapOut`

Swap amounts:
- If `direction = "buy"`:
  - `cUSDInputAmount` (uint256, required; amountIn in token smallest units)
  - `minAmount` (uint256, optional; minimum `G$` expected)
- If `direction = "sell"`:
  - `cUSDOutputAmount` (uint256, required; exact `cUSD` to receive)
  - `maxGdAmountIn` (uint256, optional; maximum `G$` to spend). If omitted, computed from Mento `getAmountIn` + `slippageBps`.
- `slippageBps` (uint256, optional; default `200` i.e. 2%)

Recipient:
- `buyRecipient` (address, optional; default = signer address). `MentoBroker.swapIn/swapOut` pays out to `msg.sender`, so if `buyRecipient` differs you must transfer the received token afterward (`G$` when buying, `cUSD` when selling).

Execution
1) Pre-check expected amounts (read-only):
   - If `direction = "buy"`:
     - `expectedOut = MentoBroker.getAmountOut(mentoExchangeProviderAddress, exchangeId, cUSDAddress, gdAddress, cUSDInputAmount)`
   - If `direction = "sell"`:
     - `expectedIn = MentoBroker.getAmountIn(mentoExchangeProviderAddress, exchangeId, gdAddress, cUSDAddress, cUSDOutputAmount)`
   - if pre-check reverts, stop and ask for correct `mentoExchangeProviderAddress` + `exchangeId` (or correct token addresses).

2) Choose slippage-bounded limits:
   - If `direction = "buy"`:
     - If `minAmount` provided: use it.
     - Else: `minAmount = expectedOut * (10000 - slippageBps) / 10000`.
   - If `direction = "sell"`:
     - If `maxGdAmountIn` provided: use it.
     - Else: `maxGdAmountIn = expectedIn * (10000 + slippageBps) / 10000`.

3) Approve input token to the broker:
   - If `direction = "buy"`: approve `cUSDInputAmount`.
   - If `direction = "sell"`: approve `maxGdAmountIn`.

4) Execute:
   - If `direction = "buy"`:
     - call `MentoBroker.swapIn(mentoExchangeProviderAddress, exchangeId, cUSDAddress, gdAddress, cUSDInputAmount, minAmount)`
     - let `amountOut` be returned `G$` received.
   - If `direction = "sell"`:
     - call `MentoBroker.swapOut(mentoExchangeProviderAddress, exchangeId, gdAddress, cUSDAddress, cUSDOutputAmount, maxGdAmountIn)`
     - let `amountInUsed` be returned `G$` spent.

5) Deliver to `buyRecipient`:
   - If `buyRecipient` == signer: done.
   - Else:
     - If `direction = "buy"`: `ERC20(gdAddress).transfer(buyRecipient, amountOut)`.
     - If `direction = "sell"`: `ERC20(cUSDAddress).transfer(buyRecipient, cUSDOutputAmount)`.

Post-check (best effort):
- Confirm the tx did not revert.
- If `direction = "buy"`: confirm `amountOut >= minAmount`.
- If `direction = "sell"`: confirm `amountInUsed <= maxGdAmountIn`.

Output to the user:
- tx hash
- `direction`
- chosen limits (`minAmount` or `maxGdAmountIn`)
- amount received (`G$` for buy, `cUSD` for sell)
- recipient used (`buyRecipient`)
