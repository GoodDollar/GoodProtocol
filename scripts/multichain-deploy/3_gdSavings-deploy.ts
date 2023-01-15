/***
 * complete deploy of the new G$ savings concept
 * steps required:
 * sidechain
 * 1. deploy GoodDollarMintBurnWrapper
 * 2. deploy G$Savings
 * 3. create proposal to:
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
import { defaultsDeep } from "lodash";

import {
  deployDeterministic,
  printDeploy,
  executeViaGuardian,
  executeViaSafe
} from "./helpers";
import releaser from "../../scripts/releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { deployWrapper } from "./multichainWrapper-deploy";
import {
  GoodDollarMintBurnWrapper,
  Controller,
  NameService
} from "../../types";
const { name: networkName } = network;

export const deploySidechain = async () => {
  const isProduction = networkName.includes("production");
  let release: { [key: string]: any } = dao[networkName];
  let settings = defaultsDeep(
    {},
    ProtocolSettings[networkName],
    ProtocolSettings["default"]
  );

  let [root] = await ethers.getSigners();

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
        isUpgradeable: false
      },
      [
        release.NameService,
        ethers.BigNumber.from(settings.savings.blockAPY),
        ethers.BigNumber.from(settings.savings.blocksPerYear),
        settings.savings.daysUntilUpgrade
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
  if (networkName.includes("production"))
    return console.log(
      "Skipping proposal/upgrade for production, need to perform manually"
    );

  await executeProposal(
    GDSavings.address,
    Wrapper.address,
    settings.guardiansSafe
  );
};

const executeProposal = async (
  savingsAddress: string,
  wrapperAddress: string,
  guardiansSafe: string
) => {
  console.log("executing savings + wrapper proposal");
  const isProduction = networkName.includes("production");
  let release: { [key: string]: any } = dao[networkName];
  savingsAddress = savingsAddress || release.GoodDollarStaking;
  wrapperAddress = wrapperAddress || release.GoodDollarMintBurnWrapper;

  let [root] = await ethers.getSigners();
  /// we now use guardians and not direct onchain voting, so no need for proposer
  //on celo we dont need voting yet to deploy it.
  //dev env dont use voting for test purposes
  // const proposer =
  //   !networkName.includes("celo") &&
  //   (isProduction || networkName.includes("staging"))
  //     ? new ethers.Wallet(process.env.PROPOSER_KEY, ethers.provider)
  //     : root; //need proposer with 0.3% of GOOD tokens

  const ctrl = (await ethers.getContractAt(
    "Controller",
    release.Controller
  )) as Controller;

  const ns = (await ethers.getContractAt(
    "NameService",
    release.NameService
  )) as NameService;

  const proposalContracts = [
    wrapperAddress, //MinterWrapper -> add GDSavings
    ctrl.address, //controller -> add MinterWrapper as scheme
    ctrl.address, // controller -> add GDSavings as scheme
    ns.address //nameservice add MinterWrapper
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "addMinter(address,uint256,uint256,uint32,uint256,uint256,uint32,bool)", //add gooddollarstaking as minter in gooddollarwrapper
    "registerScheme(address,bytes32,bytes4,address)", //make sure gooddollarwrapper is a registered scheme so it can mint G$ tokens
    "registerScheme(address,bytes32,bytes4,address)", //make sure gdsavings has generic call so it can perform the upgrade process
    "setAddress(string,address)" //add gooddollarwrapper in nameservice
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(
      [
        "address",
        "uint256",
        "uint256",
        "uint32",
        "uint256",
        "uint256",
        "uint32",
        "bool"
      ],
      [savingsAddress, 0, 0, 30, 0, 0, 0, true]
    ), //function addMinter(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [
        wrapperAddress, //scheme
        ethers.constants.HashZero, //paramshash
        "0x00000001", //permissions - minimal
        release.Avatar
      ]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [
        savingsAddress, //scheme
        ethers.constants.HashZero, //paramshash
        "0x000000f1", //permissions - genericcall
        release.Avatar
      ]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["string", "address"],
      ["MINTBURN_WRAPPER", wrapperAddress]
    )
  ];

  if (!isProduction) {
    console.log("upgrading via guardian...");

    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      root
    );
  } else {
    console.log("creating proposal...");
    //create proposal
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardiansSafe
    );

    // const vm = (await ethers.getContractAt(
    //   "CompoundVotingMachine",
    //   release.CompoundVotingMachine
    // )) as CompoundVotingMachine;

    // await vm
    //   .connect(proposer)
    //   ["propose(address[],uint256[],string[],bytes[],string)"](
    //     proposalContracts,
    //     proposalEthValues,
    //     proposalFunctionSignatures,
    //     proposalFunctionInputs,
    //     "https://discourse.gooddollar.org/t/gip-5-allocating-part-of-ubi-inflation-towards-g-savings-account/114/20"
    //   )
    //   .then(printDeploy);
  }

  const Controller = await ethers.getContractAt(
    "Controller",
    release.Controller
  );
  const wrapperDaoPermissions = await Controller.getSchemePermissions(
    wrapperAddress,
    release.Avatar
  );
  const savingsDaoPermissions = await Controller.getSchemePermissions(
    savingsAddress,
    release.Avatar
  );

  console.log({
    wrapperDaoPermissions,
    savingsDaoPermissions
  });
};

export const main = async () => {
  await deploySidechain();
  // await executeProposal(undefined, undefined);
};
if (process.argv[1].includes("gdSavings")) main();
