Action: `save` (stake/supply GoodDollar)

When to use:
- The user asks to save, stake, supply G$, earn yield, or withdraw stake/rewards.

Inputs to request (if missing):
- `nameServiceAddress`
- `amount` (uint256 in token smallest units)
- `stakingContractAddress` (optional; if missing resolve via `nameService.getAddress("GDAO_STAKING")`)
- `rpcUrl` + `chainId`
- `privateKey` (or other signer) for sending the tx

Execution:
1) Resolve addresses:
   - `stakingAddress = stakingContractAddress ?? nameService.getAddress("GDAO_STAKING")`
   - `gdAddress = nameService.getAddress("GOODDOLLAR")`

2) Approve:
   - Call `gdAddress.approve(stakingAddress, amount)`
   (If approval is already present, you can skip or confirm.)

3) Stake:
   - Call `GoodDollarStaking.stake(amount)`

Optional sub-actions:
- Withdraw only rewards:
  - `GoodDollarStaking.withdrawRewards()`
- Withdraw stake:
  - `GoodDollarStaking.withdrawStake(shares)`

Output to the user:
- tx hash
- brief success message

