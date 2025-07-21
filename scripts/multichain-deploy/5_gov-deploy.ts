/***
 * Deploy helper contracts
 * AdminWallet, Faucet, Invites
 */
import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
import { deployDeterministic, executeViaGuardian, executeViaSafe, verifyProductionSigner } from "./helpers";
import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { TransactionResponse } from "@ethersproject/providers";
import { keccak256, toUtf8Bytes } from "ethers/lib/utils";

const { name } = network;

const printDeploy = async (c: Contract | TransactionResponse): Promise<Contract | TransactionResponse> => {
  if (c instanceof Contract) {
    await c.deployed();
    console.log("deployed to: ", c.address);
  }
  if (c.wait) {
    await c.wait();
    console.log("tx done:", c.hash);
  }
  return c;
};

export const deployGov = async () => {
  let protocolSettings = defaultsDeep({}, ProtocolSettings[network.name], ProtocolSettings["default"]);
  let release: { [key: string]: any } = dao[network.name];

  let [root] = await ethers.getSigners();
  const isProduction = name.includes("production");
  const viaGuardians = false;

  if (isProduction) verifyProductionSigner(root);

  const daoOwner = isProduction ? protocolSettings.guardiansSafe : root.address;

  console.log("got signers:", {
    network,
    root: root.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  const GReputation = (await deployDeterministic(
    {
      name: "GReputation",
      isUpgradeable: true,
      initializer: "initialize(address, string, bytes32, uint256)"
    },
    [
      release.NameService,
      "fuse",
      protocolSettings.governance.gdaoAirdrop, //should fail on real deploy if not set
      protocolSettings.governance.gdaoTotalSupply //should fail on real deploy if not set
    ]
  ).then(printDeploy)) as Contract;

  console.log("deploying voting machine");

  const VotingMachine = (await deployDeterministic(
    {
      name: "CompoundVotingMachine",
      isUpgradeable: true
    },
    [
      release.NameService,
      protocolSettings.governance.proposalVotingPeriod,
      protocolSettings.governance.guardian,
      release.GReputation
    ]
  ).then(printDeploy)) as Contract;

  const torelease = {
    CompoundVotingMachine: VotingMachine.address,
    GReputation: GReputation.address
  };
  release = {
    ...release,
    ...torelease
  };
  await releaser(torelease, network.name, "deployment", false);

  const deployerIsNotRepMinter = (await GReputation.hasRole(GReputation.MINTER_ROLE(), root.address)) === false;
  const avatarIsRepMinter = await GReputation.hasRole(GReputation.MINTER_ROLE(), release.Avatar);
  const grepHasDAOSet = (await GReputation.nameService()) === release.NameService;
  const factoryIsNotGoodOwner = (await GReputation.hasRole(ethers.constants.HashZero, release.ProxyFactory)) === false;
  console.log("verify GReputation permissions", {
    deployerIsNotRepMinter,
    avatarIsRepMinter,
    grepHasDAOSet,
    factoryIsNotGoodOwner
  });

  console.log("adding genericcall permissions to voting contract.");
  const proposalContracts = [
    release.NameService,
    release.Controller //nameservice add MinterWrapper
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setAddresses(bytes32[],address[])", //add reputation
    "registerScheme(address,bytes32,bytes4,address)" //make sure compoundvotingmachine has generic call so it can control the DAO
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32[]", "address[]"],
      [[keccak256(toUtf8Bytes("REPUTATION"))], [GReputation.address]]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [release.CompoundVotingMachine, ethers.constants.HashZero, "0x000000f1", release.Avatar]
    )
  ];

  try {
    if (viaGuardians) {
      await executeViaSafe(
        proposalContracts,
        proposalEthValues,
        proposalFunctionSignatures,
        proposalFunctionInputs,
        protocolSettings.guardiansSafe
      );
    } else {
      await executeViaGuardian(
        proposalContracts,
        proposalEthValues,
        proposalFunctionSignatures,
        proposalFunctionInputs,
        root
      );
    }
  } catch (e) {
    console.error("proposal execution failed...", e.message);
  }

  const Controller = await ethers.getContractAt("Controller", release.Controller);

  const votingMachineDaoPermissions = await Controller.getSchemePermissions(daoOwner, release.Avatar);

  console.log({
    votingMachineDaoPermissions
  });
};

export const main = async (networkName = name) => {
  await deployGov();
};
main();
