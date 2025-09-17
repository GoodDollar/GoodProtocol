/***
 * Deploy helper contracts
 * AdminWallet, Faucet, Invites
 */
import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import {
  deployDeterministic,
  executeViaGuardian,
  executeViaSafe,
  verifyContract,
  verifyProductionSigner
} from "./helpers";
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

export const deployHelpers = async () => {
  const viaGuardians = false;

  let protocolSettings = defaultsDeep({}, ProtocolSettings[network.name], ProtocolSettings["default"]);
  let release: { [key: string]: any } = dao[network.name];

  let [root, ...signers] = await ethers.getSigners();
  const isProduction = network.name.includes("production");

  if (isProduction) verifyProductionSigner(root);
  //generic call permissions
  let schemeMock = root;

  console.log("got signers:", {
    network,
    root: root.address,
    schemeMock: schemeMock.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  console.log("deploying dist helper");
  const DistHelper = (await deployDeterministic(
    {
      name: "DistributionHelper",
      factory: await ethers.getContractFactory("GenericDistributionHelper"),
      isUpgradeable: true
    },
    [
      release.NameService,
      release.StaticOracle,
      protocolSettings.reserve.gasToken,
      protocolSettings.reserve.reserveToken,
      release.UniswapV3Router,
      [ethers.utils.parseEther("100"), ethers.utils.parseEther("100"), 5, 5]
    ]
  ).then(printDeploy)) as Contract;

  const torelease = {
    DistributionHelper: DistHelper.address
  };
  release = {
    ...release,
    ...torelease
  };
  await releaser(torelease, network.name, "deployment", false);

  console.log("setting nameservice addresses via guardian");
  const proposalContracts = [
    release.NameService //nameservice
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setAddresses(bytes32[],address[])" //add ubischeme
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32[]", "address[]"],
      [[keccak256(toUtf8Bytes("DISTRIBUTION_HELPER"))], [DistHelper.address]]
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

  let impl = await getImplementationAddress(ethers.provider, DistHelper.address);
  await verifyContract(impl, "contracts/reserve/GenericDistributionHelper.sol:GenericDistributionHelper", network.name);
};

export const main = async (networkName = name) => {
  await deployHelpers();
};
main();
