/***
 * This script will deploy a reserve upgrade and the DistributionHelper so that some of the expansion can be allocated
 * for non-ubi purposes
 * Upgrade process:
 * mainnet:
 * - deploy reserve
 * - deploy distributionHelper
 * - create proposal that:
 *  - upgrades the reserve
 *  - sets the distributionHelper at reserve with the agreed bps
 *  - add to the distributionHelper the GoodDollarMintBurnWrapper contract address on fuse as recipient with 100% bps
 */

import { network, ethers } from "hardhat";

import {
  deployDeterministic,
  printDeploy,
  executeViaGuardian,
  executeViaSafe
} from "../multichain-deploy/helpers";

import releaser from "../releaser";
import dao from "../../releases/deployment.json";
import {
  CompoundVotingMachine,
  DistributionHelper,
  Controller,
  NameService
} from "../../types";
const { name: networkName } = network;

export const deployMainnet = async () => {
  let executionMethod = "safe";
  const networkKey =
    networkName === "localhost" ? "production-mainnet" : networkName;
  let release: { [key: string]: any } = dao[networkKey];

  let [root, ...signers] = await ethers.getSigners();
  //test with guardians safe on hardhat mainnet fork
  if (network.name === "localhost")
    root = await ethers.getImpersonatedSigner(
      "0xF0652a820dd39EC956659E0018Da022132f2f40a"
    );

  console.log("got signers:", {
    networkName,
    networkKey,
    root: root.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then(_ => _.toString())
  });

  console.log("deploying reserve implementation");
  const reserveImpl = await (
    await ethers.getContractFactory("GoodReserveCDai")
  ).deploy();

  console.log("deploying DistributionHelper");

  let DHelper: DistributionHelper;
  if (!release.DistributionHelper) {
    DHelper = (await deployDeterministic(
      {
        name: "DistributionHelper",
        salt: "DistributionHelper",
        isUpgradeable: true
      },
      [release.NameService]
    ).then(printDeploy)) as DistributionHelper;

    let torelease = {
      DistributionHelper: DHelper.address
    };

    await releaser(torelease, networkName, "deployment", false);
  } else {
    DHelper = (await ethers.getContractAt(
      "DistributionHelper",
      release.DistributionHelper
    )) as DistributionHelper;
  }
  DHelper;

  // //create proposal
  // const vm = (await ethers.getContractAt(
  //   "CompoundVotingMachine",
  //   release.CompoundVotingMachine
  // )) as CompoundVotingMachine;

  // const ctrl = (await ethers.getContractAt(
  //   "Controller",
  //   release.Controller
  // )) as Controller;

  const ns = (await ethers.getContractAt(
    "NameService",
    release.NameService
  )) as NameService;

  const proposalContracts = [
    ns.address, //nameservice add DistributionHelper,MultiChainRouter,MultiChain AnyGoodDollar,
    DHelper.address, //update addresses from nameservice
    DHelper.address, //distribution helper -> add fuse GoodDollarMintBurnWrapper as recipient with 100%
    release.GoodReserveCDai, //upgradeTo
    release.GoodReserveCDai, //Reserve -> set distribution helper + non ubi bps
    release.GoodReserveCDai, //Reserve -> set new decline ratio
    release.GoodFundManager, //Fundmanager -> set staking rewards compound to 0
    release.GoodFundManager //Fundmanager -> set staking rewards aave to 0
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setAddresses(bytes32[],address[])",
    "updateAddresses()",
    "addOrUpdateRecipient((uint32,uint32,address,uint8))",
    "upgradeTo(address)",
    "setDistributionHelper(address,uint32)",
    "setReserveRatioDailyExpansion(uint256,uint256)",
    "setStakingReward(uint32,address,uint32,uint32,bool)",
    "setStakingReward(uint32,address,uint32,uint32,bool)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32[]", "address[]"],
      [
        [
          ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("DISTRIBUTION_HELPER")
          ),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MULTICHAIN_ROUTER")),
          ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes("MULTICHAIN_ANYGOODDOLLAR")
          )
        ],
        [DHelper.address, release.MultichainRouter, release.AnyGoodDollar]
      ]
    ), //setAddresses(bytes32[],address[])"
    ethers.utils.defaultAbiCoder.encode([], []), //updateAddresses()
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [
        10000, //100% bps
        42220, //chainid
        release.GuardiansSafe, //recipient address,
        1 //recipient type via multichain bridge
      ]
    ), //addOrUpdateRecipient((uint32,uint32,address,uint8))
    ethers.utils.defaultAbiCoder.encode(["address"], [reserveImpl.address]), //upgradeTo(address)
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint32"],
      [DHelper.address, 1000]
    ), //setDistributionHelper(address,uint32)
    ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256"],
      ["999554841771249", "1000000000000000"] //15% a year
    ), //setReserveRatioDailyExpansion(uint,uint)
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "address", "uint32", "uint32", "bool"],
      [
        "0",
        "0x7b7246c78e2f900d17646ff0cb2ec47d6ba10754",
        "14338692",
        "4294967295",
        false
      ]
    ), //setstakingrewards to 0
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "address", "uint32", "uint32", "bool"],
      [
        "0",
        "0x3ff2d8eb2573819a9ef7167d2ba6fd6d31b17f4f",
        "14338692",
        "4294967295",
        false
      ]
    ) //setstakingrewards to 0
  ];

  //make sure rewards accumulated before we set them to 0
  const staking = await ethers.getContractAt(
    "SimpleStakingV2",
    "0x7b7246c78e2f900d17646ff0cb2ec47d6ba10754"
  );
  (await staking.withdrawRewards()).wait();
  staking.attach("0x3ff2d8eb2573819a9ef7167d2ba6fd6d31b17f4f");
  (await staking.withdrawRewards()).wait();

  if (executionMethod === "safe") {
    return executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      "0xF0652a820dd39EC956659E0018Da022132f2f40a",
      root
    );
  } else {
    return executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      root
    );
  }
};

export const main = async () => {
  await deployMainnet().catch(console.log);
};
console.log(process.argv);
if (process.argv[1].includes("v3-upgrade")) main();
