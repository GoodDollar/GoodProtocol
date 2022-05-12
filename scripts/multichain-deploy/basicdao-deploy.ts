import { network, ethers, upgrades, run } from "hardhat";
import { networkNames } from "@openzeppelin/upgrades-core";
import { isFunction, get, omitBy } from "lodash";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import pressAnyKey from "press-any-key";
import { Contract } from "ethers";
import { range } from "lodash";
// import DAOCreatorABI from "@gooddollar/goodcontracts/build/contracts/DaoCreatorGoodDollar.json";
import DAOCreatorABI from "../../../GoodBootstrap/packages/contracts/build/contracts/DaoCreatorGoodDollarWithRep.json";
// import IdentityABI from "@gooddollar/goodcontracts/build/contracts/Identity.json";
import IdentityABI from "../../../GoodBootstrap/packages/contracts/build/contracts/IdentityWithOwner.json";
import FeeFormulaABI from "@gooddollar/goodcontracts/build/contracts/FeeFormula.json";
// import AddFoundersABI from "@gooddollar/goodcontracts/build/contracts/AddFoundersGoodDollar.json";
import AddFoundersABI from "../../../GoodBootstrap/packages/contracts/build/contracts/AddFoundersGoodDollarWithRep.json";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import FirstClaimPool from "@gooddollar/goodcontracts/stakingModel/build/contracts/FirstClaimPool.json";
import BridgeMock from "@gooddollar/goodcontracts/stakingModel/build/contracts/BridgeMock.json";
import AdminWalletABI from "@gooddollar/goodcontracts/build/contracts/AdminWallet.json";
import OTPABI from "@gooddollar/goodcontracts/build/contracts/OneTimePayments.json";
import HomeBridgeABI from "@gooddollar/goodcontracts/build/contracts/DeployHomeBridge.json";
import ForeignBridgeABI from "@gooddollar/goodcontracts/build/contracts/DeployForeignBridge.json";

import { deployDeterministic } from "./helpers";
import releaser from "../../scripts/releaser";
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

