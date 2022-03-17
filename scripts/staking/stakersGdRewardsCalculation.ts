import { range, chunk } from "lodash";
import fs from "fs";
import stakingContracts from "../../releases/deployment.json";
import { ethers as Ethers } from "hardhat";
import { BigNumber } from "ethereum-waffle/node_modules/ethers"; 

const ZERO = BigNumber.from("0"); 

export const sumStakersGdRewards = (ethers: typeof Ethers) => {
    
    const getStakersGdRewards = async (stakersToGdRewards = {}) => {
        const provider = new ethers.providers.InfuraProvider();
        
        let goodFundManager = await ethers.getContractAt("GoodFundManager",stakingContracts["production-mainnet-bug"].GoodFundManager);
        goodFundManager = goodFundManager.connect(provider);
        const filter = goodFundManager.filters.StakingRewardMinted();

        const step = 100000;
        const ETH_START_BLOCK = 14291923; 
        const ETH_END_BLOCK = await provider.getBlockNumber();
        const blocks = range(ETH_START_BLOCK, ETH_END_BLOCK, step);

        for (let blockChunk of chunk(blocks, 10)) {
            const processedChunks = blockChunk.map(async bc => {
                const stakingRewardsEvents = await goodFundManager
                    .queryFilter(filter, bc, Math.min(bc + step - 1, ETH_END_BLOCK))
                    .catch(e => {
                    console.log("block transfer logs failed retrying...", bc);
                    return goodFundManager.queryFilter(
                        filter, bc, Math.min(bc + step - 1, ETH_END_BLOCK));
                    });

                const stakingRewardsEventsMapped = stakingRewardsEvents.map(async log => {
                    const initBalance = stakersToGdRewards[log.args.staker] || ZERO;
                    stakersToGdRewards[log.args.staker] = initBalance.add(log.args.gdReward);
                    // console.log(`TransactionHash:\t${log.transactionHash}`);
                    // console.log(`Staking contract:\t${log.args.stakingContract}`);
                    // console.log(`Previous Balance:\t${initBalance.toString()} for address ${log.args.staker}`);
                    // console.log(`Addition:\t\t${log.args.gdReward.toString()} for address ${log.args.staker}`);
                    // console.log(`New Balance:\t\t${stakersToGdRewards[log.args.staker].toString()} for address ${log.args.staker}\n`);
                    });
                await Promise.all([...stakingRewardsEventsMapped]);
            });
            await Promise.all(processedChunks);
        }   

        console.log(`All stakers minted rewards:\n`);
        Object.entries(stakersToGdRewards).forEach(a => { console.log(`${a[0].toString()}:${BigNumber.from(a[1]).toString()}\n`)}); 
        // fs.writeFileSync("scripts/staking/stakersToGdRewards.json", JSON.stringify(stakersToGdRewards))
    };
    
    return { getStakersGdRewards};
}