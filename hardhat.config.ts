/**
 * @type import('hardhat/config').HardhatUserConfig
 */
import { HardhatUserConfig } from "hardhat/types";
import "hardhat-typechain";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import "hardhat-gas-reporter";
import "hardhat-contract-sizer";
import { task, types } from "hardhat/config";
import { sha3 } from "web3-utils";
import { config } from "dotenv";
import { airdrop } from "./scripts/governance/airdropCalculation";
import { airdrop as gdxAirdrop } from "./scripts/gdx/gdxAirdropCalculation";
import { verify } from "./scripts/verify";
config();

const mnemonic = process.env.MNEMONIC;
const infura_api = process.env.INFURA_API;
const alchemy_key = process.env.ALCHEMY_KEY;
const etherscan_key = process.env.ETHERSCAN_KEY;
const ethplorer_key = process.env.ETHPLORER_KEY;

// console.log({ mnemonic: sha3(mnemonic) });
const hhconfig: HardhatUserConfig = {
  solidity: {
    version: "0.8.3",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  typechain: {
    outDir: "types",
  },
  etherscan: {
    apiKey: etherscan_key,
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: true,
    disambiguatePaths: false,
  },

  networks: {
    hardhat: {
      chainId: 4447,
    },
    develop: {
      gasPrice: 1000000000, //1 gwei
      url: "http://127.0.0.1:8545/",
      chainId: 4447,
    },
    "develop-mainnet": {
      gasPrice: 1000000000, //1 gwei
      url: "http://127.0.0.1:8545/",
      chainId: 4447,
    },
    dapptest: {
      gasPrice: 1000000000, //1 gwei
      url: "http://127.0.0.1:8545/",
    },
    "dapptest-mainnet": {
      gasPrice: 1000000000, //1 gwei
      url: "http://127.0.0.1:8545/",
    },
    ropsten: {
      accounts: { mnemonic },
      url: "https://ropsten.infura.io/v3/" + infura_api,
      gas: 8000000,
      gasPrice: 25000000000,
      chainId: 3,
    },
    kovan: {
      accounts: { mnemonic },
      url: "https://kovan.infura.io/v3/" + infura_api,
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 42,
    },
    "kovan-mainnet": {
      accounts: { mnemonic },
      url: "https://kovan.infura.io/v3/" + infura_api,
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 42,
    },
    fuse: {
      accounts: { mnemonic },
      url: "https://rpc.fuse.io/",
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 122,
    },
    "fuse-mainnet": {
      accounts: { mnemonic },
      url: "https://ropsten.infura.io/v3/" + infura_api,
      gas: 8000000,
      gasPrice: 25000000000,
      chainId: 3,
    },
    staging: {
      accounts: { mnemonic },
      url: "https://rpc.fuse.io/",
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 122,
    },
    production: {
      accounts: { mnemonic },
      url: "https://rpc.fuse.io/",
      gas: 3000000,
      gasPrice: 1000000000,
      chainId: 122,
    },
    "production-mainnet": {
      accounts: { mnemonic },
      url: "https://mainnet.infura.io/v3/" + infura_api,
      gas: 3000000,
      gasPrice: 25000000000,
      chainId: 1,
    },
  },
  mocha: {
    timeout: 6000000,
  },
};

task("repAirdrop", "Calculates airdrop data and merkle tree")
  .addParam("action", "calculate/tree/proof")
  .addOptionalPositionalParam("address", "proof for address")
  .setAction(async (taskArgs, hre) => {
    const actions = airdrop(hre.ethers, ethplorer_key);
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
  .setAction(async (taskArgs, hre) => {
    const actions = gdxAirdrop(hre.ethers);
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

task("verifyjson", "verify contracts on etherscan").setAction(
  async (taskArgs, hre) => {
    return verify(hre);
  }
);
export default hhconfig;
