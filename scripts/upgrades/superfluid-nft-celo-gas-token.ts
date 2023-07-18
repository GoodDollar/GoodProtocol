/***
 * Upgrade celo's supergooddollar with support for superfluid nfts + celo gas token requirements
 * Upgrade Plan:
 * - deploy implementation
 * - call updateCode
 * - once nfts are deployed create and nft and set it
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";
// import OutNFT from "@superfluid-finance/ethereum-contracts/artifacts/contracts/superfluid/ConstantOutflowNFT.sol/ConstantOutflowNFT.json";
// import InNFT from "@superfluid-finance/ethereum-contracts/artifacts/contracts/superfluid/ConstantInflowNFT.sol/ConstantInflowNFT.json";
import {
  deployDeterministic,
  printDeploy,
  executeViaGuardian,
  executeViaSafe,
  verifyProductionSigner
} from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
import { verifyContract } from "../multichain-deploy/helpers";
let { name: networkName } = network;

networkName = networkName.replace("-fork", "");

export const upgrade = async () => {
  let release: { [key: string]: any } = dao[networkName];
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();
  let withNFTs = false;

  if (isProduction) verifyProductionSigner(root);
  else withNFTs = true;

  let protocolSettings = defaultsDeep(
    {},
    ProtocolSettings[networkName],
    ProtocolSettings["default"]
  );

  console.log("got signers:", {
    withNFTs,
    networkName,
    root: root.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then(_ => _.toString())
  });

  const supergd = await ethers.getContractAt(
    "SuperGoodDollar",
    release.GoodDollar
  );
  const owner = await supergd.owner();
  const host = await supergd.getHost();
  const name = await supergd.name();
  const symbol = await supergd.symbol();
  console.log({ owner, host, symbol, name });
  let impl = await ethers.deployContract("SuperGoodDollar", [host]);

  await verifyContract(impl.address, "SuperGoodDollar", networkName);

  let outnftProxy, innftProxy;
  if (withNFTs) {
    outnftProxy = await ethers.deployContract("UUPSProxy").then(printDeploy);
    innftProxy = await ethers.deployContract("UUPSProxy").then(printDeploy);

    const outnftimpl = (await ethers
      .deployContract("ConstantOutflowNFT", [host, innftProxy.address])
      .then(printDeploy)) as Contract;

    const innftimpl = (await ethers
      .deployContract("ConstantInflowNFT", [host, outnftProxy.address])
      .then(printDeploy)) as Contract;

    await outnftProxy.initializeProxy(outnftimpl.address).then(printDeploy);
    await outnftimpl
      .attach(outnftProxy.address)
      .initialize(name + "-OutFlowNFT", symbol + "-OutFlowNFT")
      .then(printDeploy);

    await innftProxy.initializeProxy(innftimpl.address).then(printDeploy);
    await innftimpl
      .attach(innftProxy.address)
      .initialize(name + "-InFlowNFT", symbol + "-InFlowNFT")
      .then(printDeploy);
  }
  const proposalContracts = [
    release.GoodDollar, //upgrade
    release.GoodDollar //optionally set NFTs
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "updateCode(address)",
    "setNFTProxyContracts(address,address,address,address)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [impl.address]),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "address", "address"],
      [
        outnftProxy.address,
        innftProxy.address,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      ]
    )
  ];

  if (isProduction) {
    await executeViaSafe(
      proposalContracts.slice(0, withNFTs ? 2 : 1),
      proposalEthValues.slice(0, withNFTs ? 2 : 1),
      proposalFunctionSignatures.slice(0, withNFTs ? 2 : 1),
      proposalFunctionInputs.slice(0, withNFTs ? 2 : 1),
      protocolSettings.guardiansSafe
    );
  } else {
    await executeViaGuardian(
      proposalContracts.slice(0, withNFTs ? 2 : 1),
      proposalEthValues.slice(0, withNFTs ? 2 : 1),
      proposalFunctionSignatures.slice(0, withNFTs ? 2 : 1),
      proposalFunctionInputs.slice(0, withNFTs ? 2 : 1),
      root,
      networkName
    );
  }
};

export const main = async () => {
  await upgrade().catch(console.log);
};
if (process.argv[1].includes("superfluid-nft-celo-gas-token")) main();
