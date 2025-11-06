// Part 1 UBI+Bridge
// deploy dao to xdc - Done
// deploy bridge to xdc - Done
// give minting rights to xdc bridge - done
// upgrade to improved identity + ubischeme on celo + fuse
// upgrade bridge on celo/ethereum/fuse - make sure they include xdc
// burn celo bridge locked supply (now each chain has its own supply and all bridges are mint/burn)
// add celo bridge as minter

// Part 2 Reserve
// create uniswap pools on xdc
// calculate how much G$s each reserve is backing
// deploy mento reserve to xdc with calculated parameters
// give mento broker minting rights on xdc
// deploy distribution helper
// transfer usdc to xdc reserve
// update celo reserve parameters accordingly

import { network, ethers, upgrades } from "hardhat";
import { reset } from "@nomicfoundation/hardhat-network-helpers";
import { defaultsDeep, last } from "lodash";
import prompt from "prompt";

import {
  executeViaGuardian,
  executeViaSafe,
  verifyContract,
  verifyProductionSigner
} from "../multichain-deploy/helpers";

import dao from "../../releases/deployment.json";
import { Controller, IdentityV3, IGoodDollar, IMessagePassingBridge, UBISchemeV2 } from "../../types";
let { name: networkName } = network;
const isSimulation = network.name === "hardhat" || network.name === "fork" || network.name === "localhost";
const bridgeUpgradeImpl = {
  "production-celo": "0x7bDaF2Fb332761b2a6A565a43ccB0ACfC36d2C3D",
  production: "0x6f252280eB53df085eAD27BBe55d615741A8268D",
  "production-mainnet": "0x7baFe060A37E31E707b8B28a90a36731ee99aFBa"
};
export const upgradeCeloStep1 = async (network, checksOnly) => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  if (isProduction) verifyProductionSigner(root);

  let networkEnv = networkName;
  let guardian = root;
  if (isSimulation) {
    networkEnv = network;
  }

  let release: { [key: string]: any } = dao[networkEnv];

  console.log("signer:", root.address, { networkEnv, isSimulation, isProduction, release });

  if (isSimulation) {
    networkEnv = network;
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({
      value: ethers.utils.parseEther("1"),
      to: release.GuardiansSafe
    });
  }

  const ubiImpl = await ethers.deployContract("UBISchemeV2");
  const identityImpl = await ethers.deployContract("IdentityV3");
  const bridgeImpl = bridgeUpgradeImpl[networkEnv];
  const upgradeCall = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("upgrade()")).substring(0, 10);

  // Extract the first four bytes as the function selector
  console.log("deployed new impls", { ubiImpl: ubiImpl.address, identityImpl: identityImpl.address });

  const gd = (await ethers.getContractAt("IGoodDollar", release.GoodDollar)) as IGoodDollar;
  const avatarBalance = await gd.balanceOf(release.Avatar);
  const bridgeBalance = await gd.balanceOf(release.MpbBridge);
  const toBurn = avatarBalance.add(bridgeBalance);

  console.log("calculated burn amount:", {
    toBurn: toBurn.toString(),
    avatarBalance: avatarBalance.toString(),
    bridgeBalance: bridgeBalance.toString()
  });
  const proposalActions = [
    [release.UBIScheme, "upgradeTo(address)", ethers.utils.defaultAbiCoder.encode(["address"], [ubiImpl.address]), "0"], //upgrade ubi
    [
      release.Identity,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [identityImpl.address]),
      "0"
    ], //upgrade identity
    [
      release.MpbBridge,
      "upgradeToAndCall(address,bytes)",
      ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bridgeImpl, upgradeCall]),
      "0"
    ], //upgrade bridge
    [
      release.MpbBridge,
      "setConfig(uint16,uint16,uint256,bytes)",
      ethers.utils.defaultAbiCoder.encode(
        ["uint16", "uint16", "uint256", "bytes"],
        [0, 365, 5, "0x000000000000000000000000000000000000000000000000000000000000000f"]
      ),
      "0"
    ], //fix xdc bridge setting of outbound blocks confirmations
    [
      release.MpbBridge,
      "withdraw(address,uint256)",
      ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [release.GoodDollar, 0]),
      "0"
    ], //withdraw locked gd
    [release.GoodDollar, "burn(uint256)", ethers.utils.defaultAbiCoder.encode(["uint256"], [toBurn.toString()]), "0"], //burn locked supply on celo bridge
    [
      release.Controller,
      "registerScheme(address,bytes32,bytes4,address)",
      ethers.utils.defaultAbiCoder.encode(
        ["address", "bytes32", "bytes4", "address"],
        [release.MpbBridge, ethers.constants.HashZero, "0x00000001", release.Avatar]
      ),
      "0"
    ]
  ];

  console.log({
    networkEnv,
    guardian: guardian.address,
    isSimulation,
    isProduction,
    release
  });

  const proposalContracts = proposalActions.map(a => a[0]);
  const proposalFunctionSignatures = proposalActions.map(a => a[1]);
  const proposalFunctionInputs = proposalActions.map(a => a[2]);
  const proposalEthValues = proposalActions.map(a => a[3]);
  if (isProduction && !checksOnly) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "celo"
    );
  } else if (!checksOnly) {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv
    );
  }

  if (isSimulation || !isProduction) {
    const gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);
    const supplyAfter = await gd.totalSupply();
    const bridgeBalanceAfter = await gd.balanceOf(release.MpbBridge);
    console.log("Bridge balance after upgrade:", { bridgeBalanceAfter });
    console.log("Supply after upgrade:", { supplyAfter });

    const ctrl = (await ethers.getContractAt("Controller", release.Controller)) as Controller;
    const isMinterScheme = await ctrl.getSchemePermissions(release.MpbBridge, release.Avatar);
    console.log("Bridge minter permissions on avatar:", isMinterScheme);
    // check xdc chainid in bridge
    const mpb = (await ethers.getContractAt("IMessagePassingBridge", release.MpbBridge)) as IMessagePassingBridge;
    console.log("xdc lz chainid:", await mpb.toLzChainId(50));
    const ubi = (await ethers.getContractAt("UBISchemeV2", release.UBIScheme)) as UBISchemeV2;
    const claimer = await ethers.getImpersonatedSigner("0xA48840D89a761502A4a7d995c74f3864D651A87F");
    const identity = (await ethers.getContractAt("IdentityV3", release.Identity)) as IdentityV3;
    const tx = await (await identity.connect(claimer).connectAccount(guardian.address)).wait();
    console.log("Identity connect account tx:", tx);
    const claimTx = await (await ubi.connect(guardian).claim()).wait();
    console.log("UBI claim from connected account tx:", claimTx.events);
  }
};

