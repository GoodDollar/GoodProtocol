/**
 * Step 1:
 * - upgrade Identity on Fuse to support whitelisting with chainid
 *
 * Step 2:
 * - deploy 2_helpers on Celo
 * - add 1000 celo to adminwallet and faucet
 * - monitor adminwallet + faucet on defender
 *
 * Step 3: (once guardians sign Identity upgrade)
 * - upgrade AdminWallet+Invites+Faucet on Fuse to support whitelisting chainid
 * - upgrade backend server to support whitelisting with chainid
 *
 * Step 4:
 * 0. deploy 3_gdStaking, deploy 4_ubi
 * 1. guardians vote send X% to celo ubi pool
 * 2. guardians vote on celo set new GOOD distribution for gdstaking + claiming ubi
 * 3. guardians vote on fuse set new GOOD distribution for gdstaking + claiming ubi
 *
 * NOTICE: decide if to remove "upgrade" method from gdStaking before deploying it. based on GOOD distribution decision
 */

import { network, ethers, upgrades } from "hardhat";
import { defaultsDeep } from "lodash";
import prompt from "prompt";

import {
  executeViaGuardian,
  executeViaSafe,
  verifyProductionSigner,
  verifyContract
} from "../multichain-deploy/helpers";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { upgrade as identityUpgrade } from "./identity-upgrade";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployHelpers } from "../multichain-deploy/2_helpers-deploy";

const { name: networkName } = network;
const isProduction = networkName.includes("production");

let settings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

const step1 = async () => {
  await identityUpgrade();
};

const step2 = async () => {
  await deployHelpers();
};

const step3 = async () => {
  let release: { [key: string]: any } = dao[networkName];
  let [root] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  const adminimpl = await (await ethers.getContractFactory("AdminWalletFuse")).deploy();
  const curadmin = adminimpl.attach(release.AdminWallet);
  console.log("deployed admin impl", adminimpl.address);
  const encodedAdmin = adminimpl.interface.encodeFunctionData("upgrade", [release.NameService]);
  const upgradetx = await (await curadmin.upgradeToAndCall(adminimpl.address, encodedAdmin)).wait();
  const impl = adminimpl.address;
  console.log("AdminWallet upgraded", { impl, txhash: upgradetx.transactionHash });
  await verifyContract(impl, "AdminWalletFuse", networkName);

  const faucetimpl = await (await ethers.getContractFactory("FuseFaucetV2")).deploy();
  const proxyAdmin = await ethers.getContractAt("ProxyAdmin", release.ProxyAdmin);
  const encoded = faucetimpl.interface.encodeFunctionData("upgrade", [
    release.AdminWallet,
    root.address,
    release.NameService
  ]);
  const faucettx = await (await proxyAdmin.upgradeAndCall(release.FuseFaucet, faucetimpl.address, encoded)).wait();
  console.log("Faucet upgraded", faucettx.transactionHash);
  await verifyContract(faucetimpl.address, "FuseFaucetV2", networkName);

  const invitesimpl = await (await ethers.getContractFactory("InvitesFuseV2")).deploy();
  const invitestx = await (await proxyAdmin.upgrade(release.Invites, invitesimpl.address)).wait();
  console.log("Invites upgraded", invitestx.transactionHash);
  await verifyContract(invitesimpl.address, "InvitesFuseV2", networkName);

  console.log("upgrade backend contracts abi + call whitelist with chainid....");
};

