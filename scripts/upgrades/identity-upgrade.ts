/***
 * Upgrade Plan:
 * - deploy Identity (if on production)
 * - give adminWallet admin permissions
 * - revoke deployer permissions
 * - replace pointers to old identity contract in:
 *    - GoodDollar token
 *    - NameService
 */

import { network, ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import {
  deployDeterministic,
  printDeploy,
  executeViaGuardian
} from "../multichain-deploy/helpers";

import releaser from "../../scripts/releaser";

import dao from "../../releases/deployment.json";
import { DistributionHelper, Controller, NameService } from "../../types";
const { name: networkName } = network;

export const upgrade = async () => {
  let release: { [key: string]: any } = dao[networkName];
  const isProduction = networkName.includes("production");

  let [root, ...signers] = await ethers.getSigners();

  console.log("got signers:", {
    networkName,
    root: root.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then(_ => _.toString())
  });

  let Identity = await ethers.getContractAt("IdentityV2", release.Identity);
  if (isProduction) {
    console.log("deploying new identity on production");
    Identity = (await deployDeterministic(
      {
        name: "IdentityV2",
        salt: "Identity",
        isUpgradeable: true
      },
      [root, release.Identity]
    ).then(printDeploy)) as Contract;
    let torelease = {
      Identity: Identity.address,
      IdentityOld: release.Identity
    };

    await releaser(torelease, networkName, "deployment", false);
  }

  await executeProposal(Identity.address);
};

const executeProposal = async (identityAddress: string) => {
  console.log("executing identity proposal");
  const isProduction = networkName.includes("production");
  let release: { [key: string]: any } = dao[networkName];
  identityAddress = identityAddress || release.Identity;

  let [root] = await ethers.getSigners();
  //on celo we dont need voting yet to deploy it.
  //dev env dont use voting for test purposes
  const proposer =
    !networkName.includes("celo") &&
    (isProduction || networkName.includes("staging"))
      ? new ethers.Wallet(process.env.PROPOSER_KEY, ethers.provider)
      : root; //need proposer with 0.3% of GOOD tokens

  const ctrl = (await ethers.getContractAt(
    "Controller",
    release.Controller
  )) as Controller;

  const ns = (await ethers.getContractAt(
    "NameService",
    release.NameService
  )) as NameService;

  const GoodDollar = await ethers.getContractAt(
    "IGoodDollar",
    release.GoodDollar
  );

  const proposalContracts = [
    GoodDollar.address, //controller -> set new identity in G$
    ns.address //nameservice modify to new Identity
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setIdentity(address)", //set Identity on GoodDollar token
    "setAddress(string,address)" //set new identity address in nameservice
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [identityAddress]),
    ethers.utils.defaultAbiCoder.encode(
      ["string", "address"],
      ["IDENTITY", identityAddress]
    )
  ];

  if (!isProduction && networkName != "staging") {
    //on fuse staging also use voting for testing
    console.log("upgrading via guardian...");

    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      root
    );
  } else if (isProduction) {
    console.log("creating proposal...");
    //create proposal
    const vm = await ethers.getContractAt(
      "CompoundVotingMachine",
      release.CompoundVotingMachine
    );

    await vm
      .connect(proposer)
      ["propose(address[],uint256[],string[],bytes[],string)"](
        proposalContracts,
        proposalEthValues,
        proposalFunctionSignatures,
        proposalFunctionInputs,
        "upgrade identity"
      )
      .then(printDeploy);
  }

  const gdIdentity = await GoodDollar.identity();
  const nsIdentity = await ns.getAddress("IDENTITY");
  console.log({
    nameService: nsIdentity == identityAddress,
    gdIdentity: gdIdentity == identityAddress
  });
};

export const main = async () => {
  await upgrade().catch(console.log);
};
main();
