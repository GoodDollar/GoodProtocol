## Mainnet on-chain proposal

- On mainnet we send 10% to community pool and 50% of the remaining 90% (ie 45%) to the Celo UBI Pool, so in total its 55% we distribute via the distribution helper.
- 10% of the 55% is 0.1818 or 1818 in bps
- 45% of the 55% is 0.8182 or 8182 in bps

| contract                                                       | method                                                          | arguments                                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Reserve: 0xa150a825d425B36329D8294eeF8bD0fE68f8F6E0            | setDistributionHelper(DistributionHelper \_helper, uin32 \_bps) | (DistributionHelper:"0xAcadA0C9795fdBb6921AE96c4D7Db2F8B8c52Fd0",5500)                                           |
| DistributionHelper: 0xAcadA0C9795fdBb6921AE96c4D7Db2F8B8c52Fd0 | addOrUpdateRecipient(DistributionRecipient memory \_recipient)  | {bps: 8182, chainId: 42220, addr: CeloUBIScheme:'0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1', transferType: 1}   |
| DistributionHelper: 0xAcadA0C9795fdBb6921AE96c4D7Db2F8B8c52Fd0 | addOrUpdateRecipient(DistributionRecipient memory \_recipient)  | {bps: 1818, chainId: 122, addr: FuseCommunitySafe:'0x5Eb5f5fE13d1D5e6440DbD5913412299Bc5B5564', transferType: 0} |

## Fuse on-chain proposal

- On fuse we collect funds from FirstClaimPool and then transfer these funds + older funds in Avatar (also from older FirstClaimPool/Invite contracts funded by GoodLabs) to the UBI Pool on Celo via the multichain bridge

| contract                                                     | method                                                                         | arguments                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FirstClaimPool: 0x18BcdF79A724648bF34eb06701be81bD072A2384   | end()                                                                          |                                                                                                                                                                 |
| GoodDollar: 0x495d133B938596C9984d462F007B676bDc57eCEC       | approve(address spender,uint256 amount)                                        | (GoodDollarMintBurnWrapper:"0x031b2B7C7854dd8EE9C4A644D7e54aD17F56e3cB",128069283 + 463420500)                                                                  |
| MultichainRouter: 0xAcadA0C9795fdBb6921AE96c4D7Db2F8B8c52Fd0 | function anySwapOut(address token,address to,uint256 amount,uint256 toChainID) | (GoodDollarMintBurnWrapper:"0x031b2B7C7854dd8EE9C4A644D7e54aD17F56e3cB",CeloUBIScheme:"0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1",128069283 + 463420500,42220) |

## To Test/Simulate on a forked chain

- `npx hardhat node --fork https://rpc.fuse.io &`
- `npx hardhat run scripts/proposals/gip-14_1.ts --network localhost`
- Choose step:
  1: run mainnet proposal
  2: run fuse proposal