export const upgradeFuseStep1 = async (network, checksOnly) => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  if (isProduction) verifyProductionSigner(root);

  let networkEnv = networkName;
  let guardian = root;
  if (isSimulation) {
    networkEnv = network;
  }

  let release: { [key: string]: any } = dao[networkEnv];

  console.log("signer:", root.address, { networkEnv, isSimulation, isProduction, release });

  if (isSimulation) {
    networkEnv = network;
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({
      value: ethers.utils.parseEther("1"),
      to: release.GuardiansSafe
    });
  }

  const ubiImpl = await ethers.deployContract("UBISchemeV2");
  const identityImpl = await ethers.deployContract("IdentityV3");
  const bridgeImpl = bridgeUpgradeImpl[networkEnv];
  const upgradeCall = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("upgrade()")).substring(0, 10);

  // Extract the first four bytes as the function selector
  console.log("deployed new impls", { ubiImpl: ubiImpl.address, identityImpl: identityImpl.address });

  const proposalActions = [
    [release.UBIScheme, "upgradeTo(address)", ethers.utils.defaultAbiCoder.encode(["address"], [ubiImpl.address]), "0"], //upgrade ubi
    [
      release.Identity,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [identityImpl.address]),
      "0"
    ], //upgrade identity
    [
      release.MpbBridge,
      "upgradeToAndCall(address,bytes)",
      ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bridgeImpl, upgradeCall]),
      "0"
    ], //upgrade bridge
    [
      release.MpbBridge,
      "setConfig(uint16,uint16,uint256,bytes)",
      ethers.utils.defaultAbiCoder.encode(
        ["uint16", "uint16", "uint256", "bytes"],
        [0, 365, 5, "0x000000000000000000000000000000000000000000000000000000000000000f"]
      ),
      "0"
    ] //fix xdc bridge setting of outbound blocks confirmations
  ];

  console.log({
    networkEnv,
    guardian: guardian.address,
    isSimulation,
    isProduction,
    release
  });

  const proposalContracts = proposalActions.map(a => a[0]);
  const proposalFunctionSignatures = proposalActions.map(a => a[1]);
  const proposalFunctionInputs = proposalActions.map(a => a[2]);
  const proposalEthValues = proposalActions.map(a => a[3]);
  if (isProduction && !checksOnly) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "fuse"
    );
  } else if (!checksOnly) {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv
    );
  }

  if (isSimulation || !isProduction) {
    const ctrl = (await ethers.getContractAt("Controller", release.Controller)) as Controller;
    const isMinterScheme = await ctrl.getSchemePermissions(release.MpbBridge, release.Avatar);
    console.log("Bridge minter permissions on avatar:", isMinterScheme);
    // check xdc chainid in bridge
    const mpb = (await ethers.getContractAt("IMessagePassingBridge", release.MpbBridge)) as IMessagePassingBridge;
    console.log("xdc lz chainid:", await mpb.toLzChainId(50));
    const ubi = (await ethers.getContractAt("UBISchemeV2", release.UBIScheme)) as UBISchemeV2;
    const claimer = await ethers.getImpersonatedSigner("0xA48840D89a761502A4a7d995c74f3864D651A87F");
    const identity = (await ethers.getContractAt("IdentityV3", release.Identity)) as IdentityV3;
    const tx = await (await identity.connect(claimer).connectAccount(guardian.address)).wait();
    console.log("Identity connect account tx:", tx);
    const claimTx = await (await ubi.connect(guardian).claim()).wait();
    console.log("UBI claim from connected account tx:", claimTx.events);
  }
};