export const createDAO = async () => {
  const fusedao = dao[network.name.split("-")[0]];
  const protocolSettings = ProtocolSettings["production"];
  let release: { [key: string]: any } = {};

  let [root, ...signers] = await ethers.getSigners();
  //generic call permissions
  let schemeMock = root;
  const isMainnet = network.name.includes("main");

  console.log("got signers:", {
    network,
    root: root.address,
    schemeMock: schemeMock.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then(_ => _.toString())
  });

  const DAOCreatorFactory = new ethers.ContractFactory(
    DAOCreatorABI.abi,
    DAOCreatorABI.bytecode,
    root
  );

  const IdentityFactory = new ethers.ContractFactory(
    IdentityABI.abi,
    IdentityABI.bytecode,
    root
  );
  const FeeFormulaFactory = new ethers.ContractFactory(
    FeeFormulaABI.abi,
    FeeFormulaABI.bytecode,
    root
  );
  const AddFoundersFactory = new ethers.ContractFactory(
    AddFoundersABI.abi,
    AddFoundersABI.bytecode,
    root
  );

  const AddFounders = (await AddFoundersFactory.deploy().then(
    printDeploy
  )) as Contract;
  // const AddFounders = await ethers.getContractAt(
  //   AddFoundersABI.abi,
  //   "0x6F1BAbfF5E119d61F0c6d8653d84E8B284B87091"
  // );

  const Identity = (await deployDeterministic(
    {
      name: "Identity",
      factory: IdentityFactory
    },
    [root.address]
  ).then(printDeploy)) as Contract;

  // const Identity = await ethers.getContractAt(
  //   IdentityABI.abi,
  //   release.Identity
  // );

  const daoCreator = await DAOCreatorFactory.deploy(AddFounders.address);

  const FeeFormula = (await deployDeterministic(
    { name: "FeeFormula", factory: FeeFormulaFactory },
    [0]
  ).then(printDeploy)) as Contract;

  const GReputation = (await deployDeterministic(
    {
      name: "GReputation",
      isUpgradable: true,
      initializer: "initialize(address, string, bytes32, uint256)"
    },
    [
      ethers.constants.AddressZero,
      "fuse",
      protocolSettings.governance.gdaoAirdrop, //should fail on real deploy if not set
      protocolSettings.governance.gdaoTotalSupply //should fail on real deploy if not set
    ]
  ).then(printDeploy)) as Contract;

  console.log("setting identity auth period");
  await Identity.setAuthenticationPeriod(365).then(printDeploy);

  console.log("creating dao");
  await daoCreator
    .forgeOrg(
      "GoodDollar",
      "G$",
      0,
      FeeFormula.address,
      Identity.address,
      GReputation.address,
      [],
      0,
      []
    )
    .then(printDeploy);
  console.log("forgeOrg done ");
  const Avatar = new ethers.Contract(
    await daoCreator.avatar(),
    [
      "function owner() view returns (address)",
      "function nativeToken() view returns (address)"
    ],
    root
  );

  // const Avatar = new ethers.Contract(
  //   release.Avatar,
  //   [
  //     "function owner() view returns (address)",
  //     "function nativeToken() view returns (address)"
  //   ],
  //   root
  // );

  await Identity.setAvatar(Avatar.address).then(printDeploy);

  console.log("Done deploying DAO, setting schemes permissions");

  let schemes = [process.env.DAO_OWNER, Identity.address];

  const gd = await Avatar.nativeToken();

  const controller = await Avatar.owner();

  console.log("setting schemes", schemes);

  await daoCreator
    .setSchemes(
      Avatar.address,
      schemes,
      schemes.map(_ => ethers.constants.HashZero),
      ["0x0000001f", "0x00000001"],
      ""
    )
    .then(printDeploy);

  const NameService = await deployDeterministic(
    { name: "NameService", isUpgradable: true },
    [
      controller,
      ["CONTROLLER", "AVATAR", "IDENTITY", "GOODDOLLAR"].map(_ =>
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes(_))
      ),
      [controller, Avatar.address, Identity.address, gd]
    ]
  );

  await (await GReputation.updateDAO(NameService.address)).wait();
  console.log("GRep nameservice:");
  //verifications
  const Controller = await ethers.getContractAt("Controller", controller);
  const GoodDollar = await ethers.getContractAt("IGoodDollar", gd);

  await GoodDollar.renounceMinter().then(printDeploy);
  await Identity.transferOwnership(process.env.DAO_OWNER).then(printDeploy);

  const daoOwnerDaoPermissions = await Controller.getSchemePermissions(
    process.env.DAO_OWNER,
    Avatar.address
  );

  const deployerIsNotGDMinter =
    (await GoodDollar.isMinter(root.address)) === false;
  const avatarIsGDMinter = await GoodDollar.isMinter(Avatar.address);

  const deployerIsNotRepMinter =
    (await GReputation.hasRole(GReputation.MINTER_ROLE(), root.address)) ===
    false;
  const avatarIsRepMinter = await GReputation.hasRole(
    GReputation.MINTER_ROLE(),
    Avatar.address
  );
  const daoOwnerIsIdentityOwner =
    process.env.DAO_OWNER === (await Identity.owner());

  //try to modify DAO -> should not succeed
  await (await GReputation.updateDAO(ethers.constants.AddressZero)).wait();

  const grepHasDAOSet =
    (await GReputation.nameService()) === NameService.address;

  console.log({
    daoOwnerDaoPermissions,
    deployerIsNotGDMinter,
    deployerIsNotRepMinter,
    avatarIsRepMinter,
    daoOwnerIsIdentityOwner,
    avatarIsGDMinter,
    grepHasDAOSet
  });

  release = {
    ProxyFactory: "0x99C22e78A579e2176311c736C4c9F0b0D5A47806",
    GoodDollar: gd,
    Avatar: Avatar.address,
    Controller: controller,
    Identity: Identity.address,
    NameService: NameService.address,
    GReputation: GReputation.address
  };
  await releaser(release, network.name, "deployment", false);
};

export const main = async (networkName = name) => {
  await createDAO().catch(console.log);
};
main();
