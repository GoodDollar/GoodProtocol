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

import {
  deployDeterministic,
  deploySuperGoodDollar,
  verifyProductionSigner,
  verifyContract,
  verifyOnEtherscan
} from "./helpers";
import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { TransactionResponse } from "@ethersproject/providers";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";
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

  let release: { [key: string]: any } = dao[network.name] || {};
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

  console.log("deploying identity");
  let Identity;
  if (release.Identity) Identity = await ethers.getContractAt("IdentityV3", release.Identity);
  else
    Identity = (await deployDeterministic(
      {
        name: "IdentityV3",
        salt: "Identity",
        isUpgradeable: true
      },
      [root.address, ethers.constants.AddressZero]
    ).then(printDeploy)) as Contract;

  let daoCreator;
  if (release.DAOCreator) daoCreator = await DAOCreatorFactory.attach(release.DAOCreator);
  else {
    daoCreator = await deployDeterministic(
      {
        name: "DAOCreator",
        factory: DAOCreatorFactory,
        isUpgradeable: false
      },
      []
    );
    // daoCreator = (await DAOCreatorFactory.deploy().then(printDeploy)) as Contract;
  }

  let FeeFormula;
  if (release.FeeFormula) FeeFormula = await FeeFormulaFactory.attach(release.FeeFormula);
  else
    FeeFormula = (await deployDeterministic({ name: "FeeFormula", factory: FeeFormulaFactory }, [0]).then(
      printDeploy
    )) as Contract;

  let GoodDollar;
  let { superfluidHost, superfluidInflowNFTLogic, superfluidOutflowNFTLogic } = protocolSettings;
  if (protocolSettings.superfluidHost) {
    GoodDollar = await deploySuperGoodDollar(
      {
        superfluidHost,
        superfluidInflowNFTLogic,
        superfluidOutflowNFTLogic
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
    );
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

  // console.log("setting identity auth period");
  // await Identity.setAuthenticationPeriod(365).then(printDeploy);

  const avatar = await daoCreator.avatar();
  let Avatar = new ethers.Contract(
    avatar,
    ["function owner() view returns (address)", "function nativeToken() view returns (address)"],
    root
  );
  if (avatar === ethers.constants.AddressZero) {
    console.log("creating dao");
    await daoCreator.forgeOrg(GoodDollar.address, ethers.constants.AddressZero, [], 0, []).then(printDeploy);
    console.log("forgeOrg done ");
    console.log("Done deploying DAO, setting schemes permissions");

    Avatar = new ethers.Contract(
      await daoCreator.avatar(),
      ["function owner() view returns (address)", "function nativeToken() view returns (address)"],
      root
    );
    let schemes = [daoOwner, Identity.address];

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
  } else {
    console.log("dao already exists, avatar is", avatar);
  }

  const gd = await Avatar.nativeToken();

  const controller = await Avatar.owner();

  const NameService = await deployDeterministic({ name: "NameService", isUpgradeable: true }, [
    controller,
    ["CONTROLLER", "AVATAR", "IDENTITY", "GOODDOLLAR"].map(_ => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(_))),
    [controller, Avatar.address, Identity.address, gd]
  ]);

  console.log("set Identity nameservice..");

  if ((await Identity.nameService()) == ethers.constants.AddressZero) {
    await Identity.initDAO(NameService.address).then(printDeploy);
  }
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

  const deployerIsIdentityOwner = await Identity.hasRole(ethers.constants.HashZero, root.address);

  const avatarIsIdentityOwner = (await Identity.hasRole(ethers.constants.HashZero, Avatar.address)) === true;

  const factoryIsNotGDMinter = (await GoodDollar.isMinter(release.ProxyFactory)) === false;

  const factoryIsNotGDPauser = (await GoodDollar.isPauser(root.address)) === false;
  const identityNameService = (await Identity.nameService()) === NameService.address;
  console.log({
    daoOwnerDaoPermissions,
    deployerIsNotGDMinter,
    deployerIsNotGDPauser,
    factoryIsNotGDMinter,
    factoryIsNotGDPauser,
    deployerIsIdentityOwner,
    avatarIsIdentityOwner,
    avatarIsGDMinter,
    identityNameService
  });

  release = {
    // ProxyFactory: "0x99C22e78A579e2176311c736C4c9F0b0D5A47806",
    GoodDollar: gd,
    Avatar: Avatar.address,
    Controller: controller,
    Identity: Identity.address,
    NameService: NameService.address,
    FeeFormula: FeeFormula.address,
    DAOCreator: daoCreator.address
  };
  await releaser(release, network.name, "deployment", false);

  await verifyOnEtherscan(
    network.config.chainId,
    "scripts/multichain-deploy/flattened/Avatar.sol",
    "Avatar",
    Avatar.address,
    "v0.5.16+commit.9c3226ce",
    {
      types: ["string", "address", "address"],
      values: ["GoodDollar", GoodDollar.address, ethers.constants.AddressZero]
    }
  );
  await verifyOnEtherscan(
    network.config.chainId,
    "scripts/multichain-deploy/flattened/Controller.sol",
    "Controller",
    Controller.address,
    "v0.5.16+commit.9c3226ce",
    {
      types: ["address"],
      values: [Avatar.address]
    }
  );
  await verifyOnEtherscan(
    network.config.chainId,
    "scripts/multichain-deploy/flattened/FeeFormula.sol",
    "FeeFormula",
    FeeFormula.address,
    "v0.5.16+commit.9c3226ce",
    {
      types: ["uint256"],
      values: [0]
    }
  );

  let impl = await getImplementationAddress(ethers.provider, Identity.address);
  await verifyContract(impl, "contracts/identity/IdentityV3.sol:IdentityV3", network.name);
  impl = await getImplementationAddress(ethers.provider, NameService.address);
  await verifyContract(impl, "contracts/utils/NameService.sol:NameService", network.name);
  if (protocolSettings.superfluidHost) {
    impl = await getImplementationAddress(ethers.provider, GoodDollar.address);
    await verifyContract(GoodDollar.address, "contracts/token/superfluid/UUPSProxy.sol:UUPSProxy", network.name);
    await verifyContract(impl, "contracts/token/superfluid/SuperGoodDollar.sol:SuperGoodDollar", network.name);
  } else {
    impl = await getImplementationAddress(ethers.provider, GoodDollar.address);
    await verifyContract(impl, "contracts/token/GoodDollar.sol:GoodDollar", network.name);
  }
};

export const main = async () => {
  await createDAO();
};
main();
