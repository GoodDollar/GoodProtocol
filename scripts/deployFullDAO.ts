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
const { name } = network;

const printDeploy = (c: Contract): Contract => {
  console.log("deployed to: ", c.address);
  return c;
};

export const createDAO = async () => {
  const fusedao = dao[network.name.split("-")[0]];
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

  console.log("deployed erc20 tokens");
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

  const BancorFormula = await (
    await ethers.getContractFactory("BancorFormula")
  ).deploy();

  const AddFounders = await AddFoundersFactory.deploy().then(printDeploy);
  // const AddFounders = await ethers.getContractAt(
  //   AddFoundersABI.abi,
  //   "0x6F1BAbfF5E119d61F0c6d8653d84E8B284B87091"
  // );

  const Identity = await IdentityFactory.deploy().then(printDeploy);
  // const Identity = await ethers.getContractAt(
  //   IdentityABI.abi,
  //   "0x77Bd4D825F4df162BDdda73a7E295c27e09E289f"
  // );

  const daoCreator = await DAOCreatorFactory.deploy(AddFounders.address).then(
    printDeploy
  );
  // const daoCreator = await ethers.getContractAt(
  //   DAOCreatorABI.abi,
  //   "0xfD1eFFDed0EE8739dF61B580F24bCd6585d0c6B4"
  // );

  const FeeFormula = await FeeFormulaFactory.deploy(0).then(printDeploy);
  // const FeeFormula = await ethers.getContractAt(
  //   FeeFormulaABI.abi,
  //   "0x85b146AAa910aF4ab1D64cD81ab6f804aDf3053c"
  // );

  await Identity.setAuthenticationPeriod(365);
  await daoCreator.forgeOrg(
    "GoodDollar",
    "G$",
    0,
    FeeFormula.address,
    Identity.address,
    [root.address, signers[0].address, signers[1].address],
    1000,
    [100000, 100000, 100000]
  );

  const Avatar = new ethers.Contract(
    await daoCreator.avatar(),
    [
      "function owner() view returns (address)",
      "function nativeToken() view returns (address)"
    ],
    root
  );

  await Identity.setAvatar(Avatar.address);

  console.log("Done deploying DAO, setting schemes permissions");

  let schemes = [schemeMock.address, Identity.address];

  const gd = await Avatar.nativeToken();

  const controller = await Avatar.owner();

  console.log("setting schemes", schemes);

  await daoCreator.setSchemes(
    Avatar.address,
    schemes,
    schemes.map(_ => ethers.constants.HashZero),
    ["0x0000001F", "0x00000001"],
    ""
  );

  let { setSchemes, genericCall, addWhitelisted } = await getHelperFunctions(
    Identity,
    Avatar,
    schemeMock
  );

  let mainnet: { [key: string]: Contract } = {};

  if (isMainnet) {
    mainnet = await deployMainnet(Avatar, Identity);
  }

  let sidechain: { [key: string]: any } = {};
  let release: { [key: string]: any } = {};
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
    await root.sendTransaction({
      to: adminWallet.address,
      value: ethers.utils.parseUnits("0.1", "ether")
    });
    Object.entries(sidechain).forEach(([k, v]) => (release[k] = v.address));
    release["AdminWallet"] = adminWallet.address;
  }

  const bridgeRelease = await deployBridge(Avatar, gd, setSchemes, isMainnet);
  release = { ...release, ...bridgeRelease };

  //deploy v2 mainnet/sidechain contracts, returns their addresses
  const v2 = await deployV2(network.name, false, {
    FirstClaimPool: sidechain?.FirstClaimPool?.address,
    BancorFormula: BancorFormula.address,
    Avatar: Avatar.address,
    Controller: controller,
    DAIUsdOracle: ethers.constants.AddressZero,
    COMPUsdOracle: ethers.constants.AddressZero,
    USDCUsdOracle: ethers.constants.AddressZero,
    AAVEUsdOracle: ethers.constants.AddressZero,
    AaveLendingPool: ethers.constants.AddressZero,
    AaveIncentiveController: ethers.constants.AddressZero,
    GasPriceOracle: ethers.constants.AddressZero,
    cDAI: mainnet?.cDAI?.address || ethers.constants.AddressZero,
    DAI: mainnet?.dai?.address || ethers.constants.AddressZero,
    COMP: mainnet?.COMP?.address || ethers.constants.AddressZero,
    USDC: ethers.constants.AddressZero,
    Identity: Identity.address,
    GoodDollar: gd,
    Contribution: mainnet?.contribution?.address,
    UniswapRouter: "0x0000000000000000000000000000000000000001",
    ...bridgeRelease,
    SchemeRegistrar: ethers.constants.AddressZero,
    UpgradeScheme: ethers.constants.AddressZero
  });
  release = { ...release, ...v2 };

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
      await ethers.getContractAt("IGoodDollar", gd)
    ).interface.encodeFunctionData("mint", [release.UBIScheme, 1000000]);

    await genericCall(gd, encoded);

    await setSchemes([release.ProtocolUpgradeFuse]);
    await performUpgradeFuse(release);
  }

  await releaser(release, network.name);

  return {
    ...mainnet,
    ...sidechain,
    daoCreator,
    controller,
    avatar: await daoCreator.avatar(),
    gd: await Avatar.nativeToken(),
    identity: Identity.address,
    bancorFormula: BancorFormula.address
    // bridge: Bridge.address,
  };
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
  const scheme = await bridgeFactory.deploy(
    Avatar.address,
    BridgeFactoryContract
  );
  await setSchemes([scheme.address]);

  if (network.name.includes("develop")) {
    const mockBridge = await new ethers.ContractFactory(
      BridgeMock.abi,
      BridgeMock.bytecode,
      root
    ).deploy();
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
  console.log("deployed bridge:", tx.events[0].args);
  console.log(tx.events, tx);
  return isMainnet
    ? { ForeignBridge: tx.events[0].args._foreignBridge }
    : { HomeBridge: tx.events[0].args._homeBridge };
};

