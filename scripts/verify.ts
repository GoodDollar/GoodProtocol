import fs from "fs"
import { isArray } from "lodash"
import { default as Verify } from "truffle-plugin-verify";
import type EthersT from "ethers";
import type HreT from "hardhat"
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types"
import { execSync } from "child_process"
type Ethers = typeof EthersT.ethers & HardhatEthersHelpers
type HRE = typeof HreT

let ethers:Ethers
export const verify = async (hre: HRE) => {
    const truffleOutput = execSync("npx truffle compile").toString("utf8")
    console.log({truffleOutput})
    ethers = hre.ethers
    const deployed = JSON.parse(fs.readFileSync("releases/deployment.json").toString())
    const contracts = deployed[hre.network.name]
    
    const contractPairs = (await Promise.all(Object.entries(contracts).map(async (entry) => {
        if(isArray(entry[1]))
            return
        const addr = await getImplementationAddress(entry[1])
        return entry[0]+'@'+addr
    }))).filter(_ => _)

    contractPairs.unshift()

    const config = {
        debug: true,
        network_id: hre.network.config.chainId,
        api_keys: { 
            etherscan: hre.config.etherscan.apiKey
        },
        working_directory: ".",
        contracts_build_directory: "build/contracts",
        '_':contractPairs
    }
    console.log({config})
    return Verify(config)
};

const getImplementationAddress = async (addr) => {
    let proxy = await ethers.provider.getStorageAt(addr,"0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc")
    let res = addr
    if(proxy != ethers.constants.HashZero)
        res = "0x"+proxy.slice(-40)
    else { 
        const code = await ethers.getDefaultProvider().getCode(addr)
        if(code.startsWith("0x363d3d373d3d3d363d73"))
            res = "0x"+code.slice(22,62)
    }    
    console.log("impl address for:",addr,res)
    return res
}