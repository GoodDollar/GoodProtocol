/**
 * @type import('hardhat/config').HardhatUserConfig
 */
import { HardhatUserConfig } from "hardhat/types";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import "hardhat-storage-layout";
import { task, types } from "hardhat/config";
import { sha3 } from "web3-utils";
import { config } from "dotenv";
import { airdrop } from "./scripts/governance/airdropCalculationSorted";
import { airdrop as repAirdropRecover } from "./scripts/governance/airdropCalculationRecover";
import { airdrop as goodCheckpoint } from "./scripts/governance/goodCheckpointSorted";

import { airdrop as gdxAirdrop, airdropRecover as gdxAirdropRecover } from "./scripts/gdx/gdxAirdropCalculation";
import { sumStakersGdRewards } from "./scripts/staking/stakersGdRewardsCalculation";
import { verify } from "./scripts/verify";
import { ethers } from "ethers";
import { fstat, readFileSync, writeFileSync } from "fs";
config();

const mnemonic = process.env.MNEMONIC || "test test test test test test test test test test test junk";
const deployerPrivateKey = process.env.PRIVATE_KEY || ethers.utils.hexZeroPad("0x11", 32);
const infura_api = process.env.INFURA_API;
const alchemy_key = process.env.ALCHEMY_KEY;
const etherscan_key = process.env.ETHERSCAN_KEY;
const celoscan_key = process.env.CELOSCAN_KEY;

const ethplorer_key = process.env.ETHPLORER_KEY;

const MAINNET_URL = "https://mainnet.infura.io/v3/" + infura_api;

const goerli = {
  accounts: { mnemonic },
  url: "https://goerli.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
  gas: 3000000,
  gasPrice: 2e9,
  chainId: 5
};

