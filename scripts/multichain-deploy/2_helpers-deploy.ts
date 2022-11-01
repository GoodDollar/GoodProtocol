/***
 * Deploy helper contracts
 * AdminWallet, Faucet, Invites
 */
import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
import { deployDeterministic } from "./helpers";
import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { TransactionResponse } from "@ethersproject/providers";

const { name } = network;

const printDeploy = async (
  c: Contract | TransactionResponse
): Promise<Contract | TransactionResponse> => {
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
  let protocolSettings = defaultsDeep(
    {},
    ProtocolSettings[network.name],
    ProtocolSettings["default"]
  );

  let release: { [key: string]: any } = dao[network.name];

  let [root, ...signers] = await ethers.getSigners();
  //generic call permissions
  let schemeMock = root;

  console.log("got signers:", {
    network,
    root: root.address,
    schemeMock: schemeMock.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then(_ => _.toString())
  });

  const walletAdmins = [];
  for (let i = 0; i < protocolSettings.walletAdminsCount; i++) {
    const wallet = ethers.Wallet.fromMnemonic(
      process.env.ADMIN_WALLET_MNEMONIC,
      `m/44'/60'/0'/0/${i}`
    );
    walletAdmins.push(wallet.address);
  }

  console.log("deploying adminwallet", { walletAdmins });
  const AdminWallet = (await deployDeterministic(
    {
      //   address payable[] memory _admins,
      // address _owner,
      // IIdentityV2 _identity
      name: "AdminWallet",
      salt: "AdminWallet",
      isUpgradeable: true
    },
    [walletAdmins, release.NameService, root.address, protocolSettings.gasPrice]
  ).then(printDeploy)) as Contract;

  console.log("giving AdminWallet identity_admin permissions");
  const identity = await ethers.getContractAt("IdentityV2", release.Identity);
  await identity.grantRole(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("identity_admin")),
    AdminWallet.address
  );

  const Faucet = await deployDeterministic(
    { name: "Faucet", salt: "Faucet", isUpgradeable: true },
    [
      release.NameService,
      protocolSettings.gasPrice,
      AdminWallet.address,
      root.address
    ]
  );

  const Invites = await deployDeterministic(
    { name: "InvitesV2", salt: "InvitesV2", isUpgradeable: true },
    [release.NameService, release.GoodDollar, 10000, root.address]
  );

  const adminWalletOwner = await AdminWallet.hasRole(
    ethers.constants.HashZero,
    root.address
  );
  const faucetOwner = await Faucet.hasRole(
    ethers.constants.HashZero,
    root.address
  );

  console.log("topping adminwallet and faucet with 1 native token");
  await root.sendTransaction({
    to: AdminWallet.address,
    value: ethers.constants.WeiPerEther
  });
  await root.sendTransaction({
    to: Faucet.address,
    value: ethers.constants.WeiPerEther
  });

  if (!network.name.includes("production")) {
    console.log("minting G$s to invites on dev envs");
    const gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);
    await gd.mint(Invites.address, 1e8); //1million GD (2 decimals)
  }

  console.log({
    adminWalletOwner,
    faucetOwner
  });

  release = {
    AdminWallet: AdminWallet.address,
    Faucet: Faucet.address,
    Invites: Invites.address
  };
  await releaser(release, network.name, "deployment", false);
};

export const main = async (networkName = name) => {
  await deployHelpers().catch(console.log);
};
main();