const deployMainnet = async (Avatar, Identity) => {
  const [root] = await ethers.getSigners();

  const cdaiFactory = await ethers.getContractFactory("cDAIMock");
  const daiFactory = await ethers.getContractFactory("DAIMock");

  const daiAddr = ProtocolSettings[network.name]?.compound?.dai;
  const cdaiAddr = ProtocolSettings[network.name]?.compound?.cdai;
  const COMPAddr = ProtocolSettings[network.name]?.compound?.comp;

  let dai = daiAddr
    ? await ethers.getContractAt("DAIMock", daiAddr)
    : await daiFactory.deploy();

  let COMP = COMPAddr
    ? await ethers.getContractAt("DAIMock", COMPAddr)
    : await daiFactory.deploy();

  let cDAI = cdaiAddr
    ? await ethers.getContractAt("DAIMock", cdaiAddr)
    : await cdaiFactory.deploy(dai.address);

  const ccFactory = new ethers.ContractFactory(
    ContributionCalculation.abi,
    ContributionCalculation.bytecode,
    root
  );

  const contribution = await ccFactory
    .deploy(Avatar.address, 0, 1e15)
    .then(printDeploy);
  // const contribution = await ethers.getContractAt(
  //   ContributionCalculation.abi,
  //   "0xc3171409dB6827A68294B3A0D40a31310E83eD6B"
  // );

  return {
    contribution,
    dai,
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

  const firstClaim = await fcFactory.deploy(avatar, identity, 1000);

  let encoded = (
    await ethers.getContractAt("IGoodDollar", gd)
  ).interface.encodeFunctionData("mint", [firstClaim.address, 1000000]);

  await genericCall(gd, encoded);

  console.log("deploying OneTimePayments");

  const otp = await otpf.deploy(avatar, identity).then(printDeploy);

  console.log("deploying OneTimePayments invites");
  const invites = await upgrades.deployProxy(invitesf, [
    avatar,
    identity,
    gd,
    10000
  ]);

  const faucet = await upgrades.deployProxy(faucetf, [identity]);

  console.log("setting firstclaim and otp schemes...");
  await setSchemes([firstClaim.address, otp.address]);
  const tx = await firstClaim.start();

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

  const adminWallet = await new ethers.ContractFactory(
    AdminWalletABI.abi,
    AdminWalletABI.bytecode,
    root
  ).deploy(
    admins.slice(0, 20).map(_ => _.address),
    ethers.utils.parseUnits("1000000", "gwei"),
    4,
    identity
  );

  const id = await ethers.getContractAt("IIdentity", identity);
  await id.addIdentityAdmin(adminWallet.address);
  await root.sendTransaction({
    to: adminWallet.address,
    value: ethers.utils.parseEther("10")
  });
  await adminWallet["topAdmins(uint256)"](0);
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
      );
    }
  };

  const genericCall = (target, encodedFunc) => {
    return Controller.genericCall(target, encodedFunc, Avatar.address, 0);
  };

  const addWhitelisted = (addr, did, isContract = false) => {
    if (isContract) return Identity.addContract(addr);
    return Identity.addWhitelistedWithDID(addr, did);
  };

  return { setSchemes, addWhitelisted, genericCall };
};

const performUpgradeFuse = async release => {
  const upgrade = await ethers.getContractAt(
    "ProtocolUpgradeFuse",
    release.ProtocolUpgradeFuse
  );

  console.log("performing protocol v2 upgrade on Fuse...", { release });
  await upgrade.upgrade(
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
  );

  console.log("upgrading governance...");

  await upgrade.upgradeGovernance(
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    release.CompoundVotingMachine
  );
};

const performUpgrade = async (release, ubiScheme) => {
  const upgrade = await ethers.getContractAt(
    "ProtocolUpgrade",
    release.ProtocolUpgrade
  );

  console.log("performing protocol v2 upgrade on Mainnet...", {
    release
  });
  console.log("upgrading nameservice + staking rewards...");
  let tx;
  tx = await (
    await upgrade.upgradeBasic(
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
  ).wait();

  console.log("upgrading reserve...", {
    params: [
      release.NameService,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      release.COMP
    ]
  });
  tx = await upgrade.upgradeReserve(
    release.NameService,
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    release.COMP
  );

  console.log("upgrading governance...");

  tx = await upgrade.upgradeGovernance(
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    release.CompoundVotingMachine
  );
};

const main = async () => {
  await createDAO();
};
main().catch(e => console.log(e));