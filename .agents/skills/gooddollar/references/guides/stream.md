# Stream guide

Primary references for stream execution are local ABI assets in this repo:

- `references/contracts/CFAv1Forwarder.abi.yaml`
- `references/contracts/ConstantFlowAgreementV1.abi.yaml`
- `references/contracts/Superfluid.abi.yaml`
- `references/contracts/SuperToken.abi.yaml`

## Goal

Create, update, or delete Superfluid constant flows using deterministic contract calls and local ABI references.

## Protocol facts used by this guide

- Forwarder path uses `CFAv1Forwarder.createFlow`, `updateFlow`, `deleteFlow`.
- Host path uses `Superfluid.callAgreement` with CFA calldata for `createFlow`, `updateFlow`, `deleteFlow`.
- Stream token is a SuperToken; flow rates are `int96` in token-wei per second.
- `getBufferAmountByFlowrate(token, flowRate)` is the canonical pre-check for required buffer.

## Two implementation styles in this repo

1. **Forwarder (matches GoodDocs):** call CFAv1Forwarder with token, sender, receiver, flowRate, userData.
2. **Host callAgreement:** encode CFA `createFlow` / `updateFlow` / `deleteFlow` and call `Superfluid.callAgreement`.

## Minimal method map

- Forwarder:
  - `createFlow(address token, address receiver, int96 flowrate, bytes userData)`
  - `updateFlow(address token, address receiver, int96 flowrate, bytes userData)`
  - `deleteFlow(address token, address sender, address receiver, bytes userData)`
  - `getBufferAmountByFlowrate(address token, int96 flowrate)`
- Host:
  - `callAgreement(address agreementClass, bytes callData, bytes userData)`
- CFA:
  - `createFlow(address token, address receiver, int96 flowRate, bytes ctx)`
  - `updateFlow(address token, address receiver, int96 flowRate, bytes ctx)`
  - `deleteFlow(address token, address sender, address receiver, bytes ctx)`

## Required inputs

- G$ Super Token address for the environment
- CFA forwarder address, or Superfluid host address plus CFA agreement address
- `action`: create, update, delete
- `receiver`, `flowRate` where applicable
- `rpcUrl`, chain configuration, signer

## Deterministic snippet

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const forwarder = new ethers.Contract(
  process.env.CFA_FORWARDER,
  [
    "function createFlow(address,address,int96,bytes)",
    "function updateFlow(address,address,int96,bytes)",
    "function deleteFlow(address,address,address,bytes)",
  ],
  signer,
);

const token = process.env.SUPER_TOKEN;
const sender = await signer.getAddress();
const receiver = process.env.RECEIVER;
const flowRate = BigInt(process.env.FLOW_RATE);

if (process.env.ACTION === "create") {
  const tx = await forwarder.createFlow(token, receiver, flowRate, "0x");
  const receipt = await tx.wait();
  console.log(JSON.stringify({ txHash: receipt.hash, action: "create" }, null, 2));
}

if (process.env.ACTION === "update") {
  const tx = await forwarder.updateFlow(token, receiver, flowRate, "0x");
  const receipt = await tx.wait();
  console.log(JSON.stringify({ txHash: receipt.hash, action: "update" }, null, 2));
}

if (process.env.ACTION === "delete") {
  const tx = await forwarder.deleteFlow(token, sender, receiver, "0x");
  const receipt = await tx.wait();
  console.log(JSON.stringify({ txHash: receipt.hash, action: "delete" }, null, 2));
}
```

Host callAgreement example:

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const cfa = new ethers.Interface([
  "function createFlow(address,address,int96,bytes)",
  "function updateFlow(address,address,int96,bytes)",
  "function deleteFlow(address,address,address,bytes)",
]);

const host = new ethers.Contract(
  process.env.SUPERFLUID_HOST,
  ["function callAgreement(address,bytes,bytes) returns (bytes)"],
  signer,
);

const token = process.env.SUPER_TOKEN;
const sender = await signer.getAddress();
const receiver = process.env.RECEIVER;
const flowRate = BigInt(process.env.FLOW_RATE);

let callData = "0x";
if (process.env.ACTION === "create") {
  callData = cfa.encodeFunctionData("createFlow", [token, receiver, flowRate, "0x"]);
}
if (process.env.ACTION === "update") {
  callData = cfa.encodeFunctionData("updateFlow", [token, receiver, flowRate, "0x"]);
}
if (process.env.ACTION === "delete") {
  callData = cfa.encodeFunctionData("deleteFlow", [token, sender, receiver, "0x"]);
}

const tx = await host.callAgreement(process.env.CFA_ADDRESS, callData, "0x");
const receipt = await tx.wait();
console.log(JSON.stringify({ txHash: receipt.hash, action: process.env.ACTION }, null, 2));
```

## Failure handling

- Wrong network or missing addresses: stop and return missing host or forwarder or token addresses.
- Insufficient buffer: use `getBufferAmountByFlowrate` and reduce flow rate or top up balance.
- Revert on create or update: verify token is a SuperToken and flowRate is positive.