// console.log({ mnemonic: sha3(mnemonic) });
const hhconfig: HardhatUserConfig = {
  solidity: {
    version: "0.8.16",
    settings: {
      optimizer: {
        enabled: true,
        runs: 0
      }
    }
  },
  typechain: {
    outDir: "types"
  },
  etherscan: {
    apiKey: {
      mainnet: etherscan_key,
      celo: celoscan_key,
      alfajores: celoscan_key
    },
    customChains: [
      {
        network: "celo",
        chainId: 42220,
        urls: {
          apiURL: "https://api.celoscan.io/api",
          browserURL: "https://celoscan.io/"
        }
      },
      {
        network: "alfajores",
        chainId: 44787,
        urls: {
          apiURL: "https://api.alfajores.celoscan.io/api",
          browserURL: "https://alfajores.celoscan.io/"
        }
      }
    ]
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: true,
    disambiguatePaths: false
  },

  networks: {
    hardhat: {
      chainId: process.env.FORK_CHAIN_ID ? Number(process.env.FORK_CHAIN_ID) : 4447,
      allowUnlimitedContractSize: true,
      accounts: {
        accountsBalance: "10000000000000000000000000"
      },
      initialDate: "2021-12-01", //required for DAO tests like guardian
      forking: process.env.FORK_CHAIN_ID && {
        url: "https://eth-mainnet.alchemyapi.io/v2/" + process.env.ALCHEMY_KEY
      }
    },
    test: {
      allowUnlimitedContractSize: true,
      url: "http://127.0.0.1:8545/"
    },
    develop: {
      gasPrice: 1000000000, //1 gwei
      url: "http://127.0.0.1:8545/",
      chainId: 4447
    },
    "develop-mainnet": {
      gasPrice: 1000000000, //1 gwei
      url: "http://127.0.0.1:8545/",
      chainId: 4447
    },
    dapptest: {
      gasPrice: 1000000000, //1 gwei
      url: "http://127.0.0.1:8545/"
    },
    "dapptest-mainnet": {
      gasPrice: 1000000000, //1 gwei
      url: "http://127.0.0.1:8545/"
    },
    ropsten: {
      accounts: { mnemonic },
      url: "https://ropsten.infura.io/v3/" + infura_api,
      gas: 8000000,
      gasPrice: 25000000000,
      chainId: 3
    },
    kovan: {
      accounts: { mnemonic },
      url: "https://kovan.infura.io/v3/" + infura_api,
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 42
    },
    "kovan-mainnet": {
      accounts: { mnemonic },
      url: "https://kovan.infura.io/v3/" + infura_api,
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 42
    },
    fuse: {
      accounts: { mnemonic },
      url: "https://rpc.fuse.io/",
      chainId: 122,
      gas: 6000000,
      gasPrice: 10000000000
    },
    fuseexplorer: {
      accounts: { mnemonic },
      url: "https://explorer-node.fuse.io/",
      chainId: 122,
      gas: 6000000,
      gasPrice: 10000000000
    },
    fusespark: {
      accounts: { mnemonic },
      url: "https://rpc.fusespark.io/",
      gas: 3000000,
      gasPrice: 10000000000,
      chainId: 123
    },
    "fuse-mainnet": {
      accounts: { mnemonic },
      url: "https://ropsten.infura.io/v3/" + infura_api,
      gasPrice: 20000000000,
      gas: 5000000,
      chainId: 3
    },
    staging: {
      accounts: { mnemonic },
      url: "https://rpc.fuse.io/",
      chainId: 122,
      gas: 6000000,
      gasPrice: 10000000000
    },
    "staging-mainnet": {
      accounts: { mnemonic },
      url: "https://ropsten.infura.io/v3/" + infura_api,
      gasPrice: 20000000000,
      gas: 5000000,
      chainId: 3
    },
    production: {
      accounts: [deployerPrivateKey],
      url: "https://rpc.fuse.io/",
      gas: 3000000,
      gasPrice: 10000000000,
      chainId: 122
    },
    "production-mainnet": {
      accounts: [deployerPrivateKey],
      url: MAINNET_URL,
      gas: 3000000,
      gasPrice: 15000000000,
      chainId: 1
    },
    "production-celo": {
      accounts: [deployerPrivateKey],
      url: "https://forno.celo.org",
      gas: 8000000,
      gasPrice: 5000000000,
      chainId: 42220
    },
    celo: {
      accounts: { mnemonic },
      url: "https://forno.celo.org",
      gas: 3000000,
      gasPrice: 5000000000,
      chainId: 42220
    },
    alfajores: {
      accounts: { mnemonic },
      chainId: 44787,
      url: `https://alfajores-forno.celo-testnet.org`,
      gasPrice: 5000000000
    },
    "staging-celo": {
      accounts: { mnemonic },
      url: "https://forno.celo.org",
      gas: 3000000,
      gasPrice: 5000000000,
      chainId: 42220
    },
    "development-celo": {
      accounts: { mnemonic },
      url: "https://forno.celo.org",
      gas: 3000000,
      gasPrice: 5000000000,
      chainId: 42220
    },
    gnosis: {
      accounts: [deployerPrivateKey],
      url: "https://rpc.gnosischain.com",
      gas: 3000000,
      gasPrice: 500000000,
      chainId: 100
    },
    goerli,
    "development-goerli": goerli,
    "staging-goerli": goerli
  },
  mocha: {
    timeout: 6000000
  }
};

task("repAirdrop", "Calculates airdrop data and merkle tree")
  .addParam("action", "calculate/tree/proof")
  .addOptionalParam("fusesnapshotblock", "fuse block for calculate")
  .addOptionalParam("ethsnapshotblock", "eth block for calculate")
  .addOptionalPositionalParam("address", "proof for address")
  .setAction(async (taskArgs, hre) => {
    const actions = airdrop(hre.ethers, ethplorer_key, etherscan_key);
    switch (taskArgs.action) {
      case "calculate":
        return actions.collectAirdropData(taskArgs.fusesnapshotblock, taskArgs.ethsnapshotblock);
      case "tree":
        return actions.buildMerkleTree();
      case "proof":
        return actions.getProof(taskArgs.address);
      default:
        console.log("unknown action use calculate or tree");
    }
  });

