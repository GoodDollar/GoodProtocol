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
 *  - add to the distributionHelper the contracts addresses to receive part of the UBI
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
  let [root, ...signers] = await ethers.getSigners();

  let executionMethod = "safe";
  let communitySafe = "0x5Eb5f5fE13d1D5e6440DbD5913412299Bc5B5564";

  const networkKey =
    networkName === "localhost" ? "production-mainnet" : networkName;
  let release: { [key: string]: any } = dao[networkKey];

  let safeOwner = new ethers.Wallet(
    process.env.SAFEOWNER_PRIVATE_KEY || ethers.constants.HashZero,
    ethers.provider
  );
  //test with guardians safe on hardhat mainnet fork
  if (network.name === "localhost") {
    root = await ethers.getImpersonatedSigner(
      "0xE0c5daa7CC6F88d29505f702a53bb5E67600e7Ec"
    );
    await signers[0].sendTransaction({
      to: root.address,
      value: ethers.constants.WeiPerEther
    });
  }

  console.log("got signers:", {
    networkName,
    networkKey,
    root: root.address,
    safeOwner: safeOwner.address,
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

  const ns = (await ethers.getContractAt(
    "NameService",
    release.NameService
  )) as NameService;

  const proposalContracts = [
    ns.address, //nameservice add DistributionHelper,MultiChainRouter,MultiChain AnyGoodDollar,
    DHelper.address, //update addresses from nameservice
    DHelper.address, //distribution helper -> add fuse community pool as recipient with 100%
    release.GoodReserveCDai, //upgradeTo
    release.GoodReserveCDai, //Reserve -> set distribution helper + non ubi bps
    release.GoodReserveCDai, //Reserve -> set new decline rate
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
        122, //chainid
        communitySafe, //recipient address,
        0 //recipient type via fuse bridge
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
      networkName === "localhost"
        ? "0xE0c5daa7CC6F88d29505f702a53bb5E67600e7Ec"
        : release.GuardiansSafe,
      safeOwner
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
if (process.argv[1].includes("v3-upgrade")) main();
