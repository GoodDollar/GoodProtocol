/**
 * deploy GoodDollar complete protocol from scratch
 */

import { network, ethers, upgrades } from "hardhat";
import { Contract } from "ethers";
import { range } from "lodash";
import DAOCreatorABI from "@gooddollar/goodcontracts/build/contracts/DaoCreatorGoodDollar.json";
import IdentityABI from "@gooddollar/goodcontracts/build/contracts/Identity.json";
import FeeFormulaABI from "@gooddollar/goodcontracts/build/contracts/FeeFormula.json";
import AddFoundersABI from "@gooddollar/goodcontracts/build/contracts/AddFoundersGoodDollar.json";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import FirstClaimPool from "@gooddollar/goodcontracts/stakingModel/build/contracts/FirstClaimPool.json";
import BridgeMock from "@gooddollar/goodcontracts/stakingModel/build/contracts/BridgeMock.json";
import AdminWalletABI from "@gooddollar/goodcontracts/build/contracts/AdminWallet.json";
import OTPABI from "@gooddollar/goodcontracts/build/contracts/OneTimePayments.json";
import HomeBridgeABI from "@gooddollar/goodcontracts/build/contracts/DeployHomeBridge.json";
import ForeignBridgeABI from "@gooddollar/goodcontracts/build/contracts/DeployForeignBridge.json";

import releaser from "../scripts/releaser";
import ProtocolSettings from "../releases/deploy-settings.json";
import dao from "../releases/deployment.json";
import { main as deployV2 } from "./upgradeToV2/upgradeToV2";
import { TransactionResponse } from "@ethersproject/providers";
import pressAnyKey from "press-any-key";

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
  let release: { [key: string]: any } = {};
  // let release: { [key: string]: any } = dao[network.name];

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

  const BancorFormula = (await (
    await ethers.getContractFactory("BancorFormula")
  )
    .deploy()
    .then(printDeploy)) as Contract;

  const AddFounders = (await AddFoundersFactory.deploy().then(
    printDeploy
  )) as Contract;
  // const AddFounders = await ethers.getContractAt(
  //   AddFoundersABI.abi,
  //   "0x6F1BAbfF5E119d61F0c6d8653d84E8B284B87091"
  // );

  const Identity = (await IdentityFactory.deploy().then(
    printDeploy
  )) as Contract;
  // const Identity = await ethers.getContractAt(
  //   IdentityABI.abi,
  //   release.Identity
  // );

  const daoCreator = (await DAOCreatorFactory.deploy(AddFounders.address).then(
    printDeploy
  )) as Contract;

  const FeeFormula = (await FeeFormulaFactory.deploy(0).then(
    printDeploy
  )) as Contract;

  await Identity.setAuthenticationPeriod(365).then(printDeploy);
  console.log("setAuthPeriod");
  await daoCreator
    .forgeOrg(
      "GoodDollar",
      "G$",
      0,
      FeeFormula.address,
      Identity.address,
      [root.address, signers[0].address, signers[1].address],
      1000,
      [100000, 100000, 100000]
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

  let schemes = [schemeMock.address, Identity.address];

  const gd = await Avatar.nativeToken();

  const controller = await Avatar.owner();

  console.log("setting schemes", schemes);

  await daoCreator
    .setSchemes(
      Avatar.address,
      schemes,
      schemes.map(_ => ethers.constants.HashZero),
      ["0x0000001F", "0x00000001"],
      ""
    )
    .then(printDeploy);

  let { setSchemes, genericCall, addWhitelisted } = await getHelperFunctions(
    Identity,
    Avatar,
    schemeMock
  );

  let mainnet: { [key: string]: Contract } = {};
  release = {
    ...release,
    Avatar: Avatar.address,
    Controller: controller,
    GoodDollar: gd,
    Identity: Identity.address,
    FeeFormula: FeeFormula.address
  };

  if (isMainnet) {
    mainnet = await deployMainnet(Avatar, Identity);
    Object.entries(mainnet).forEach(([k, v]) => (release[k] = v.address));
  }

  let sidechain: { [key: string]: any } = {};

  if (false === isMainnet) {
    sidechain = await deploySidechain(
      setSchemes,
      genericCall,
      Avatar.address,
      Identity.address,
      gd
    );
    schemes.push(sidechain.OneTimePayments.address);
    const adminWallet = await deployAdminWallet(Identity.address);
    Object.entries(sidechain).forEach(([k, v]) => (release[k] = v.address));
    release["AdminWallet"] = adminWallet.address;
  }

  await releaser(release, network.name);

  const bridgeRelease = await deployBridge(Avatar, gd, setSchemes, isMainnet);
  release = { ...release, ...bridgeRelease };
  await releaser(release, network.name);

  await pressAnyKey();
  // deploy v2 mainnet/sidechain contracts, returns their addresses
  const v2 = await deployV2(network.name, false, {
    FirstClaimPool: release.FirstClaimPool,
    BancorFormula: release.BancorFormula,
    Avatar: release.Avatar,
    Controller: release.Controller,
    DAIUsdOracle: ethers.constants.AddressZero,
    COMPUsdOracle: ethers.constants.AddressZero,
    USDCUsdOracle: ethers.constants.AddressZero,
    AAVEUsdOracle: ethers.constants.AddressZero,
    AaveLendingPool: ethers.constants.AddressZero,
    AaveIncentiveController: ethers.constants.AddressZero,
    GasPriceOracle: ethers.constants.AddressZero,
    cDAI: release.cDAI || ethers.constants.AddressZero,
    DAI: release.DAI || ethers.constants.AddressZero,
    COMP: release.COMP || ethers.constants.AddressZero,
    USDC: ethers.constants.AddressZero,
    Identity: release.Identity,
    GoodDollar: release.GoodDollar,
    Contribution: release.Contribution,
    UniswapRouter: "0x0000000000000000000000000000000000000001",
    HomeBridge: release.HomeBridge,
    ForeignBridge: release.ForeignBridge,
    SchemeRegistrar: ethers.constants.AddressZero,
    UpgradeScheme: ethers.constants.AddressZero
  });
  release = { ...v2, ...release };
  await releaser(release, network.name);
  await pressAnyKey();
  if (isMainnet) {
    await setSchemes([release.ProtocolUpgrade]);
    await performUpgrade(release, fusedao.UBIScheme);

    console.log("setting reserve token");
    const MarketMaker = await ethers.getContractFactory("GoodMarketMaker");
    let encoded = MarketMaker.interface.encodeFunctionData("initializeToken", [
      release.cDAI,
      "100",
      "10000",
      "1000000"
    ]);

    await genericCall(release.GoodMarketMaker, encoded);
  }

  if (false === isMainnet) {
    let encoded = (
      await ethers.getContractAt("IGoodDollar", release.GoodDollar)
    ).interface.encodeFunctionData("mint", [release.UBIScheme, 1000000]);

    await genericCall(release.GoodDollar, encoded);

    await setSchemes([release.ProtocolUpgradeFuse]);
    await performUpgradeFuse(release);
  }

  await releaser(release, network.name);
};

