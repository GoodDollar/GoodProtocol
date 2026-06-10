# Faucet flows (user-facing explanation)

This note explains the Faucet in plain language: what it does for users, why a top-up can fail, and what limits exist.

The on-chain Faucet contract is used to add a small amount of native gas token to a wallet so the user can pay transaction fees.  
Reference implementation: [`contracts/fuseFaucet/Faucet.sol`](https://github.com/GoodDollar/GoodProtocol/blob/master/contracts/fuseFaucet/Faucet.sol).  
Addresses per chain: [deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) only (for example `Faucet` under `production`, `production-celo`, `production-xdc`).

## What this means for users

- If your wallet is eligible, Faucet can send a small gas top-up.
- Eligibility usually depends on identity status and anti-abuse limits.
- This is a support mechanism for transaction fees, not a general transfer or swap service.

## Main actions (in user language)

- **Top up wallet** (`topWallet`)  
  Attempts to send gas to the target wallet after checks pass.

- **Check eligibility first** (`canTop`)  
  Fast pre-check to see if top-up is currently allowed.

- **Estimate top-up amount** (`getToppingAmount`)  
  Shows the amount Faucet would try to send right now.

## Why a top-up may fail

- You are not currently authorized by identity rules.
- Daily limit reached.
- Weekly limit reached.
- Wallet is temporarily banned.
- Wallet is too new for current policy.
- Calculated top-up is below minimum threshold.

## Important safety note

- The `onTokenTransfer` path includes a swap-like mechanism and is not meant as a normal user swap route.
- It does not enforce slippage protection in the same way users expect from a dedicated swap UI.

## For developers and agents

Use `references/guides/faucet.md` for step-by-step execution flow and deterministic preflight calls.
