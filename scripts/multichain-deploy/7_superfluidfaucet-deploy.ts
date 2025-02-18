/***
 * Deploy helper contracts
 * AdminWallet, Faucet, Invites
 */
import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import { deployDeterministic, verifyProductionSigner, verifyContract } from "./helpers";
import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { TransactionResponse } from "@ethersproject/providers";
import { SuperfluidFaucet } from "../../types";

const { name } = network;

const printDeploy = async (c: Contract | TransactionResponse): Promise<Contract | TransactionResponse> => {
  if (c instanceof Contract) {
    await c.deployed();
    console.log("deployed to: ", c.address);
  }
  if (c.wait) {
    await c.wait();
    console.log("tx done:", c.hash);
  }
  return c;
};

export const deployHelpers = async () => {
  let release: { [key: string]: any } = dao[network.name] || {};

  let [root] = await ethers.getSigners();
  const isProduction = network.name.includes("production");

  if (isProduction) verifyProductionSigner(root);

  //generic call permissions
  let schemeMock = root;

  console.log("got signers:", {
    network,
    root: root.address,
    schemeMock: schemeMock.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  const walletAdmins = [];
  for (let i = 0; i < 10; i++) {
    const wallet = ethers.Wallet.fromMnemonic(process.env.ADMIN_WALLET_MNEMONIC, `m/44'/60'/0'/0/${i}`);
    walletAdmins.push(wallet.address);
  }

  const gasprice = 1e8;
  console.log("deploying adminwallet", { walletAdmins });
  const AdminWallet = release.AdminWallet
    ? await ethers.getContractAt("AdminWallet", release.AdminWallet)
    : ((await deployDeterministic(
        {
          //   address payable[] memory _admins,
          // NameService _ns,
          // address _owner,
          // uint256 _gasPrice
          name: "AdminWallet",
          salt: "AdminWallet",
          isUpgradeable: true
        },
        [walletAdmins, ethers.constants.AddressZero, root.address, gasprice]
      ).then(printDeploy)) as Contract);

  const Faucet = release.SuperfluidFaucet
    ? await ethers.getContractAt("SuperfluidFaucet", release.SuperfluidFaucet)
    : ((await upgrades
        .deployProxy(
          await ethers.getContractFactory("SuperfluidFaucet"),
          [ethers.utils.parseEther("0.0000035"), 30, AdminWallet.address],
          { kind: "uups" }
        )
        .then(printDeploy)) as Contract);

  const torelease = {
    SuperfluidFaucet: Faucet.address,
    AdminWallet: AdminWallet.address
  };
  await releaser(torelease, network.name, "deployment", false);

  let impl = await getImplementationAddress(ethers.provider, AdminWallet.address);
  await verifyContract(impl, "contracts/utils/AdminWallet.sol:AdminWallet", network.name);
  impl = await getImplementationAddress(ethers.provider, Faucet.address);
  await verifyContract(impl, "contracts/fuseFaucet/SuperfluidFaucet.sol:SuperfluidFaucet", network.name);
};

const upgrade = async () => {
  let [root] = await ethers.getSigners();
  const isProduction = network.name.includes("production");

  if (isProduction) verifyProductionSigner(root);

  //generic call permissions
  let schemeMock = root;

  console.log("got signers:", {
    network,
    root: root.address,
    schemeMock: schemeMock.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });
  let release: { [key: string]: any } = dao[network.name] || {};
  const proxy = (await ethers.getContractAt("SuperfluidFaucet", release.SuperfluidFaucet)) as SuperfluidFaucet;
  const impl = await ethers.deployContract("SuperfluidFaucet");
  console.log("impl:", impl.address);
  const callData = proxy.interface.encodeFunctionData("updateSettings", [ethers.utils.parseEther("0.0000035"), 30]);
  const tx = await proxy.upgradeToAndCall(impl.address, callData);
  console.log(tx.hash);
  const res = await tx.wait();
  console.log(res.transactionHash);
};
export const main = async () => {
  // await upgrade();
  await deployHelpers();
};
if (process.argv[1].includes("7_superfluidfaucet")) main();