const deployBridge = async (Avatar, gd, setSchemes, isMainnet) => {
  const GoodDollar = await ethers.getContractAt("IGoodDollar", gd);
  const [root] = await ethers.getSigners();
  const BridgeABI = isMainnet ? ForeignBridgeABI : HomeBridgeABI;
  const bridgeFactory = new ethers.ContractFactory(
    BridgeABI.abi,
    BridgeABI.bytecode,
    root
  );
  let BridgeFactoryContract = isMainnet
    ? "0xABBf5D8599B2Eb7b4e1D25a1Fd737FF1987655aD"
    : "0xb895638fb3870AD5832402a5BcAa64A044687db0"; //Fuse test bridge addresses

  const isAlreadyMinter = await GoodDollar.isMinter(BridgeFactoryContract);
  console.log("deploying bridge scheme:", {
    BridgeFactoryContract,
    isMainnet,
    isAlreadyMinter
  });
  const scheme = (await bridgeFactory
    .deploy(Avatar.address, BridgeFactoryContract)
    .then(printDeploy)) as Contract;
  await setSchemes([scheme.address]);

  if (network.name.includes("develop")) {
    const mockBridge = (await new ethers.ContractFactory(
      BridgeMock.abi,
      BridgeMock.bytecode,
      root
    )
      .deploy()
      .then(printDeploy)) as Contract;
    console.log("deployed mock bridge for develop mode:", mockBridge.address);
    return isMainnet
      ? { ForeignBridge: mockBridge.address }
      : { HomeBridge: mockBridge.address };
  }

  let tx = await (
    await (isMainnet
      ? scheme.setBridge()
      : scheme.setBridge(isAlreadyMinter === false))
  ).wait();
  const bridgeEvent = tx.events.find(_ => _.event?.includes("Bridge"));
  console.log("deployed bridge:", bridgeEvent);
  console.log(tx.events, tx);
  return isMainnet
    ? { ForeignBridge: bridgeEvent.args._foreignBridge }
    : { HomeBridge: bridgeEvent.args._homeBridge };
};

