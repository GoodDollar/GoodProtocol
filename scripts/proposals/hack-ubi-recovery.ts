/***
 * Bring UBI distribution to a temporary working state
 * Celo:
 *  - upgrade bridge to be able to prevent UBI bridge transfers as result of the hack
 *  - mark unexecuted bridge transfers as executed
 *  - set UBI with new cycle params
 *  - unpause ubi contract
 * Fuse:
 *  - withdraw ubi to avatar and bridge ubi to contract on celo
 *  - burn excess UBI tokens
 *  - set UBI with new cycle params
 *  - unpause ubi contract
 * Mainnet:
 *  - withdraw excess UBI from bridge to avatar
 *  - burn excess UBI from bridge
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

export const upgradeCelo = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let guardian = root;

  //simulate produciton on fork
  if (network.name === "hardhat" || network.name === "fork" || network.name === "localhost") {
    networkName = "production-celo";
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

  const NEWBRIDGE_IMPL = "0x691dE730D97d545c141D13ED5e9c12b7cB384a73";

  const ubiImpl = await ethers.deployContract("UBISchemeV2");

  console.log("got signers:", {
    networkName,
    root: root.address,
    guardian: guardian.address,
    balance: rootBalance,
    guardianBalance: guardianBalance
  });

  console.log("executing proposals");

  const proposalContracts = [
    release.MpbBridge, //controller -> upgrade bridge contract
    release.MpbBridge, //mark request 0x3d959d3438182af92242207591931a28de09296035c08e355167c1f9aae0f7ab as executed
    release.MpbBridge, //mark request 0x73dff6aa07a76330c9dbcb0920d9cbb67489e22d9dd452aaf867f4008f4e7598 as executed
    release.MpbBridge, //mark request 0x8bf2c3df2954005b4ce077b68fce35f80b0e94efee349db5a417cdc8e2c52ba2 as executed
    release.MpbBridge, //mark request 0x06d2ae5f6b7943c6d36da248512dfad48ace22c9447c3cacb9b403907678e5a2 as executed
    release.UBIScheme, //set new ubi contract
    release.UBIScheme, //set cycle length to 60 days
    release.UBIScheme //unpause ubi
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)", // set new bridge name
    "preventRequest(uint256)", //prevent bridge hack ubi request
    "preventRequest(uint256)", //prevent bridge hack ubi request
    "preventRequest(uint256)", //prevent bridge hack ubi request
    "preventRequest(uint256)", //prevent bridge hack ubi request
    "upgradeTo(address)", // set new ubi contract
    "setCycleLength(uint256)", //set new cycle length
    "pause(bool)" // unpause ubi
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [NEWBRIDGE_IMPL]),
    ethers.utils.defaultAbiCoder.encode(
      ["uint256"],
      ["0x3d959d3438182af92242207591931a28de09296035c08e355167c1f9aae0f7ab"]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint256"],
      ["0x73dff6aa07a76330c9dbcb0920d9cbb67489e22d9dd452aaf867f4008f4e7598"]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint256"],
      ["0x8bf2c3df2954005b4ce077b68fce35f80b0e94efee349db5a417cdc8e2c52ba2"]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint256"],
      ["0x06d2ae5f6b7943c6d36da248512dfad48ace22c9447c3cacb9b403907678e5a2"]
    ),
    ethers.utils.defaultAbiCoder.encode(["address"], [ubiImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [60]),
    ethers.utils.defaultAbiCoder.encode(["bool"], [false])
  ];

  if (isProduction) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      protocolSettings.guardiansSafe,
      "celo"
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
    let ubi = await ethers.getContractAt("UBISchemeV2", release.UBIScheme);
    let bridge = await ethers.getContractAt(
      ["function executedRequests(uint256) view returns (bool)"],
      release.MpbBridge
    );

    console.log(await bridge.executedRequests("0x3d959d3438182af92242207591931a28de09296035c08e355167c1f9aae0f7ab"));
    console.log(await bridge.executedRequests("0x73dff6aa07a76330c9dbcb0920d9cbb67489e22d9dd452aaf867f4008f4e7598"));
    console.log(await bridge.executedRequests("0x8bf2c3df2954005b4ce077b68fce35f80b0e94efee349db5a417cdc8e2c52ba2"));
    console.log(await bridge.executedRequests("0x06d2ae5f6b7943c6d36da248512dfad48ace22c9447c3cacb9b403907678e5a2"));

    console.log("cycle length", await ubi.cycleLength(), "ubi pause:", await ubi.paused());
  }
};

export const upgradeFuse = async () => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  const isForkSimulation = networkName === "localhost";

  let networkEnv = networkName.split("-")[0];
  if (isForkSimulation) networkEnv = "production";

  if (networkEnv === "fuse") networkEnv = "development";

  let release: { [key: string]: any } = dao[networkEnv];

  let guardian = root;
  //simulate on fork, make sure safe has enough eth to simulate txs
  if (network.name === "localhost" || network.name === "fork") {
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({
      value: ethers.constants.WeiPerEther.mul(3),
      to: guardian.address
    });
  }

  const NEWBRIDGE = release["MpbBridge"];
  const gd = await ethers.getContractAt("IERC20", release["GoodDollar"]);
  const ubiGdBalance = await gd.balanceOf(release.UBIScheme);
  const CELO_UBI_BALANCE = 1444008974;
  const KEEP_UBI = 11e2 * 60 * 70000; // to keep on fuse 11 G$ for 60 days for 70k users
  const EXCESS_UBI = ubiGdBalance.sub(BigNumber.from(KEEP_UBI));
  const BRIDGE_UBI = 40e2 * 60 * 70000 - CELO_UBI_BALANCE; // out of excess ubi to bridge to celo 40 G$ for 60 days for 70k users
  const BURN_UBI = EXCESS_UBI.sub(BigNumber.from(BRIDGE_UBI)).toString(); // out of excess ubi to burn

  console.log({ EXCESS_UBI, KEEP_UBI, BURN_UBI, BRIDGE_UBI });
  const gdTotalSupply = await gd.totalSupply();

  console.log({
    networkEnv,
    NEWBRIDGE,
    guardian: guardian.address,
    isForkSimulation,
    isProduction,
    avatarBalance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  const proposalContracts = [
    release.UBIScheme, //withdraw ubi
    release.GoodDollar, // burn
    release.GoodDollar, // approve to bridge
    release.MpbBridge, // execute bridge (needs value)
    release.UBIScheme, //set cycle length to 60 days
    release.UBIScheme //unpause ubi
  ];

  const proposalEthValues = proposalContracts.map(_ => ethers.constants.Zero);
  proposalEthValues[3] = ethers.utils.parseEther("0.8");

  const proposalFunctionSignatures = [
    "withdraw(uint256,address)", // withdraw excess ubi
    "burn(uint256)", // burn excess ubi
    "approve(address,uint256)", // approve bridge of excess ubi
    "bridgeTo(address,uint256,uint256,uint8)", // bridge request to celo ubi
    "setCycleLength(uint256)", //set new cycle length
    "pause(bool)" // unpause ubi
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["uint256", "address"], [EXCESS_UBI, release.Avatar]), //setAddresses(bytes32[],address[])"
    ethers.utils.defaultAbiCoder.encode(["uint256"], [BURN_UBI]),
    ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [release.MpbBridge, BRIDGE_UBI]),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "uint256", "uint8"],
      [dao["production-celo"].UBIScheme, 42220, BRIDGE_UBI, 1]
    ),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [60]),
    ethers.utils.defaultAbiCoder.encode(["bool"], [false])
  ];

  // make sure avatar has enough Fuse for bridge tx
  await root.sendTransaction({
    value: ethers.utils.parseEther("0.8"),
    to: release.Avatar
  });

  console.log(
    "bridge before allowance:",
    await gd.allowance(release.Avatar, release.MpbBridge),
    "avatarBalance",
    await ethers.provider.getBalance(root.address).then(_ => _.toString())
  );

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

  if (!isProduction) {
    let ubi = await ethers.getContractAt("UBISchemeV2", release.UBIScheme);
    let bridge = await ethers.getContractAt(
      [
        "event BridgeRequest(address indexed from, address indexed to, uint256 targetChainId, uint256 normalizedAmount, uint256 timestamp, uint8 bridge, uint256 indexed id)"
      ],
      release.MpbBridge
    );

    const finalAvatarBalance = await gd.balanceOf(release.Avatar);

    const finalgdTotalSupply = await gd.totalSupply();
    const finalubiGdBalance = await gd.balanceOf(release.UBIScheme);
    console.log("burned:", gdTotalSupply.sub(finalgdTotalSupply), "to burn:", EXCESS_UBI);
    console.log("ubi balance change:", ubiGdBalance.sub(finalubiGdBalance));

    console.log("cycle length", await ubi.cycleLength(), "ubi pause:", await ubi.paused());
    console.log("avatar balance:", finalAvatarBalance);
    console.log("bridge allowance:", await gd.allowance(release.Avatar, release.MpbBridge));
    const f = bridge.filters.BridgeRequest();
    const events = await bridge.queryFilter(f);
    console.log(last(events));
  }
};

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

  const CELO_UBI_BURN = 20193470562 + 161547764498 + 146346390158 + 18293298769; //hacker minted ubi
  const FUSE_UBI_BURN = 20336841183; //hacker minted ubi, not including ubi left for 60 days
  const TOTAL_BURN = CELO_UBI_BURN + FUSE_UBI_BURN;

  const gd = await ethers.getContractAt("IERC20", release["GoodDollar"]);
  const [bridgeBalance, totalSupply] = await Promise.all([gd.balanceOf(release.MpbBridge), gd.totalSupply()]);
  console.log("executing proposals");

  const proposalContracts = [
    release.MpbBridge, //controller -> withdraw extra ubi funds from bridge
    release.GoodDollar //burn
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "withdraw(address,uint256)", // withdraw ubi
    "burn(uint256)" //burn ubi
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256"],
      ["0x67C5870b4A41D4Ebef24d2456547A03F1f3e094B", TOTAL_BURN]
    ),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [TOTAL_BURN])
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
    const [bridgeBalanceAfter, totalSupplyAfter] = await Promise.all([
      gd.balanceOf(release.MpbBridge),
      gd.totalSupply()
    ]);
    console.log("bridge balance before:", bridgeBalance.toString());
    console.log("bridge balance before:", bridgeBalanceAfter.toString());
    console.log("total supply before:", totalSupply.toString());
    console.log("total supply after:", totalSupplyAfter.toString());
  }
};

export const main = async () => {
  prompt.start();
  const { network } = await prompt.get(["network"]);

  console.log("running step:", { network });
  switch (network) {
    case "celo":
      await upgradeCelo();
      break;
    case "fuse":
      await upgradeFuse();
      break;
    case "mainnet":
      await upgradeMainnet();

      break;
  }
};

main().catch(console.log);
