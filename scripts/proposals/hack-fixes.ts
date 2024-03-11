/***
 * Mainnet:
 * FIXES:
 *  - prevent hacked funds transfers
 *  - prevent burnFrom usage of hacked funds in reserve
 *  - prevent untrusted staking contracts
 *  - make sure GOOD rewards are recalculated on change
 *  - dont trust exchangehelper for funds transfer
 *  - dont trust goodfundmanager for funds transfer
 *  - better bridge selling G$s to cover fees
 *
 * PLAN:
 *  - upgrade reserve
 *  - upgrade distribution helper
 *  - upgrade multichainformula
 *  - upgrade goodfundmanager
 *  - upgrade staking distribution
 *  - upgrade exchangehelper
 *
 */

import { network, ethers } from "hardhat";
import { defaultsDeep, last } from "lodash";
import prompt from "prompt";

import { executeViaGuardian, executeViaSafe, verifyProductionSigner } from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
import { BigNumber } from "ethers";
let { name: networkName } = network;

export const upgradeMainnet = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let guardian = root;

  //simulate produciton on fork
  if (network.name === "hardhat" || network.name === "fork" || network.name === "localhost") {
    networkName = "production-mainnet";
  }

  let release: { [key: string]: any } = dao[networkName];
  let protocolSettings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

  //simulate on fork, make sure safe has enough eth to simulate txs
  if (network.name === "hardhat" || network.name === "fork" || network.name === "localhost") {
    guardian = await ethers.getImpersonatedSigner(protocolSettings.guardiansSafe);

    await root.sendTransaction({
      value: ethers.constants.WeiPerEther.mul(3),
      to: protocolSettings.guardiansSafe
    });
  }

  const rootBalance = await ethers.provider.getBalance(root.address).then(_ => _.toString());
  const guardianBalance = await ethers.provider.getBalance(guardian.address).then(_ => _.toString());

  console.log("got signers:", {
    networkName,
    root: root.address,
    guardian: guardian.address,
    balance: rootBalance,
    guardianBalance: guardianBalance
  });

  const reserveImpl = await ethers.deployContract("GoodReserveCDai");
  const distImpl = await ethers.deployContract("DistributionHelper");
  const stakersImpl = await ethers.deployContract("StakersDistribution");
  const exchangeImpl = await ethers.deployContract("ExchangeHelper");
  const goodFundManagerImpl = await ethers.deployContract("GoodFundManager");
  const multichainFormulaImpl = await ethers.deployContract("MultichainFeeFormula");

  console.log("executing proposals");

  const proposalContracts = [
    release.GoodReserveCDai,
    release.DistributionHelper,
    release.StakersDistribution,
    release.ExchangeHelper,
    release.GoodFundManager,
    release.GoodDollar // set formula
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)",
    "upgradeTo(address)",
    "upgradeTo(address)",
    "upgradeToAndCall(address,bytes)",
    "upgradeTo(address)",
    "setFormula(address)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [reserveImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [distImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [stakersImpl.address]),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes"],
      [exchangeImpl.address, exchangeImpl.interface.encodeFunctionData("setAddresses", [])]
    ),
    ethers.utils.defaultAbiCoder.encode(["address"], [goodFundManagerImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [multichainFormulaImpl.address])
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
};

export const main = async () => {
  prompt.start();
  const { network } = await prompt.get(["network"]);

  console.log("running step:", { network });
  switch (network) {
    case "mainnet":
      await upgradeMainnet();

      break;
  }
};

main().catch(console.log);
