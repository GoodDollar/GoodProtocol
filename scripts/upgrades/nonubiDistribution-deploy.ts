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
  executeViaGuardian
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
  let release: { [key: string]: any } = dao[networkName];

  let [root, ...signers] = await ethers.getSigners();
  const proposer = new ethers.Wallet(process.env.PROPOSER_KEY, ethers.provider); //need proposer with 0.3% of GOOD tokens

  console.log("got signers:", {
    networkName,
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
  if (!release.GoodDollarStaking) {
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

  //create proposal
  const vm = (await ethers.getContractAt(
    "CompoundVotingMachine",
    release.CompoundVotingMachine
  )) as CompoundVotingMachine;

  const ctrl = (await ethers.getContractAt(
    "Controller",
    release.Controller
  )) as Controller;

  const ns = (await ethers.getContractAt(
    "NameService",
    release.NameService
  )) as NameService;

  const proposalContracts = [
    release.GoodReserveCDai, //upgradeTo
    release.GoodReserveCDai, //Reserve -> set distribution helper + non ubi bps
    DHelper.address, //distribution helper -> add fuse GoodDollarMintBurnWrapper as recipient with 100%
    ns.address, //nameservice add DistributionHelper
    ns.address, //nameservice add MultiChainRouter
    ns.address //nameservice add MultiChain AnyGoodDollar
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)",
    "setDistributionHelper(address,uint32)",
    "addOrUpdateRecipient((uint32,uint32,address,uint8))",
    "setAddress(string,address)",
    "setAddress(string,address)",
    "setAddress(string,address)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [reserveImpl.address]), //upgradeTo(address)
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint32"],
      [release.GoodReserveCDai, 1000]
    ), //setDistributionHelper(address,uint32)
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [
        10000, //bps
        122, //chainid
        release.GoodDollarMintBurnWraper, //recipient address,
        0 //recipient type via Fuse bridge
      ]
    ), //addOrUpdateRecipient((uint32,uint32,address,uint8))
    ethers.utils.defaultAbiCoder.encode(
      ["string", "address"],
      ["DISTRIBUTION_HELPER", DHelper.address]
    ), //setAddress(string,address)"
    ethers.utils.defaultAbiCoder.encode(
      ["string", "address"],
      ["MULTICHAIN_ROUTER", release.MultichainRouter]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["string", "address"],
      ["MULTICHAIN_ANYGOODDOLLAR", release.AnyGoodDollar]
    )
  ];

  if (networkName === "fuse-mainnet") {
    return executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      root
    );
  }

  console.log("creating proposal...");
  await vm
    .connect(proposer)
    ["propose(address[],uint256[],string[],bytes[],string)"](
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      "https://discourse.gooddollar.org/t/gip-5-allocating-part-of-ubi-inflation-towards-g-savings-account/114/20"
    )
    .then(printDeploy);
};

export const main = async () => {
  await deployMainnet().catch(console.log);
};
if (process.argv[1].includes("nonubiDistribution")) main();