const deployMainnet = async (Avatar, Identity) => {
  const [root] = await ethers.getSigners();

  const cdaiFactory = await ethers.getContractFactory("cDAIMock");
  const daiFactory = await ethers.getContractFactory("DAIMock");

  const daiAddr = ProtocolSettings[network.name]?.compound?.dai;
  const cdaiAddr = ProtocolSettings[network.name]?.compound?.cdai;
  const COMPAddr = ProtocolSettings[network.name]?.compound?.comp;

  let DAI = daiAddr
    ? await ethers.getContractAt("DAIMock", daiAddr)
    : ((await daiFactory.deploy().then(printDeploy)) as Contract);

  let COMP = COMPAddr
    ? await ethers.getContractAt("DAIMock", COMPAddr)
    : ((await daiFactory.deploy().then(printDeploy)) as Contract);

  let cDAI = cdaiAddr
    ? await ethers.getContractAt("DAIMock", cdaiAddr)
    : ((await cdaiFactory.deploy(DAI.address).then(printDeploy)) as Contract);

  const ccFactory = new ethers.ContractFactory(
    ContributionCalculation.abi,
    ContributionCalculation.bytecode,
    root
  );

  const Contribution = (await ccFactory
    .deploy(Avatar.address, 0, 1e15)
    .then(printDeploy)) as Contract;
  // const contribution = await ethers.getContractAt(
  //   ContributionCalculation.abi,
  //   "0xc3171409dB6827A68294B3A0D40a31310E83eD6B"
  // );

  return {
    Contribution,
    DAI,
    COMP,
    cDAI
  };
};

export const deploySidechain = async (
  setSchemes,
  genericCall,
  avatar,
  identity,
  gd
) => {
  const root = (await ethers.getSigners())[0];
  const fcFactory = new ethers.ContractFactory(
    FirstClaimPool.abi,
    FirstClaimPool.bytecode,
    root
  );
  const otpf = await new ethers.ContractFactory(
    OTPABI.abi,
    OTPABI.bytecode,
    root
  );

  //   const invitesf = await new ethers.ContractFactory(
  //     InvitesABI.abi,
  //     InvitesABI.bytecode,
  //     root
  //   );

  const invitesf = await ethers.getContractFactory("InvitesV1");
  const faucetf = await ethers.getContractFactory("FuseFaucet");

  //   const faucetf = await new ethers.ContractFactory(
  //     FaucetABI.abi,
  //     FaucetABI.bytecode,
  //     root
  //   );

  console.log("deploying first claim...", {
    avatar,
    identity
  });

  const firstClaim = (await fcFactory
    .deploy(avatar, identity, 1000)
    .then(printDeploy)) as Contract;

  let encoded = (
    await ethers.getContractAt("IGoodDollar", gd)
  ).interface.encodeFunctionData("mint", [firstClaim.address, 1000000]);

  await genericCall(gd, encoded);

  console.log("deploying OneTimePayments");

  const otp = (await otpf
    .deploy(avatar, identity)
    .then(printDeploy)) as Contract;

  console.log("deploying OneTimePayments invites");
  const invites = (await upgrades
    .deployProxy(invitesf, [avatar, identity, gd, 10000])
    .then(printDeploy)) as Contract;

  const faucet = (await upgrades
    .deployProxy(faucetf, [identity])
    .then(printDeploy)) as Contract;

  await root
    .sendTransaction({
      to: faucet.address,
      value: ethers.utils.parseEther("5")
    })
    .then(printDeploy);

  console.log("setting firstclaim and otp schemes...");
  await setSchemes([firstClaim.address, otp.address]);
  await firstClaim.start().then(printDeploy);

  return {
    FirstClaimPool: firstClaim,
    OneTimePayments: otp,
    Invites: invites,
    FuseFaucet: faucet
  };
};

const deployAdminWallet = async identity => {
  const root = (await ethers.getSigners())[0];
  const hdNode = ethers.utils.HDNode.fromMnemonic(process.env.ADMIN_MNEMONIC);
  const admins = range(0, 50).map(i =>
    hdNode.derivePath(`m/44'/60'/0'/0/${i + 1}`)
  );

  const adminWallet = (await new ethers.ContractFactory(
    AdminWalletABI.abi,
    AdminWalletABI.bytecode,
    root
  )
    .deploy(
      admins.slice(0, 20).map(_ => _.address),
      ethers.utils.parseUnits("1000000", "gwei"),
      4,
      identity
    )
    .then(printDeploy)) as Contract;

  const id = await ethers.getContractAt("IIdentity", identity);
  await id.addIdentityAdmin(adminWallet.address).then(printDeploy);
  await root
    .sendTransaction({
      to: adminWallet.address,
      value: ethers.utils.parseEther("1")
    })
    .then(printDeploy);
  await adminWallet["topAdmins(uint256)"](0).then(printDeploy);
  console.log(
    "deployAdminWallet admins:",
    admins.map(_ => _.address),
    "balance:",
    await ethers.provider.getBalance(adminWallet.address)
  );

  return adminWallet;
};

