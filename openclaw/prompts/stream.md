---
name: stream
description: Manage Superfluid Constant Flow Agreement v1 streams for GoodDollar's SuperToken.
---

Action: `stream` (Superfluid Constant Flow Agreement v1)

When to use:
- The user wants to create, update, or delete a Superfluid "constant flow" (stream) for GoodDollar's SuperToken (SuperGoodDollar).

Important note about addresses:
- This repo's `NameService` keys are not defined for Superfluid Host / CFA by default.
- To avoid hardcoding, ask the user for `superfluidHost` and `constantFlowAgreementV1` addresses (or provide the corresponding `NameService` keys if you have them).

Inputs to request (if missing):
- `superfluidHost` (address): the Superfluid Host contract (`ISuperfluid`)
- `constantFlowAgreementV1` (address): CFA v1 agreement class (`IConstantFlowAgreementV1`)
- `superToken` (address): the SuperToken to stream (likely `SuperGoodDollar`)
- `action`: `create` | `update` | `delete`
- `receiver` (address): flow receiver
- `flowRate` (int96 as bigint/decimal): required for `create` and `update`
- `sender` (address, optional): required for `delete` (defaults to signer address)
- `userData` (bytes, optional): forwarded to callbacks; default `0x`

Execution:
1) Build the CFA callData with placeholder ctx:
   - Use `ctx = 0x` (empty bytes) for all actions.
   - For `create`:
     - callData = `abi.encodeWithSelector(CFA.createFlow.selector, superToken, receiver, flowRate, ctx)`
   - For `update`:
     - callData = `abi.encodeWithSelector(CFA.updateFlow.selector, superToken, receiver, flowRate, ctx)`
   - For `delete`:
     - callData = `abi.encodeWithSelector(CFA.deleteFlow.selector, superToken, sender, receiver, ctx)`

2) Send the transaction via the host:
   - call `superfluidHost.callAgreement(constantFlowAgreementV1, callData, userData)`

3) (Optional) Post-check:
   - Call `constantFlowAgreementV1.getFlow(superToken, sender, receiver)` and report `flowRate`.

Output to the user:
- tx hash
- action (`create`/`update`/`delete`)
- receiver + (best-effort) resulting flowRate if post-check is performed