const step4 = async () => {
  //   let [root, ...signers] = await ethers.getSigners();

  const isSafeSimulation = process.env.SAFE_SIMULATION === "true";
  const celoSigner = ethers.Wallet.fromMnemonic(process.env.MNEMONIC)
    .connect(ethers.provider)
    .connect(new ethers.providers.JsonRpcProvider("https://forno.celo.org"));
  const fuseSigner = ethers.Wallet.fromMnemonic(process.env.MNEMONIC)
    .connect(ethers.provider)
    .connect(new ethers.providers.JsonRpcProvider("https://rpc.fuse.io"));
  let networkEnv = networkName.split("-")[0];
  if (networkEnv === "fuse") networkEnv = "development";

  const celoNetwork = networkEnv + "-celo";
  const mainnetNetwork = "production-mainnet"; //simulate production on localhost requires running hardhat node in fork mode

  console.log("updating dao on networks:", { isSafeSimulation, celoNetwork, mainnetNetwork, networkName });
  let release: { [key: string]: any } = dao[networkName];

  const mainnetDeploy: [any, any, any, any] = [
    [dao[mainnetNetwork].DistributionHelper],
    [0],
    ["addOrUpdateRecipient((uint32,uint32,address,uint8))"],
    [
      ethers.utils.defaultAbiCoder.encode(
        ["uint32", "uint32", "address", "uint8"],
        [1000, 42220, dao[celoNetwork].UBIScheme, 1]
      )
    ]
  ];
  const fuseDeploy: [any, any, any, any] = [
    [release.ClaimersDistribution, release.GovernanceStakingV2 || release.GovernanceStaking],
    [0, 0],
    ["setMonthlyReputationDistribution(uint256)", "setMonthlyRewards(uint256)"],
    [
      ethers.utils.defaultAbiCoder.encode(["uint256"], [settings.governance.claimersGOODMonthly]),
      ethers.utils.defaultAbiCoder.encode(["uint256"], [settings.governance.stakersGOODMonthly])
    ]
  ];
  const celoDeploy: [any, any, any, any] = [
    [dao[celoNetwork].ClaimersDistribution, dao[celoNetwork].GoodDollarStaking],
    [0, 0],
    ["setMonthlyReputationDistribution(uint256)", "setMonthlyGOODRewards(uint256)"],
    [
      ethers.utils.defaultAbiCoder.encode(["uint256"], [ProtocolSettings[celoNetwork].governance.claimersGOODMonthly]),
      ethers.utils.defaultAbiCoder.encode(["uint256"], [ProtocolSettings[celoNetwork].governance.stakersGOODMonthly])
    ]
  ];
  if (isProduction || isSafeSimulation) {
    console.log("executing dao updates on mainnet via guardianssafe...", { isProduction, isSafeSimulation });
    await executeViaSafe(
      ...mainnetDeploy,
      isSafeSimulation ? "0xF0652a820dd39EC956659E0018Da022132f2f40a" : dao[mainnetNetwork].GuardiansSafe,
      "mainnet",
      isSafeSimulation
    );
    console.log("executing dao updates on fuse via guardianssafe...", dao[networkName].GuardiansSafe);
    await executeViaSafe(...fuseDeploy, dao[networkName].GuardiansSafe, "fuse", isSafeSimulation);
    console.log("executing dao updates on celo via guardianssafe...", dao[celoNetwork].GuardiansSafe);
    await executeViaSafe(...celoDeploy, dao[celoNetwork].GuardiansSafe, "celo", isSafeSimulation);
  } else {
    const forkProvider = new ethers.providers.JsonRpcProvider("http://localhost:8545");
    const ethSigner = await SignerWithAddress.create(
      forkProvider.getSigner("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
    );
    await forkProvider.send("hardhat_impersonateAccount", [dao[mainnetNetwork].GuardiansSafe]);
    const guardiansSigner = await SignerWithAddress.create(forkProvider.getSigner(dao[mainnetNetwork].GuardiansSafe));
    await ethSigner.sendTransaction({ value: ethers.constants.WeiPerEther, to: guardiansSigner.address });

    console.log("executing dao updates on mainnet...");
    await executeViaGuardian(...mainnetDeploy, guardiansSigner, "production-mainnet"); //simulate production on localhost requires running hardhat node in fork mode
    console.log("executing dao updates on fuse...");
    await executeViaGuardian(...fuseDeploy, fuseSigner, networkName);
    console.log("executing dao updates on celo...");
    await executeViaGuardian(...celoDeploy, celoSigner, celoNetwork);
  }
};

const main = async () => {
  prompt.start();
  const { stepNumber } = await prompt.get(["stepNumber"]);

  console.log("running step:", { stepNumber });
  switch (stepNumber) {
    case "1":
      await step1();
      break;
    case "2":
      await step2();
      break;
    case "3":
      await step3();
      break;
    case "4":
      await step4();
      break;
  }
};
main().catch(e => console.error(e));
