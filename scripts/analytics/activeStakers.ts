import { uniq } from "lodash";
import fs from "fs";
import { network, ethers } from "hardhat";
import { Contract, Provider, setMulticallAddress } from "ethers-multicall";
import release from "../../releases/deployment.json"
import { SimpleStakingV2 } from "../../types";

setMulticallAddress(122, "0x3CE6158b7278Bf6792e014FA7B4f3c6c46fe9410");

setMulticallAddress(42220, "0x188C1bf697B66474dC3eaa119Ae691a8352537e3");

const main = async () => {

    const c1 = await ethers.getContractAt("SimpleStakingV2", release["production-mainnet"].StakingContractsV3[0][0]) as SimpleStakingV2
    const c2 = await ethers.getContractAt("SimpleStakingV2", release["production-mainnet"].StakingContractsV3[1][0]) as SimpleStakingV2
    const f = c1.filters.Staked()
    const events = await c1.queryFilter(f, 14338550)
    const events2 = await c2.queryFilter(f, 14338550)
    const stakers = uniq(events.concat(events2).map(_ => _.args[0]))
    console.log(stakers)
    const res = (await Promise.all(stakers.map(async s => [s, await c1.balanceOf(s), await c2.balanceOf(s)]))).filter(_ => _[1].gt(0) || _[2].gt(0))
    console.log(events.length)
    console.log(res)
}
main()