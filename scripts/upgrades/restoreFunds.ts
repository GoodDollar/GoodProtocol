/***
 * restore DAO funds accidently sent to ubischeme
 *
 ***/

import { network, ethers } from "hardhat";
import { reset } from "@nomicfoundation/hardhat-network-helpers";
import { defaultsDeep } from "lodash";
import { executeViaSafe, executeViaGuardian } from "../multichain-deploy/helpers";
import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
let { name: networkName } = network;

export const upgrade = async () => {
  let [root] = await ethers.getSigners();

  const NEW_UBISCHEME = "0x1c90f733e1724bd1dB47f84CDE4f9e83087cFB6d";
  const WITHDRAW_AMOUNT = "3000000000"; //30M G$
  const DAO_TREASURY = "0xCe69892CbDA078BbFAA3E5aE7A4b4d2Bf3E5c412";

  const isProduction = networkName.includes("production");

  const isForkSimulation = networkName === "localhost";

  let networkEnv = networkName.split("-")[0];
  if (isForkSimulation) {
    await reset("https://rpc.fuse.io");

    networkEnv = "production";
  }

  if (networkEnv === "fuse") networkEnv = "development";

  let release: { [key: string]: any } = dao[networkEnv];

  let protocolSettings = defaultsDeep({}, ProtocolSettings[networkEnv], ProtocolSettings["default"]);

  let guardian = root;

  if (isForkSimulation) {
    guardian = await ethers.getImpersonatedSigner(protocolSettings.guardiansSafe);
    await root.sendTransaction({ value: ethers.constants.WeiPerEther, to: protocolSettings.guardiansSafe });
  }

  console.log({ networkEnv, guardian: guardian.address, isForkSimulation, isProduction });
  const proposalContracts = [
    release.UBIScheme, //upgrade
    release.UBIScheme // withdraw funds
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)", // set new bridge name
    "withdraw(uint256,address)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [NEW_UBISCHEME]),
    ethers.utils.defaultAbiCoder.encode(["uint256", "address"], [WITHDRAW_AMOUNT, DAO_TREASURY])
  ];

  if (isProduction) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "fuse"
    );
  } else {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv
    );
  }

  if (isForkSimulation) {
    const gd = await ethers.getContractAt("IERC20", release["GoodDollar"]);
    const balanceAfter = await gd.balanceOf(DAO_TREASURY);
    console.log(balanceAfter);
  }
};

upgrade();