export const upgradeEthStep1 = async (network, checksOnly) => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  if (isProduction) verifyProductionSigner(root);

  let networkEnv = networkName;
  let guardian = root;
  if (isSimulation) {
    networkEnv = network;
  }

  let release: { [key: string]: any } = dao[networkEnv];

  console.log("signer:", root.address, { networkEnv, isSimulation, isProduction, release });

  if (isSimulation) {
    networkEnv = network;
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({
      value: ethers.utils.parseEther("1"),
      to: release.GuardiansSafe
    });
  }

  const bridgeImpl = bridgeUpgradeImpl[networkEnv];
  const upgradeCall = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("upgrade()")).substring(0, 10);

  const proposalActions = [
    [
      release.MpbBridge,
      "upgradeToAndCall(address,bytes)",
      ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bridgeImpl, upgradeCall]),
      "0"
    ] //upgrade bridge
  ];

  console.log({
    networkEnv,
    guardian: guardian.address,
    isSimulation,
    isProduction,
    release
  });

  const proposalContracts = proposalActions.map(a => a[0]);
  const proposalFunctionSignatures = proposalActions.map(a => a[1]);
  const proposalFunctionInputs = proposalActions.map(a => a[2]);
  const proposalEthValues = proposalActions.map(a => a[3]);
  if (isProduction && !checksOnly) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "mainnet"
    );
  } else if (!checksOnly) {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv
    );
  }

  if (isSimulation || !isProduction) {
    const ctrl = (await ethers.getContractAt("Controller", release.Controller)) as Controller;
    const isMinterScheme = await ctrl.getSchemePermissions(release.MpbBridge, release.Avatar);
    console.log("Bridge minter permissions on avatar:", isMinterScheme);
    // check xdc chainid in bridge
    const mpb = (await ethers.getContractAt("IMessagePassingBridge", release.MpbBridge)) as IMessagePassingBridge;
    console.log("xdc lz chainid:", await mpb.toLzChainId(50));
  }
};

const calculateReserveParams = async () => {
  const celoProvider = new ethers.providers.JsonRpcProvider("https://forno.celo.org");
  const gd = await ethers.getContractAt("GoodDollar", dao["production-celo"].GoodDollar);
  const celoCusd = (await ethers.getContractAt("IERC20", dao["production-celo"].CUSD)).connect(celoProvider);
  const gdCelo = gd.connect(celoProvider);
  const totalSupplyCelo = await gdCelo.totalSupply();
  const reserveBalance = await celoCusd.balanceOf(dao["production-celo"].MentoReserve);
  const xdcReserveBalance = ethers.utils.parseUnits("200000", 18); //200k in xdc
  const totalUSD = reserveBalance.add(xdcReserveBalance); //reserve + 200k in xdc
  const xdcSupplyShare = xdcReserveBalance.mul(1e8).div(totalUSD);
  const xdcGdSupplyEquivalent = totalSupplyCelo.mul(xdcSupplyShare).div(1e8);
  const price = ethers.utils.parseUnits("0.00013", 8);
  const celoGdSupplyEquivalent = totalSupplyCelo.sub(xdcGdSupplyEquivalent);

  console.log({
    totalSupplyCelo,
    reserveBalance,
    totalUSD,
    xdcSupplyShare,
    xdcGdSupplyEquivalent,
    celoGdSupplyEquivalent
  });

  // uint32 reserveRatio = uint32(
  // 		(cUSDBalance * 1e18 * 1e8) / (price * totalGlobalSupply)
  // 	);
  //calculate reserve ratio
  const reserveRatioXdc = xdcReserveBalance
    .mul(ethers.BigNumber.from("100000000")) //1e8
    .mul(ethers.BigNumber.from("1000000000000000000")) //1e18
    .div(xdcGdSupplyEquivalent.mul(price));
  console.log(
    "recommended reserve ratio for xdc:",
    reserveRatioXdc.toString(),
    reserveRatioXdc.div("10000000000").toNumber() / 1e8
  );

  //calcualte reserve ratio for celo
  const reserveRatioCelo = reserveBalance
    .mul(ethers.BigNumber.from("100000000")) //1e8
    .mul(ethers.BigNumber.from("1000000000000000000")) //1e18
    .div(celoGdSupplyEquivalent.mul(price));

  console.log(
    "recommended reserve ratio for celo:",
    reserveRatioCelo.toString(),
    reserveRatioCelo.div("10000000000").toNumber() / 1e8
  );
};

export const main = async () => {
  // await calculateReserveParams();
  // return;
  prompt.start();
  const { network } = await prompt.get(["network"]);

  console.log("running step:", { network });
  const chain = last(network.split("-")) || "fuse";
  console.log("detected chain:", chain, network);
  switch (chain) {
    case "mainnet":
      await upgradeEthStep1(network, false);

      break;
    case "production":
    case "fuse":
      await upgradeFuseStep1(network, false);

      break;
    case "celo":
      await upgradeCeloStep1(network, false);

      break;
  }
};

main().catch(console.log);
