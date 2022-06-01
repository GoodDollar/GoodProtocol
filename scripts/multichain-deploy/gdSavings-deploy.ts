/***
 * complete deploy of the new G$ savings concept
 * steps required:
 * sidechain
 * 1. deploy GoodDollarMintBurnWrapper
 * 2. deploy G$Savings
 * 5. create proposal to:
 *  - add G$Savings as rewards minter on GoodDollarMintBurnWraper
 *  - register GoodDollarMintBurnWrapper as scheme so it can call mint on controller
 *  - register G$Savings as scheme so it can handle upgrade from GovernanceStaking
 *  - add GoodDollarMintBurnWraper to name service
 *
 * mainnet:
 * 1. deploy new reserve implementation
 * 2. deploy DistributionHelper
 * 3. create proposal to upgrade reserve
 *
 */

import { network, ethers, upgrades, run } from "hardhat";
import { Contract, Signer } from "ethers";

import { deployDeterministic, printDeploy } from "./helpers";
import releaser from "../../scripts/releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { deployWrapper } from "./multichainWrapper-deploy";
import {
  CompoundVotingMachine,
  GoodDollarMintBurnWrapper,
  Controller,
  NameService
} from "../../types";
const { name: networkName } = network;

const BLOCKS_PER_YEAR = (12 * 60 * 24 * 356).toString();
const BLOCK_APY = "1000000007735630000";

export const deploySidechain = async () => {
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

  let Wrapper;
  if (!release.GoodDollarMintBurnWrapper)
    Wrapper = (await deployWrapper(
      release.Avatar
    )) as GoodDollarMintBurnWrapper;
  else {
    Wrapper = await ethers.getContractAt(
      "GoodDollarMintBurnWrapper",
      release.GoodDollarMintBurnWrapper
    );
  }

  console.log("deploying savings...");

  let GDSavings;
  if (!release.GoodDollarStaking) {
    GDSavings = (await deployDeterministic(
      {
        name: "GoodDollarStaking",
        salt: "GoodDollarStaking",
        isUpgradeable: false
      },
      [
        release.NameService,
        ethers.BigNumber.from(BLOCK_APY),
        ethers.BigNumber.from(BLOCKS_PER_YEAR),
        networkName === "fuse" ? 7 : 30 //days until upgrade
      ]
    ).then(printDeploy)) as Contract;

    let torelease = {
      GoodDollarStaking: GDSavings.address
    };

    await releaser(torelease, networkName, "deployment", false);
  } else {
    GDSavings = await ethers.getContractAt(
      "GoodDollarStaking",
      release.GoodDollarStaking
    );
  }

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
    Wrapper.address, //MinterWrapper -> add GDSavings
    ctrl.address, //controller -> add MinterWrapper as scheme
    ctrl.address, // controller -> add GDSavings as scheme
    ns.address //nameservice add MinterWrapper
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "addMinter(address,uint256,uint256,uint32,bool)",
    "registerScheme(address,bytes32,bytes4,address)",
    "registerScheme(address,bytes32,bytes4,address)",
    "setAddress(string,address)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "uint256", "uint32", "bool"],
      [GDSavings.address, 0, 0, 30, true]
    ), //function addMinter(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [
        Wrapper.address, //scheme
        ethers.constants.HashZero, //paramshash
        "0x00000001", //permissions - minimal
        release.Avatar
      ]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [
        GDSavings.address, //scheme
        ethers.constants.HashZero, //paramshash
        "0x000000f1", //permissions - genericcall
        release.Avatar
      ]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["string", "address"],
      ["MintBurnWrapper", Wrapper.address]
    )
  ];

  if (networkName === "staging") {
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

const executeViaGuardian = async (
  contracts,
  ethValues,
  functionSigs,
  functionInputs,
  guardian: Signer
) => {
  let release: { [key: string]: any } = dao[networkName];
  const ctrl = await (
    await ethers.getContractAt("Controller", release.Controller)
  ).connect(guardian);

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    console.log("executing:", contracts[i], functionSigs[i], functionInputs[i]);
    const sigHash = ethers.utils
      .keccak256(ethers.utils.toUtf8Bytes(functionSigs[i]))
      .slice(0, 10);
    const encoded = ethers.utils.solidityPack(
      ["bytes4", "bytes"],
      [sigHash, functionInputs[i]]
    );
    if (contract === ctrl.address) {
      console.log("executing directly on controller:", sigHash, encoded);

      await guardian
        .sendTransaction({ to: contract, data: encoded })
        .then(printDeploy);
    } else {
      console.log("executing genericCall:", sigHash, encoded);
      await ctrl
        .genericCall(contract, encoded, release.Avatar, ethValues[i])
        .then(printDeploy);
    }
  }
};

export const main = async () => {
  await deploySidechain().catch(console.log);
};
if (process.argv[1].includes("gdSavings")) main();