const getHelperFunctions = async (Identity, Avatar, schemeMock) => {
  const controller = await Avatar.owner();
  const Controller = await ethers.getContractAt(
    "Controller",
    controller,
    schemeMock
  );
  const setSchemes = async (addrs, params = []) => {
    for (let i in addrs) {
      await Controller.registerScheme(
        addrs[i],
        params[i] || ethers.constants.HashZero,
        "0x0000001F",
        Avatar.address
      ).then(printDeploy);
    }
  };

  const genericCall = (target, encodedFunc) => {
    return Controller.genericCall(target, encodedFunc, Avatar.address, 0).then(
      printDeploy
    );
  };

  const addWhitelisted = (addr, did, isContract = false) => {
    if (isContract) return Identity.addContract(addr);
    return Identity.addWhitelistedWithDID(addr, did).then(printDeploy);
  };

  return { setSchemes, addWhitelisted, genericCall };
};

const performUpgradeFuse = async release => {
  const upgrade = await ethers.getContractAt(
    "ProtocolUpgradeFuse",
    release.ProtocolUpgradeFuse
  );

  console.log("performing protocol v2 upgrade on Fuse...", { release });
  await upgrade
    .upgrade(
      release.NameService,
      //old contracts
      [
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        release.FirstClaimPool
      ],
      release.UBIScheme,
      [
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REPUTATION")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BRIDGE_CONTRACT")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UBISCHEME")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GDAO_STAKING")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GDAO_CLAIMERS"))
      ],
      [
        release.GReputation,
        release.HomeBridge || ethers.constants.AddressZero,
        release.UBIScheme,
        release.GovernanceStaking,
        release.ClaimersDistribution
      ]
    )
    .then(printDeploy);

  console.log("upgrading governance...");

  await upgrade
    .upgradeGovernance(
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      release.CompoundVotingMachine
    )
    .then(printDeploy);
};

const performUpgrade = async (release, ubiScheme) => {
  const upgrade = await ethers.getContractAt(
    "ProtocolUpgrade",
    release.ProtocolUpgrade
  );

  console.log("performing protocol v2 upgrade on Mainnet...", {
    release
  });
  console.log(
    "upgrading nameservice + staking rewards...",
    release.NameService,
    [
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RESERVE")),
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MARKET_MAKER")),
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUND_MANAGER")),
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REPUTATION")),
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GDAO_STAKERS")),
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BRIDGE_CONTRACT")),
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UBI_RECIPIENT")),
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EXCHANGE_HELPER"))
    ],
    [
      release.GoodReserveCDai,
      release.GoodMarketMaker,
      release.GoodFundManager,
      release.GReputation,
      release.StakersDistribution,
      release.ForeignBridge || ethers.constants.AddressZero,
      ubiScheme,
      release.ExchangeHelper
    ],
    release.StakingContracts.map((_: any) => _[0]),
    release.StakingContracts.map((_: any) => _[1])
  );
  let tx;
  tx = await upgrade
    .upgradeBasic(
      release.NameService,
      [
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RESERVE")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MARKET_MAKER")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUND_MANAGER")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REPUTATION")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GDAO_STAKERS")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BRIDGE_CONTRACT")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UBI_RECIPIENT")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EXCHANGE_HELPER"))
      ],
      [
        release.GoodReserveCDai,
        release.GoodMarketMaker,
        release.GoodFundManager,
        release.GReputation,
        release.StakersDistribution,
        release.ForeignBridge || ethers.constants.AddressZero,
        ubiScheme,
        release.ExchangeHelper
      ],
      release.StakingContracts.map((_: any) => _[0]),
      release.StakingContracts.map((_: any) => _[1])
    )
    .then(printDeploy);

  console.log("upgrading reserve...", {
    params: [
      release.NameService,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      release.COMP
    ]
  });
  tx = await upgrade
    .upgradeReserve(
      release.NameService,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      release.COMP
    )
    .then(printDeploy);

  console.log("upgrading governance...");

  tx = await upgrade
    .upgradeGovernance(
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      release.CompoundVotingMachine
    )
    .then(printDeploy);
};

const main = async () => {
  await createDAO();
};
main().catch(e => console.log(e));
