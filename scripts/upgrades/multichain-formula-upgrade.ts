/***
 * Upgrade FeeFormula to prevent usage of hacked multichain funds
 * Upgrade Plan:
 * - deploy new fee formula
 * - set token formula
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";

import { printDeploy, executeViaGuardian, executeViaSafe, verifyProductionSigner } from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
import { verifyContract } from "../multichain-deploy/helpers";
import { printError } from "graphql";
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
    const funded = await ethers.getImpersonatedSigner("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    await funded.sendTransaction({
      value: ethers.constants.WeiPerEther.mul(10),
      to: protocolSettings.guardiansSafe
    });
  }

  console.log("got signers:", {
    networkName,
    root: root.address,
    guardian: guardian.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString()),
    guardianBalance: await ethers.provider.getBalance(guardian.address).then(_ => _.toString())
  });

  let formulaImpl = (await ethers.deployContract("MultichainFeeFormula").then(printDeploy)) as Contract;

  if (isProduction) await verifyContract(formulaImpl, "MultichainFeeFormula", networkName);

  const proposalContracts = [
    release.GoodDollar //controller ->set fee formula
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setFormula(address)" //upgrade formula
  ];

  const proposalFunctionInputs = [ethers.utils.defaultAbiCoder.encode(["address"], [formulaImpl.address])];

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
  let gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);
  console.log("upgraded formula:", (await gd.formula()) == formulaImpl.address);
  let result = await gd["getFees(uint256,address,address)"](
    50000000000,
    "0xd17652350cfd2a37ba2f947c910987a3b1a1c60d",
    "0xd17652350cfd2a37ba2f947c910987a3b1a1c60d"
  );
  console.log("verify new formula fee == amount:", result.fee.toNumber() === 50000000000);

  if (isProduction) {
  } else if (network.name === "hardhat") {
    console.log("simulating taxable tx on fork...");
    const anyMpc = await ethers.getImpersonatedSigner("0x647dC1366Da28f8A64EB831fC8E9F05C90d1EA5a");
    let gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);
    const lockedBalance = await gd.balanceOf("0xd17652350cfd2a37ba2f947c910987a3b1a1c60d");
    console.log("anygooddollar locked balance 51098079793:", lockedBalance.toNumber() === 51098079793);
    let anygd = new ethers.Contract(
      "0xd17652350cfd2a37ba2f947c910987a3b1a1c60d",
      [
        "function withdrawVault(address from,uint amount,address to) external returns (uint)",
        "function depositVault(uint amount,address to) external returns (uint)",
        "event Transfer(address indexed from,address indexed to,uint value)"
      ],
      anyMpc
    );
    let anyRouter = new ethers.Contract(
      "0x765277EebeCA2e31912C9946eAe1021199B39C61",
      ["function changeVault(address token,address vault) external returns (bool)"],
      anyMpc
    );

    // make it easier to fake funds withdraw by setting vault as EOA account
    await anyRouter.changeVault(anygd.address, anyMpc.address).then(printDeploy);

    //perform txs that transfer funds
    await anygd.depositVault(lockedBalance, root.address).then(printDeploy);
    const tx = await anygd.withdrawVault(root.address, lockedBalance, root.address).then(printDeploy);

    console.log(
      "verify all funds sent to Avatar",
      tx.events.find(
        _ => _.args.to === "0x1ecFD1afb601C406fF0e13c3485f2d75699b6817" && _.args.value.eq(lockedBalance)
      ) !== undefined
    );
  }
};

export const main = async () => {
  await upgrade().catch(console.log);
};
if (process.argv[1].includes("formula-upgrade")) main();
