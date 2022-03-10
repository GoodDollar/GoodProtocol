import { get, range, chunk, flatten, mergeWith, sortBy } from "lodash";
// import fs from "fs";
import stakingContracts from "../../releases/deployment.json";
import { ethers as Ethers } from "hardhat";
import { BigNumber } from "ethereum-waffle/node_modules/ethers";
import { getStakingFactory } from "../../test/helpers";
import { getContractFactory } from "@nomiclabs/hardhat-ethers/types";

export const stakersGdRewards = (ethers: typeof Ethers) => {
  const getBuyingAddresses = async (addresses = {}, isContracts = {}) => { // change name
    const provider = new ethers.providers.InfuraProvider();
    const eventABI = "event StakingRewardMinted(address stakingContract, address staker, uint256 gdReward)";
    console.log("before");
    // let simpleStakingFactory = await getContractFactory("GoodCompoundStaking");
    // const goodCompoundStakingFactory = await getStakingFactory(
    //     "GoodCompoundStakingV2"
    //   );
    const contract = await ethers.getContractAt("GoodCompoundStaking","0xD33bA17C8A644C585089145e86E282fada6F3bfd");
    console.log(contract);
    // let stakingCompoundV1 = await ethers.getContractAt("event StakingRewardMinted(address stakingContract, address staker, uint256 gdReward)",
    //     "0xD33bA17C8A644C585089145e86E282fada6F3bfd"
    // );
    console.log("after");
    }

    const doStuff = async () => {
        getBuyingAddresses();
    };

    return { doStuff };
};