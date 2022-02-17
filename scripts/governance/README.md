## GOOD Airdrop

### How is it calculated

Initial GOOD airdrop is distributed 50% to claimers, 25% to supporters/donators and 25% to G$ hodlers.

- Claimers: The method `getClaimsPerAddress` aggregates `UBIClaimed` events on the Fuse blockchain, each account will get his relative share calculated as `number of claims divided by total number of claims`
- Supporters and donators: The method `getStakersBalance` will perform the following
  - Read `DAIStaked` and `DAIWithdrawStake` events from the SimpleDAIStaking smart contract on ethereum. For each staker it will calculate the $ value staked multiplied by time, to get the staker share.
  - Read eth transfers to the DonationStaking smart contract and the `Transfer` events of DAI to this contract. Multiply the $ value by the time since the donation, to get the donator share.
  - Each address share is calculated as `share/total shares` where share is `time*$ value`.
- G$ Hodlers:
  - The method `getEthPlorerHolders` will get G\$ balances on ethereum and the method `getFuseHolders` will get G$ balances on fuse.
  - The method `getFuseSwapBalances` will get the G$ balances of addresses supplying liquidity on fuseswap (including those staking in the yield farming rewards)
  - The method `getUniswapBalances` will get the G$ balances of addresses supplying liquidity on uniswap
  - Each address share is calculated as `G$ balance/total G$ balances`

### How to run the calculation and generate the merklehash

##### Notice: fetching all the data to create the merklehash can take >60 minutes

- clone the project

```
git clone https://github.com/GoodDollar/GoodProtocol.git
```

- run `yarn && yarn compile`
- meanwhile get an Ethplorer + Etherscan free API key and create a .env file

```
ETHERSCAN_KEY=yourkey
ETHPLORER_KEY=yourkey
INFURA_API= #leave empty
MNEMONIC= #leave empty
```

- in the root project folder run

```
npx hardhat repAirdrop --action calculate --fusesnapshotblock <number> --ethsnapshotblock <number>
# output will be 6 files claimBalances.json, ethBalances.json, fuseBalances.json, uniswapBalances.json, fuseswapBalances.json,  stakersBalances.json

npx hardhat airdrop tree
# output will be repTree.json - the final balances/stakes/claims data used to create the tree and airdrop.json which is the final merkleroot and elements of tree
# each element is keccak(address,repInWei)
```

### How to generate proof & claim

- either perform the previous step or download the set of published snapshot files (TBD)
- make sure you have `airdrop.json` in the project root folder
- run

```
npx hardhat repAirdrop --action proof <address>
```

- on **Fuse** call `GReputation` contract method `proveBalanceOfAtBlockchain(_id,_user,_balance,_proof)` with the following params:

  - \_id: 'rootState'
  - \_user: address
  - \_balance: rep output from previous `proof` command
  - \_proof: proof array output from previous command

- on **Ethereum** call `GReputation` contract method `proveBalanceOfAtBlockchain(_id,_user,_balance,_proof)` with the following params:
  - \_id: 'fuse'
  - \_user: address
  - \_balance: rep output from previous `proof` command
  - \_proof: proof array output from previous command
