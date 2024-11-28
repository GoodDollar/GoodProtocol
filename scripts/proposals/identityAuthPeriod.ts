/***
 * Bring UBI distribution to a temporary working state
 * Celo:
 *  - upgrade bridge to be able to prevent UBI bridge transfers as result of the hack
 *  - mark unexecuted bridge transfers as executed
 *  - set UBI with new cycle params
 *  - unpause ubi contract
 * Fuse:
 *  - withdraw ubi to avatar and bridge ubi to contract on celo
 *  - burn excess UBI tokens
 *  - set UBI with new cycle params
 *  - unpause ubi contract
 * Mainnet:
 *  - withdraw excess UBI from bridge to avatar
 *  - burn excess UBI from bridge
 *
 */

import { network, ethers } from "hardhat";
import { defaultsDeep, last } from "lodash";
import prompt from "prompt";

import { executeViaGuardian, executeViaSafe, verifyProductionSigner } from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
let { name: networkName } = network;

export const upgradeCelo = async () => {
    const isProduction = networkName.includes("production");
    let [root, ...signers] = await ethers.getSigners();

    if (isProduction) verifyProductionSigner(root);

    let guardian = root;

    //simulate produciton on fork
    if (network.name === "hardhat" || network.name === "fork" || network.name === "localhost") {
        networkName = "production-celo";
    }

    let release: { [key: string]: any } = dao[networkName];
    let protocolSettings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

    //simulate on fork, make sure safe has enough eth to simulate txs
    if (network.name === "hardhat" || network.name === "fork" || network.name === "localhost") {
        guardian = await ethers.getImpersonatedSigner(protocolSettings.guardiansSafe);

        await root.sendTransaction({
            value: ethers.constants.WeiPerEther.mul(3),
            to: protocolSettings.guardiansSafe
        });
    }

    const rootBalance = await ethers.provider.getBalance(root.address).then(_ => _.toString());
    const guardianBalance = await ethers.provider.getBalance(guardian.address).then(_ => _.toString());


    console.log("got signers:", {
        networkName,
        root: root.address,
        guardian: guardian.address,
        balance: rootBalance,
        guardianBalance: guardianBalance
    });

    const reducerContract = await ethers.deployContract("LastauthReduction", [release.NameService])
    console.log("executing proposals");

    const proposalContracts = [
        release.Controller,
    ];

    const proposalEthValues = proposalContracts.map(_ => 0);

    const proposalFunctionSignatures = [
        "registerScheme(address,bytes32,bytes4,address)", //make sure mpb is a registered scheme so it can mint G$ tokens
    ];

    const proposalFunctionInputs = [
        ethers.utils.defaultAbiCoder.encode(["address", "bytes32", "bytes4", "address"], [reducerContract.address, ethers.constants.HashZero, "0x0000001f", release.Avatar]),
    ];

    if (isProduction) {
        await executeViaSafe(
            proposalContracts,
            proposalEthValues,
            proposalFunctionSignatures,
            proposalFunctionInputs,
            protocolSettings.guardiansSafe,
            "celo"
        );
    } else {
        //simulation or dev envs
        await executeViaGuardian(
            proposalContracts,
            proposalEthValues,
            proposalFunctionSignatures,
            proposalFunctionInputs,
            guardian,
            networkName
        );
    }

    //perform sanity checks on fork, for production we need to wait until everything executed
    if (!isProduction) {
        try {
            while (true) {
                await reducerContract.reduce()
                let id = await ethers.getContractAt("IdentityV2", release.Identity);
                console.log("authperiod", await id.authenticationPeriod());
            }
        } catch (error) {
            console.log("reduce reverted:", error)
        }

    }
};

export const upgradeFuse = async () => {
    const isProduction = networkName.includes("production");

    let [root] = await ethers.getSigners();

    //simulate produciton on fork
    if (network.name === "hardhat" || network.name === "fork" || network.name === "localhost") {
        networkName = "production";
    }

    let networkEnv = networkName.split("-")[0];


    if (networkEnv === "fuse") networkEnv = "development";

    let release: { [key: string]: any } = dao[networkEnv];

    let guardian = root;
    console.log({ networkEnv })
    //simulate on fork, make sure safe has enough eth to simulate txs
    if (network.name === "hardhat" || network.name === "localhost" || network.name === "fork") {
        guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

        await root.sendTransaction({
            value: ethers.constants.WeiPerEther.mul(3),
            to: guardian.address
        });
    }


    console.log({
        networkEnv,
        guardian: guardian.address,
        isProduction,
        avatarBalance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
    });

    const reducerContract = await ethers.deployContract("LastauthReduction", [release.NameService])

    const proposalContracts = [
        release.Controller,
    ];

    const proposalEthValues = proposalContracts.map(_ => 0);

    const proposalFunctionSignatures = [
        "registerScheme(address,bytes32,bytes4,address)", //make sure mpb is a registered scheme so it can mint G$ tokens
    ];

    const proposalFunctionInputs = [
        ethers.utils.defaultAbiCoder.encode(["address", "bytes32", "bytes4", "address"], [reducerContract.address, ethers.constants.HashZero, "0x0000001f", release.Avatar]),
    ];

    if (isProduction) {
        await executeViaSafe(
            proposalContracts,
            proposalEthValues,
            proposalFunctionSignatures,
            proposalFunctionInputs,
            release.GuardiansSafe,
            "fuse"
        );
    } else {
        //simulation or dev envs
        await executeViaGuardian(
            proposalContracts,
            proposalEthValues,
            proposalFunctionSignatures,
            proposalFunctionInputs,
            guardian,
            networkName
        );
    }

    //perform sanity checks on fork, for production we need to wait until everything executed
    if (!isProduction) {
        try {
            while (true) {
                await reducerContract.reduce()
                let id = await ethers.getContractAt("IdentityV2", release.Identity);
                let idOld = await ethers.getContractAt("IdentityV2", release.IdentityOld);

                console.log("authperiod", await id.authenticationPeriod(), await idOld.authenticationPeriod());
            }
        } catch (error) {
            console.log("reduce reverted:", error)
        }
    }


};


export const main = async () => {
    prompt.start();
    const { network } = await prompt.get(["network"]);

    console.log("running step:", { network });
    switch (network) {
        case "celo":
            await upgradeCelo();
            break;
        case "fuse":
            await upgradeFuse();
            break;
    }
};

main().catch(console.log);
