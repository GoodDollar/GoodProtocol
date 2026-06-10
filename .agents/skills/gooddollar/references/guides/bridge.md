# Bridge guide

Use for moving G$ across supported networks with deployment-specific bridge contracts.

Primary local ABI reference for MessagePassingBridge flow:

- `references/contracts/MessagePassingBridge.abi.yaml`

## GoodDocs alignment

- User flow and high-level behavior: [Bridge GoodDollars](https://docs.gooddollar.org/user-guides/bridge-gooddollars).
- Resolve supported bridge contract addresses per chain from [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) only (for example `MpbBridge` under `production`, `production-celo`, `production-xdc`). Use [Bridge GoodDollars](https://docs.gooddollar.org/user-guides/bridge-gooddollars) for user-facing flow and troubleshooting, not for addresses.

## Goal

Bridge with deterministic pre-checks: bridge support, allowance, amount, cross-chain transport fee, and delivered G$ after destination **amount** limits and protocol fee.

## Required inputs

- source and destination chain metadata
- bridge contract address for source chain
- source G$ token address
- amount in source token decimals
- signer and rpc url

## Execution flow

1. Resolve source bridge and token addresses for the network pair.
2. Run bridge eligibility checks for sender and amount via `canBridge(from, amount)` on the **source** bridge (same contract you call for `bridgeToWithLz` / `bridgeToWithAxelar`). Outbound burn does not invoke `canBridge` inside `_bridgeTo`; destination mint still enforces **amount** limits (see **Bridge amount limit context**).
3. Read allowance and approve bridge spender when required.
4. Resolve transport mode (`LZ` or `AXELAR`) and estimate required native fee.
5. Send bridge transaction with nonzero `msg.value` and explicit transport method.
6. Return tx hash and normalized bridge parameters.

## Bridge fee context

Two different costs show up on `MessagePassingBridge`; do not conflate them.

**1. Cross-chain transport fee (native gas token on the source chain)**  
Paid as **`msg.value`** on the outbound call. The contract reverts with **`MISSING_FEE`** if `msg.value` is zero. On the **LayerZero** path the contract compares your `msg.value` to **`estimateSendFee`** and reverts **`LZ_FEE(required, sent)`** if it is too low. Use the same **normalized** amount for `estimateSendFee` as the contract uses internally (see the next section). On the **Axelar** path you still attach native value for Gas Service / execution; there is no single `estimateSendFee` analogue in the snippet—follow Envio/Axelar docs or simulate the exact call for production amounts.

**2. Protocol fee on minted G$ (destination chain, basis points)**  
When the message is executed on the **destination** chain, the bridge applies **`bridgeFees`** (min / max / fee bps via `setBridgeFees`) and mints the recipient **minus** that fee; the fee portion is minted to **`feeRecipient`** when it is non-zero (see `bridgeFees()`, `feeRecipient`, and `_takeFee` / `ExecutedTransfer` in `references/contracts/MessagePassingBridge.abi.yaml`). This is **not** the LayerZero relayer fee; it is a separate cut on the **token amount** delivered on arrival.

**3. Optional OFT / LayerZero token-adapter path**  
If the flow uses the GoodDollar OFT-style adapter instead of `MessagePassingBridge`, fee quoting follows **`quoteSend`** / **`MessagingFee`** on that contract; see `references/contracts/GoodDollarOFTAdapter.abi.yaml`.

## Bridge amount limit context

**Bridge limit** means **bridge amount limit**: policy on **how much G$** (token volume) may move—**`minAmount`**, per-transfer cap, per-account daily cap, and aggregate daily cap—plus **`onlyWhitelisted`**. It does **not** mean the cross-chain **native** transport fee (`msg.value`, **`LZ_FEE`**), and it does **not** mean the **destination mint fee** in **`bridgeFees`** (bps); those are covered under **Bridge fee context**.

Amount caps and counters are **per bridge deployment**: read the **source** contract for outbound **amount** policy and usage meters tied to the burn, and the **destination** contract for **`_enforceLimits`** at inbound mint completion; do not assume identical **`bridgeLimits`** across chains.

**1. Amount caps and usage meters**  
**`bridgeLimits()`** exposes **`dailyLimit`**, **`txLimit`**, **`accountDailyLimit`**, **`minAmount`**, and **`onlyWhitelisted`**. Compare those caps to **`bridgeDailyLimit()`** (aggregate **`bridged24Hours`** and **`lastTransferReset`**) and **`accountsDailyLimit(account)`** (same fields per sender). Updates use **`setBridgeLimits`** (access per the ABI). Field-level notes and accessors live in `references/contracts/MessagePassingBridge.abi.yaml`.

**2. Source preflight vs destination enforcement**  
**`canBridge(from, amount)`** on the **source** is a view-only diagnostic for **that amount**: same policy family as amount limit checks, evaluated on the **raw** burn size (not the LayerZero fee normalization). Outbound **`_bridgeTo`** does **not** call **`canBridge`**; call it from the client if you want **`(false, reason)`** before signing instead of learning only from a revert after burn setup. When the message is executed on the **destination**, **`_enforceLimits`** is the hard gate for **amount** throttles and whitelist behavior at mint time.

## Outbound pause, approved requests, and inbound source bridges

These controls are separate from numeric **amount** caps; they still block or relax bridging and can surface as **`BRIDGE_LIMITS`** or inbound skips.

**`pauseBridge`** sets **`isClosed`**; when closed, outbound flow reverts with **`BRIDGE_LIMITS('closed')`**. **`approvedRequests(requestId)`** on the destination lets **`_bridgeFrom`** skip standard **amount** limit enforcement for that completion when set. **`setDisabledBridges`** toggles **`disabledSourceBridges`** entries keyed by **`keccak256(abi.encode(sourceChainId, BridgeService))`**, controlling whether an inbound relay from that source is accepted before the rest of destination handling. See `references/contracts/MessagePassingBridge.abi.yaml`.

## Axelar vs LayerZero on GoodDollar deployments

LayerZero mappings are initialized for Ethereum, Celo, Fuse, and XDC in `initialize` / `upgrade` on `MessagePassingBridge`. The **Axelar** path is only usable where `toAxelarChainId(targetChainId)` returns a non-empty string; the on-chain pure function currently maps **1**, **5**, **42220**, and **44787** only. For **Fuse (122)** or **XDC (50)** targets, use **LZ** (`bridgeToWithLz`) unless governance ships a broader Axelar mapping.

## LayerZero fee and `estimateSendFee`

`bridgeToWithLz` burns the G$ **raw** amount in the source token’s `decimals()`. Inside the contract, LayerZero payload and `estimateSendFee` use a value normalized to **18 decimals** the same way as [GoodBridge `BridgeHelperLibrary.normalizeFromTokenTo18Decimals`](https://github.com/GoodDollar/GoodBridge/blob/master/packages/bridge-contracts/contracts/messagePassingBridge/BridgeHelperLibrary.sol): if `decimals < 18`, multiply by `10^(18 - decimals)`; if `decimals > 18`, divide by `10^(decimals - 18)`; otherwise use the raw amount.

`canBridge(from, amount)` is evaluated on the **raw** burn amount, not the normalized value.

Read `decimals()` from the source G$ contract when building off-chain fee quotes so you stay aligned if a deployment differs.

## Deterministic snippet

```js
import { ethers } from "ethers";

function normalizedForLzFee(raw, tokenDecimals) {
  if (tokenDecimals < 18) return raw * 10n ** BigInt(18 - tokenDecimals);
  if (tokenDecimals > 18) return raw / 10n ** BigInt(tokenDecimals - 18);
  return raw;
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const token = new ethers.Contract(
  process.env.GOODDOLLAR_ADDRESS,
  [
    "function decimals() view returns (uint8)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ],
  signer,
);

const bridge = new ethers.Contract(
  process.env.BRIDGE_ADDRESS,
  [
    "function canBridge(address,uint256) view returns (bool,string)",
    "function toLzChainId(uint256) view returns (uint16)",
    "function estimateSendFee(uint16,address,address,uint256,bool,bytes) view returns (uint256,uint256)",
    "function bridgeToWithLz(address,uint256,uint256,bytes) payable",
    "function bridgeToWithAxelar(address,uint256,uint256,address) payable",
  ],
  signer,
);

const owner = await signer.getAddress();
const targetChainId = Number(process.env.TARGET_CHAIN_ID);
const recipient = process.env.RECIPIENT;
const amount = ethers.parseUnits(process.env.AMOUNT, Number(process.env.DECIMALS));
const transport = (process.env.BRIDGE_TRANSPORT || "LZ").toUpperCase();
const tokenDecimals = await token.decimals();
const normalizedForLzEstimate = normalizedForLzFee(amount, Number(tokenDecimals));

const [canBridge, reason] = await bridge.canBridge(owner, amount);
if (!canBridge) throw new Error(`Bridge blocked: ${reason}`);

const allowance = await token.allowance(owner, process.env.BRIDGE_ADDRESS);
if (allowance < amount) {
  const approveTx = await token.approve(process.env.BRIDGE_ADDRESS, amount);
  await approveTx.wait();
}

let tx;

if (transport === "LZ") {
  const dstEid = await bridge.toLzChainId(targetChainId);
  if (dstEid === 0) throw new Error("Unsupported target chain for LayerZero");

  const adapterParams = process.env.LZ_ADAPTER_PARAMS || "0x";
  const [nativeFee] = await bridge.estimateSendFee(
    dstEid,
    owner,
    recipient,
    normalizedForLzEstimate,
    false,
    adapterParams,
  );
  if (nativeFee <= 0n) throw new Error("Estimated LayerZero fee is zero");

  tx = await bridge.bridgeToWithLz(recipient, targetChainId, amount, adapterParams, {
    value: nativeFee,
  });
} else if (transport === "AXELAR") {
  const nativeFee = ethers.parseEther(process.env.AXELAR_FEE_ETH || "0.01");
  tx = await bridge.bridgeToWithAxelar(recipient, targetChainId, amount, owner, {
    value: nativeFee,
  });
} else {
  throw new Error("Unsupported BRIDGE_TRANSPORT. Use LZ or AXELAR");
}

const receipt = await tx.wait();
console.log(
  JSON.stringify(
    {
      txHash: receipt.hash,
      sourceBridge: process.env.BRIDGE_ADDRESS,
      targetChainId,
      transport,
      recipient,
      rawAmount: amount.toString(),
      tokenDecimals: Number(tokenDecimals),
      normalizedAmountForLz: normalizedForLzEstimate.toString(),
    },
    null,
    2,
  ),
);
```

## Failure handling

- unsupported destination: return targetChainId, bridge address, and transport mode
- fee too low (`LZ_FEE` or underpriced Axelar fee): re-estimate and retry with user confirmation
- approval or balance issue: return required delta
- credited G$ on destination is reduced by **`bridgeFees`** (bps / min / max); that is independent of the source **`msg.value`** transport fee
- **`canBridge`** false on source: return the **`reason`** string from the view call
- **`BRIDGE_LIMITS(reason)`** custom error (see `references/contracts/MessagePassingBridge.abi.yaml` **errors**): **`reason`** labels the failing check (numeric **amount** limit, whitelist, **`closed`**, or other policy string from the implementation)
- source preflight passed but destination still reverts: re-read **`bridgeLimits`** and daily counters for **amount** caps and **`onlyWhitelisted`**; check **`isClosed`**, **`approvedRequests`**, and **`disabledSourceBridges`** per **Outbound pause, approved requests, and inbound source bridges**; message delivery can cross a reset boundary or policy change
