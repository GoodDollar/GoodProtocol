/***
 * Upgrade dist helper to have better axelar base fee
 * Update the axelarbasefee
 * Send UBI G$s to the bridge for liquidity
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
import prompt from "prompt";
import { reset } from "@nomicfoundation/hardhat-network-helpers";

import {
  printDeploy,
  executeViaGuardian,
  executeViaSafe,
  verifyProductionSigner
} from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
import { verifyContract } from "../multichain-deploy/helpers";
import { IStaticOracle } from "../../types";
let { name: networkName } = network;

export const upgrade = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  // if (isProduction) verifyProductionSigner(root);

  let guardian = root;

  //simulate produciton on fork
  if (
    network.name === "localhost" ||
    network.name === "hardhat" ||
    network.name === "fork"
  ) {
    networkName = "production-mainnet";
  }

  let release: { [key: string]: any } = dao[networkName];
  let protocolSettings = defaultsDeep(
    {},
    ProtocolSettings[networkName],
    ProtocolSettings["default"]
  );

  //simulate on fork, make sure safe has enough eth to simulate txs
  if (
    network.name === "localhost" ||
    network.name === "hardhat" ||
    network.name === "fork"
  ) {
    guardian = await ethers.getImpersonatedSigner(
      protocolSettings.guardiansSafe
    );
    networkName = "production-mainnet";

    await root.sendTransaction({
      value: ethers.constants.WeiPerEther.mul(3),
      to: protocolSettings.guardiansSafe
    });
  }

  const rootBalance = await ethers.provider
    .getBalance(root.address)
    .then(_ => _.toString());
  const guardianBalance = await ethers.provider
    .getBalance(guardian.address)
    .then(_ => _.toString());

  const gd = await ethers.getContractAt("IGoodDollar", release["GoodDollar"]);

  const NEWBRIDGE = "0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5";
  const GUARDIANS_BALANCE = await gd.balanceOf(protocolSettings.guardiansSafe);

  if (GUARDIANS_BALANCE.eq(0)) throw new Error("guardian has no G$ balance");

  const bridgeDeployed = await ethers.provider
    .getCode(NEWBRIDGE)
    .then(_ => _ != "0x");
  if (!bridgeDeployed) throw new Error("bridge not deployed yet");

  console.log("got signers:", {
    networkName,
    root: root.address,
    guardian: guardian.address,
    balance: rootBalance,
    guardianBalance: guardianBalance
  });

  console.log("executing proposals");

  const proposalContracts = [
    release.DistributionHelper, //controller -> upgrade disthelper
    release.DistributionHelper, //update axelar fee
    protocolSettings.guardiansSafe + "_" + release.GoodDollar //transfer G$s from guardians to bridge
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)", //upgrade disthelper
    "setFeeSettings((uint128,uint128,uint128,uint128,uint128,uint8))",
    "transfer(address,uint256)" // transfer G$s from guardians to bridge
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(
      ["address"],
      ["0xa339B7F4E95A93d2c6569cb139AD034C3b9cAA77"]
    ),
    //uint128 axelarBaseFeeUSD;uint128 bridgeExecuteGas;uint128 targetChainGasPrice;uint128 maxFee;uint128 minBalanceForFees;uint8 percentageToSellForFee;
    //0.2 AXL base fee, 400000 bridge execute, 5 gwei gas price, 5e15 eth max fee, min balance 1e16, percentage 5%
    ethers.utils.defaultAbiCoder.encode(
      ["uint128", "uint128", "uint128", "uint128", "uint128", "uint8"],
      [
        "200000000000000000",
        "400000",
        "5000000000",
        "5000000000000000",
        "10000000000000000",
        "5"
      ]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256"],
      [NEWBRIDGE, GUARDIANS_BALANCE] // transfer G$ to bridge
    )
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

  //perform sanity checks on fork, for production we need to wait until everything executed
  if (!isProduction) {
    let fm = await ethers.getContractAt(
      "GoodFundManager",
      release.GoodFundManager
    );
    let dh = await ethers.getContractAt(
      "DistributionHelper",
      release.DistributionHelper
    );

    console.log(
      "gd balances: guardians:",
      await gd.balanceOf(guardian.address),
      " bridge:",
      await gd.balanceOf(NEWBRIDGE)
    );
  }
};

export const main = async () => {
  await upgrade();
};

main().catch(console.log);
