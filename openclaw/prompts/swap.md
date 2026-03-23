Action: `swap` (ExchangeHelper buy/sell)

When to use:
- The user asks to swap, buy GD, sell GD, or convert between tokens handled by the protocol reserve + Uniswap.

Inputs to request (if missing):
- `nameServiceAddress`
- `mode`: `buy` or `sell`
- `rpcUrl` + `chainId`
- `privateKey` (or other signer) for sending the tx
- `targetAddress` (optional; if `0x0000000000000000000000000000000000000000`, outputs go to the signer/`msg.sender`)

Buy inputs:
- `buyPath` (address[])
- `tokenAmount` (uint256)
- `minReturn` (uint256)
- `minDAIAmount` (uint256)

Sell inputs:
- `sellPath` (address[])
- `gdAmount` (uint256)
- `minReturn` (uint256)
- `minTokenReturn` (uint256)

Execution:
1) Resolve:
   - `exchangeHelperAddress = nameService.getAddress("EXCHANGE_HELPER")`

2) Approve input tokens (if required):
   - If `mode == "buy"` and `buyPath[0] != address(0)` (ERC20 input):
     - Approve `ERC20(buyPath[0])` to `exchangeHelperAddress` for `tokenAmount`.
   - If `mode == "sell"`:
     - Approve `GOODDOLLAR` to `exchangeHelperAddress` for `gdAmount`.
   - If `mode == "buy"` and `buyPath[0] == address(0)` (ETH input):
     - No ERC20 approval; you must send `msg.value`.

3) Send tx:
   - Path sanity checks before sending:
     - For `buy`: when doing a Uniswap-style multi-hop swap, `buyPath` must end with `DAI` (the helper enforces this unless `buyPath[0]` is already `CDAI` or `DAI`).
     - For `sell`: if `sellPath` is not the single-token `CDAI` case, `sellPath[0]` must be `DAI` (helper redeems to DAI and then requires Uniswap input to be DAI).
   - If `mode == "buy"`:
     - Call `ExchangeHelper.buy(buyPath, tokenAmount, minReturn, minDAIAmount, targetAddress)`
     - If `buyPath[0] == address(0)` means ETH, include `msg.value = tokenAmount`; otherwise `msg.value = 0`.
   - If `mode == "sell"`:
     - Call `ExchangeHelper.sell(sellPath, gdAmount, minReturn, minTokenReturn, targetAddress)`
     - `msg.value` must be `0`.

Output to the user:
- tx hash
- confirm `buy` vs `sell`
- if possible, interpret `TokenPurchased` / `TokenSold` events when decoding is available

