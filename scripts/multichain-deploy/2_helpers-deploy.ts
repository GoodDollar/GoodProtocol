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
import { AdminWallet, Faucet } from "../../types";

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
  let protocolSettings = defaultsDeep({}, ProtocolSettings[network.name], ProtocolSettings["default"]);

  let release: { [key: string]: any } = dao[network.name];

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
  for (let i = 0; i < protocolSettings.walletAdminsCount; i++) {
    const wallet = ethers.Wallet.fromMnemonic(process.env.ADMIN_WALLET_MNEMONIC, `m/44'/60'/0'/0/${i}`);
    walletAdmins.push(wallet.address);
  }

  console.log("deploying adminwallet", { walletAdmins, gasprice: protocolSettings.gasPrice });
  const AdminWallet = (await deployDeterministic(
    {
      //   address payable[] memory _admins,
      // NameService _ns,
      // address _owner,
      // uint256 _gasPrice
      name: "AdminWallet",
      salt: "AdminWallet",
      isUpgradeable: true
    },
    [walletAdmins, release.NameService, root.address, protocolSettings.gasPrice]
  ).then(printDeploy)) as AdminWallet;

  await AdminWallet.setDefaults(1e6, 9e6, 3, protocolSettings.gasPrice);
  // const AdminWallet = await ethers.getContractAt("AdminWallet", release.AdminWallet);

  const gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);

  const decimals = await gd.decimals();

  const Faucet = (await deployDeterministic({ name: "Faucet", salt: "Faucet", isUpgradeable: true }, [
    release.NameService,
    protocolSettings.gasPrice,
    AdminWallet.address,
    root.address
  ])) as Faucet;

  await Faucet.setGasTopping(1.5e6);
  // const Faucet = await ethers.getContractAt("Faucet", release.Faucet);

  const Invites = await deployDeterministic({ name: "InvitesV2", salt: "InvitesV2", isUpgradeable: true }, [
    release.NameService,
    ethers.utils.parseUnits("100", decimals),
    root.address
  ]);

  // const Invites = await ethers.getContractAt("AdminWallet", release.Invites);

  const torelease = {
    AdminWallet: AdminWallet.address,
    Faucet: Faucet.address,
    Invites: Invites.address
  };
  await releaser(torelease, network.name, "deployment", false);

  const adminWalletOwner = await AdminWallet.hasRole(ethers.constants.HashZero, root.address);
  const faucetOwner = await Faucet.hasRole(ethers.constants.HashZero, root.address);

  console.log("giving AdminWallet identity_admin permissions");
  const identity = await ethers.getContractAt("IdentityV2", release.Identity);
  await identity
    .grantRole(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("identity_admin")), AdminWallet.address)
    .then(printDeploy);

  const walletIsIdentityAdmin = await identity.hasRole(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("identity_admin")),
    AdminWallet.address
  );

  console.log("topping adminwallet and faucet with 1 native token");
  await root
    .sendTransaction({
      to: AdminWallet.address,
      value: ethers.constants.WeiPerEther
    })
    .then(printDeploy);
  await root
    .sendTransaction({
      to: Faucet.address,
      value: ethers.constants.WeiPerEther
    })
    .then(printDeploy);

  if (!network.name.includes("production")) {
    console.log("minting G$s to invites on dev envs");
    await gd.mint(Invites.address, ethers.utils.parseUnits("1000000", decimals)); //1million GD
  }

  console.log({
    walletIsIdentityAdmin,
    adminWalletOwner,
    faucetOwner
  });

  let impl = await getImplementationAddress(ethers.provider, AdminWallet.address);
  await verifyContract(impl, "contracts/utils/AdminWallet.sol:AdminWallet", network.name);
  impl = await getImplementationAddress(ethers.provider, Faucet.address);
  await verifyContract(impl, "contracts/fuseFaucet/Faucet.sol:Faucet", network.name);
  impl = await getImplementationAddress(ethers.provider, Invites.address);
  await verifyContract(impl, "contracts/invites/InvitesV2.sol:InvitesV2", network.name);
};

export const main = async () => {
  await deployHelpers();
};
if (process.argv[1].includes("2_helpers-deploy")) main();
