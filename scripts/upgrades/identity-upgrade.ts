/***
 * Upgrade Fuse to support whitelisting with orgchain
 * Upgrade Plan:
 * - deploy Identity
 * - give adminWallet admin permissions
 * - give new identy admin permissions in old identity
 * - revoke deployer permissions
 * - replace pointers to old identity contract in:
 *    - GoodDollar token
 *    - NameService
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import OldIdentityABI from "@gooddollar/goodcontracts/build/contracts/Identity.min.json";

import {
  deployDeterministic,
  printDeploy,
  executeViaGuardian,
  executeViaSafe,
  verifyProductionSigner
} from "../multichain-deploy/helpers";

import releaser from "../../scripts/releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
import { verifyContract } from "../multichain-deploy/helpers";
const { name: networkName } = network;

export const upgrade = async () => {
  let release: { [key: string]: any } = dao[networkName];
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let protocolSettings = defaultsDeep({}, ProtocolSettings[network.name], ProtocolSettings["default"]);

  console.log("got signers:", {
    networkName,
    root: root.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  let OldIdentity = await ethers.getContractAt(OldIdentityABI.abi, release.OldIdentity || release.Identity);
  // let Identity = await ethers.getContractAt("IdentityV2", release.Identity);
  // Identity = await ethers.getContractAt("IdentityV2", "0xb0cD4828Cc90C5BC28f4920Adf2Fd8F025003D7E");
  console.log("deploying new identity...");
  let Identity = (await deployDeterministic(
    {
      name: "IdentityV2",
      salt: "IdentityV2",
      isUpgradeable: true
    },
    [root.address, release.Identity]
  ).then(printDeploy)) as Contract;

  let torelease = {
    Identity: Identity.address,
    IdentityOld: release.Identity
  };

  await releaser(torelease, networkName, "deployment", false);

  console.log("calling initDAO...");
  const tx = await (await Identity.initDAO(release.NameService)).wait();
  await Identity.grantRole(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("identity_admin")),
    release.AdminWallet
  ).then(printDeploy);
  await OldIdentity.addIdentityAdmin(Identity.address).then(printDeploy);

  const impl = await getImplementationAddress(ethers.provider, Identity.address);
  await verifyContract(impl, "IdentityV2", networkName);

  const proposalContracts = [
    release.GoodDollar, //controller -> set new identity in G$
    release.NameService //nameservice modify to new Identity
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setIdentity(address)", //set Identity on GoodDollar token
    "setAddress(string,address)" //set new identity address in nameservice
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [Identity.address]),
    ethers.utils.defaultAbiCoder.encode(["string", "address"], ["IDENTITY", Identity.address])
  ];
  if (isProduction) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionSignatures,
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
};

export const main = async () => {
  await upgrade().catch(console.log);
};
if (process.argv[1].includes("identity-upgrade")) main();
