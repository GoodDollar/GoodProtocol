/***
 * Upgrade Reserve
 * Upgrade Plan:
 * - deploy new impl, fund manager
 * - create guardians safe proposal to upgrade reserve + fundmanager
 * - create guardians safe proposal to call setGDXDisabled (optional)
 * - create guardians safe proposal to set the new distribution helper amounts
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";

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

export const upgrade = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let guardian = root;
  // simulate on fork
  if (network.name === "hardhat") {
    networkName = "production-mainnet";
    root = await ethers.getImpersonatedSigner("0x5128E3C1f8846724cc1007Af9b4189713922E4BB");
  }

  let release: { [key: string]: any } = dao[networkName];
  let protocolSettings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);
  //make sure safe has enough eth to simulate txs
  if (network.name === "hardhat") {
    guardian = await ethers.getImpersonatedSigner(protocolSettings.guardiansSafe);
    await root.sendTransaction({ value: ethers.constants.WeiPerEther, to: protocolSettings.guardiansSafe });
  }

  console.log("got signers:", {
    networkName,
    root: root.address,
    guardian: guardian.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString()),
    guardianBalance: await ethers.provider.getBalance(guardian.address).then(_ => _.toString())
  });

  let networkEnv = networkName.split("-")[0];
  const fuseNetwork = networkEnv;
  if (networkEnv === "fuse") networkEnv = "development";
  const celoNetwork = networkEnv + "-celo";

  let f = await ethers.getContractFactory("GoodFundManager");
  console.log("bytecode", f.bytecode.length);
  let newReserveImpl = (await ethers.deployContract("GoodReserveCDai").then(printDeploy)) as Contract;
  let newFundmanagerImpl = (await ethers.deployContract("GoodFundManager").then(printDeploy)) as Contract;

  if (isProduction) await verifyContract(newReserveImpl, "GoodReserveCDai", networkName);

  const proposalContracts = [
    release.GoodReserveCDai, //controller -> upgrade reserve
    release.GoodFundManager, //controller -> upgrade fundmanager
    release.DistributionHelper, //set new distribution params
    release.DistributionHelper, //set new distribution params
    release.DistributionHelper, //set new distribution params
    release.DistributionHelper, //set new distribution params
    release.DistributionHelper, //set new distribution params
    release.GoodReserveCDai // call setGDXDisabled
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)", //upgrade reserve
    "upgradeTo(address)", //upgrade fundmanager
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // remove fuse community safe distribution
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // fuse distribution
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // celo distribution
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // community pool distribution
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // savings rewards distribution
    "setGDXDisabled(bool,bool)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [newReserveImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [newFundmanagerImpl.address]),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [0, 122, dao[fuseNetwork].CommunitySafe, 0] //40% chainId 122 ubischeme 0-fuse bridge
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [4000, 122, dao[fuseNetwork].UBIScheme, 0] //40% chainId 122 ubischeme 0-fuse bridge
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [4000, 42220, dao[celoNetwork].UBIScheme, 1] //40% chainId 42220 ubischeme 1-multichain bridge
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [1000, 42220, dao[celoNetwork].GoodDollarMintBurnWrapper, 1] //10% chainId 42220 mintburnwrapper 1-multichain bridge
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [1000, 42220, dao[celoNetwork].CommunitySafe, 1] //10% chainId 42220 community treasury 1-multichain bridge
    ),
    ethers.utils.defaultAbiCoder.encode(["bool", "bool"], [true, false])
  ];

  if (isProduction) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      protocolSettings.guardiansSafe,
      "mainnet"
    );
  } else {
    //simulation or dev envs
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkName
    );
  }

  //perform sanity checks
  let fm = await ethers.getContractAt("GoodFundManager", release.GoodFundManager);
  let dh = await ethers.getContractAt("DistributionHelper", release.DistributionHelper);
  let r = await ethers.getContractAt("GoodReserveCDai", release.GoodReserveCDai);

  console.log(await dh.distributionRecipients(0));
  console.log(await dh.distributionRecipients(1));
  console.log(await dh.distributionRecipients(2));
  console.log(await dh.distributionRecipients(3));
  console.log(await dh.distributionRecipients(4));

  console.log("gdx/discount disabled", await r.gdxDisabled(), await r.discountDisabled());
  if (isProduction) {
    let tx = await fm.callStatic.collectInterest([], true);
    console.log(tx);
  } else {
    let tx = await (await fm.collectInterest([], true)).wait();
    console.log(tx.events);
  }
};

export const main = async () => {
  await upgrade().catch(console.log);
};
if (process.argv[1].includes("reserve-upgrade")) main();