task("repAirdropRecover", "Calculates airdrop data and merkle tree after critical bug")
  .addParam("action", "calculate/tree/proof")
  .addOptionalPositionalParam("address", "proof for address")
  .setAction(async (taskArgs, hre) => {
    const actions = repAirdropRecover(hre.ethers, ethplorer_key, etherscan_key);
    switch (taskArgs.action) {
      case "calculate":
        return actions.collectAirdropData();
      case "tree":
        return actions.buildMerkleTree();
      case "proof":
        return actions.getProof(taskArgs.address);
      default:
        console.log("unknown action use calculate or tree");
    }
  });

task("gdxAirdrop", "Calculates airdrop data")
  .addParam("action", "calculate/tree/proof")
  .addOptionalPositionalParam("address", "proof for address")
  .addOptionalParam("ethsnapshotblock", "eth block for calculate")
  .setAction(async (taskArgs, hre) => {
    const actions = gdxAirdrop(hre.ethers, taskArgs.ethsnapshotblock);
    switch (taskArgs.action) {
      case "calculate":
        return actions.collectAirdropData();
      case "tree":
        return actions.buildMerkleTree();
      case "proof":
        return actions.getProof(taskArgs.address);
      default:
        console.log("unknown action use calculate or tree");
    }
  });

task("gdxAirdropRecover", "Calculates new airdrop data for recovery")
  .addParam("action", "addition/tree")
  .setAction(async (taskArgs, hre) => {
    const actions = gdxAirdropRecover(hre.ethers);
    switch (taskArgs.action) {
      case "addition":
        return actions.addCalculationsToPreviousData();
      case "tree":
        return actions.buildMerkleTree();
      default:
        console.log("unknown action use addition or tree");
    }
  });

task("goodCheckpoint", "Calculates good checkpoint data and merkle tree for GOOD sync")
  .addParam("action", "calculate/tree/proof")
  .addOptionalPositionalParam("address", "proof for address")
  .setAction(async (taskArgs, hre) => {
    const actions = goodCheckpoint(hre.ethers, ethplorer_key, etherscan_key);
    switch (taskArgs.action) {
      case "calculate":
        return actions.collectAirdropData();
      case "tree":
        return actions.buildMerkleTree();
      case "proof":
        return actions.getProof(taskArgs.address);
      default:
        console.log("unknown action use calculate or tree");
    }
  });

task("verifyjson", "verify contracts on etherscan").setAction(async (taskArgs, hre) => {
  return verify(hre);
});
export default hhconfig;

task("sumStakersGdRewards", "Sums the GoodDollar reward for each staker").setAction(async (taskArgs, hre) => {
  const actions = sumStakersGdRewards(hre.ethers);
  return actions.getStakersGdRewards();
});

task("cleanflat", "Cleans multiple SPDX and Pragma from flattened file")
  .addPositionalParam("file", "flattened sol file")
  .setAction(async ({ file }, { run }) => {
    let flattened = await run("flatten:get-flattened-sources", {
      files: [file]
    });

    // Remove every line started with "// SPDX-License-Identifier:"
    flattened = flattened.replace(/SPDX-License-Identifier:/gm, "License-Identifier:");

    flattened = `// SPDX-License-Identifier: MIXED\n\n${flattened}`;

    // Remove every line started with "pragma experimental ABIEncoderV2;" except the first one
    flattened = flattened.replace(
      /pragma experimental ABIEncoderV2;\n/gm,
      (
        i => m =>
          !i++ ? m : ""
      )(0)
    );
    flattened = flattened.replace(
      /pragma solidity.*\n/gm,
      (
        i => m =>
          !i++ ? m : ""
      )(0)
    );

    flattened = flattened.trim();
    writeFileSync("flat.sol", flattened);
  });
