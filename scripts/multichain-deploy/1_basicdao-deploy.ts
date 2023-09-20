/***
 * to get same addresses as on Celo
 * deploy proxyfactory with 0x271cd5391016eb621aB3f9c0c70F5cF91DFd3FB0 with nonce 2
 * create a gnosissafe with 0x3de7216149f12d8f51540d9a870149560fc11bfb with nonce 3
 * run this script with 0x3de7216149f12d8f51540d9a870149560fc11bfb with nonce 7
 */
import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
// import DAOCreatorABI from "@gooddollar/goodcontracts/build/contracts/DaoCreatorGoodDollar.json";
import DAOCreatorABI from "@gooddollar/goodcontracts/build/contracts/DaoCreatorGoodDollarWithTokens.json";
// import IdentityABI from "@gooddollar/goodcontracts/build/contracts/Identity.json";
import FeeFormulaABI from "@gooddollar/goodcontracts/build/contracts/FeeFormula.json";

import { deployDeterministic, deploySuperGoodDollar, verifyProductionSigner } from "./helpers";
import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { TransactionResponse } from "@ethersproject/providers";

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

export const createDAO = async () => {
  let protocolSettings = defaultsDeep({}, ProtocolSettings[network.name], ProtocolSettings["default"]);

  let release: { [key: string]: any } = dao[network.name];
  const isProduction = network.name.includes("production");

  let [root] = await ethers.getSigners();
  const daoOwner = root.address;
  if (isProduction) verifyProductionSigner(root);

  console.log("got signers:", {
    network,
    daoOwner,
    root: root.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString()),
    release
  });

  const DAOCreatorFactory = new ethers.ContractFactory(DAOCreatorABI.abi, DAOCreatorABI.bytecode, root);

  const FeeFormulaFactory = new ethers.ContractFactory(FeeFormulaABI.abi, FeeFormulaABI.bytecode, root);

  const proxyFactory = await ethers.getContractAt("ProxyFactory1967", release.ProxyFactory);
  const salt = ethers.BigNumber.from(ethers.utils.keccak256(ethers.utils.toUtf8Bytes("NameService")));
  const nameserviceFutureAddress = await proxyFactory["getDeploymentAddress(uint256,address)"](salt, root.address);
  console.log("deploying identity", { nameserviceFutureAddress });
  let Identity;
  if (release.Identity) Identity = await ethers.getContractAt("IdentityV2", release.Identity);
  else
    Identity = (await deployDeterministic(
      {
        name: "IdentityV2",
        salt: "Identity",
        isUpgradeable: true
      },
      [root.address, ethers.constants.AddressZero]
    ).then(printDeploy)) as Contract;

  let daoCreator;
  if (release.DAOCreator) daoCreator = await DAOCreatorFactory.attach(release.DAOCreator);
  else daoCreator = (await DAOCreatorFactory.deploy().then(printDeploy)) as Contract;

  let FeeFormula;
  if (release.FeeFormula) FeeFormula = await FeeFormulaFactory.attach(release.FeeFormula);
  else
    FeeFormula = (await deployDeterministic({ name: "FeeFormula", factory: FeeFormulaFactory }, [0]).then(
      printDeploy
    )) as Contract;

  let GoodDollar;
  if (protocolSettings.superfluidHost) {
    GoodDollar = await deploySuperGoodDollar(protocolSettings.superfluidHost, [
      isProduction ? "GoodDollar" : "GoodDollar Dev",
      "G$",
      0,
      FeeFormula.address,
      Identity.address,
      ethers.constants.AddressZero,
      daoCreator.address
    ]);
  } else {
    GoodDollar = (await deployDeterministic(
      {
        name: "GoodDollar",
        isUpgradeable: true,
        initializer: "initialize(string, string, uint256, address, address, address,address)"
      },
      [
        isProduction ? "GoodDollar" : "GoodDollar Dev",
        "G$",
        0,
        FeeFormula.address,
        Identity.address,
        ethers.constants.AddressZero,
        daoCreator.address
      ]
    ).then(printDeploy)) as Contract;
  }

  const GReputation = (await deployDeterministic(
    {
      name: "GReputation",
      isUpgradeable: true,
      initializer: "initialize(address, string, bytes32, uint256)"
    },
    [
      ethers.constants.AddressZero,
      "fuse",
      protocolSettings.governance.gdaoAirdrop, //should fail on real deploy if not set
      protocolSettings.governance.gdaoTotalSupply //should fail on real deploy if not set
    ]
  ).then(printDeploy)) as Contract;

  // console.log("setting identity auth period");
  // await Identity.setAuthenticationPeriod(365).then(printDeploy);

  console.log("creating dao");
  await daoCreator.forgeOrg(GoodDollar.address, GReputation.address, [], 0, []).then(printDeploy);
  console.log("forgeOrg done ");
  const Avatar = new ethers.Contract(
    await daoCreator.avatar(),
    ["function owner() view returns (address)", "function nativeToken() view returns (address)"],
    root
  );

  console.log("Done deploying DAO, setting schemes permissions");

  let schemes = [daoOwner, Identity.address];

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

  const NameService = await deployDeterministic({ name: "NameService", isUpgradeable: true }, [
    controller,
    ["CONTROLLER", "AVATAR", "IDENTITY", "GOODDOLLAR", "REPUTATION"].map(_ =>
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes(_))
    ),
    [controller, Avatar.address, Identity.address, gd, GReputation.address]
  ]);

  console.log("set GRep nameservice..");
  await (await GReputation.updateDAO(NameService.address)).wait();
  console.log("set Identity nameservice..");

  await Identity.initDAO(NameService.address).then(printDeploy);

  //verifications
  const Controller = await ethers.getContractAt("Controller", controller);

  if (isProduction) {
    console.log("renouncing minting rights on production env");
    await GoodDollar.renounceMinter().then(printDeploy);
  }

  const daoOwnerDaoPermissions = await Controller.getSchemePermissions(daoOwner, Avatar.address);

  const deployerIsNotGDMinter = (await GoodDollar.isMinter(root.address)) === false;

  const avatarIsGDMinter = await GoodDollar.isMinter(Avatar.address);

  const deployerIsNotGDPauser = (await GoodDollar.isPauser(root.address)) === false;

  const deployerIsNotRepMinter = (await GReputation.hasRole(GReputation.MINTER_ROLE(), root.address)) === false;
  const avatarIsRepMinter = await GReputation.hasRole(GReputation.MINTER_ROLE(), Avatar.address);

  const deployerIsIdentityOwner = await Identity.hasRole(ethers.constants.HashZero, root.address);

  const avatarIsIdentityOwner = await Identity.hasRole(ethers.constants.HashZero, Avatar.address);

  //try to modify DAO -> should not succeed
  await (await GReputation.updateDAO(ethers.constants.AddressZero)).wait();

  const grepHasDAOSet = (await GReputation.nameService()) === NameService.address;

  const factoryIsNotGoodOwner = (await GReputation.hasRole(ethers.constants.HashZero, proxyFactory.address)) === false;

  const factoryIsNotGDMinter = (await GoodDollar.isMinter(proxyFactory.address)) === false;

  const factoryIsNotGDPauser = (await GoodDollar.isPauser(root.address)) === false;

  console.log({
    daoOwnerDaoPermissions,
    deployerIsNotGDMinter,
    deployerIsNotRepMinter,
    deployerIsNotGDPauser,
    factoryIsNotGoodOwner,
    factoryIsNotGDMinter,
    factoryIsNotGDPauser,
    avatarIsRepMinter,
    deployerIsIdentityOwner,
    avatarIsIdentityOwner,
    avatarIsGDMinter,
    grepHasDAOSet
  });

  release = {
    // ProxyFactory: "0x99C22e78A579e2176311c736C4c9F0b0D5A47806",
    GoodDollar: gd,
    Avatar: Avatar.address,
    Controller: controller,
    Identity: Identity.address,
    NameService: NameService.address,
    GReputation: GReputation.address,
    FeeFormula: FeeFormula.address,
    DAOCreator: daoCreator.address
  };
  await releaser(release, network.name, "deployment", false);
};

export const main = async () => {
  await createDAO();
};
main();
