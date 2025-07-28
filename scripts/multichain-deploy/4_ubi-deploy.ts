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

  console.log("deploying ubi pool");
  const UBIScheme = (await deployDeterministic(
    {
      name: "UBISchemeV2",
      factory: await ethers.getContractFactory("UBISchemeV2"),
      isUpgradeable: true
    },
    [release.NameService]
  ).then(printDeploy)) as Contract;

  const torelease = {
    UBIScheme: UBIScheme.address
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
      [[keccak256(toUtf8Bytes("UBISCHEME"))], [UBIScheme.address]]
    )
  ];

  if (!name.includes("production")) {
    console.log("minting G$s to pool on dev envs");
    const gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);
    const decimals = await gd.decimals();
    await gd.mint(UBIScheme.address, ethers.BigNumber.from(1e6).mul(ethers.BigNumber.from("10").pow(decimals))); //1million GD
  }

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

  let impl = await getImplementationAddress(ethers.provider, UBIScheme.address);
  await verifyContract(impl, "contracts/ubi/UBISchemeV2.sol:UBISchemeV2", network.name);
};

export const main = async (networkName = name) => {
  await deployHelpers();
};
main();
