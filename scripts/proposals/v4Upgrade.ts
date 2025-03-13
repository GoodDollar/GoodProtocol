/***
 * Mainnet:
 * FIXES:
 *  - prevent hacked funds burnFrom
 *  - set GOOD rewards to 0
 *  - prevent untrusted contracts in goodfundmanager
 *  - use bonding curve for actual cDAI balance (prevent the "buy" instead of "transferTo" used in hack to trick reserve into minting UBI from interest)
 *  - fix reserve calculations of expansion/currentprice
 *  - fix exit contribution calculations
 *  - add requirement of guardians to approve on-chain proposals
 *  - reserve should not trust exchange helper
 *  - resere should not trust fundmanager for its starting balance
 * Changes:
 *  - mainnet no longer main token chain. so bridge now mints/burns instead of lock/unlock
 *  - require guardians to approve proposals
 *
 * PLAN:
 *  - upgrade compoundvotingmachine
 *  - upgrade reserve
 *  - upgrade exchangeHelper
 *  - upgrade goodfundmanager
 *  - upgrade governance
 *  - upgrade goodmarketmaker
 *  - pause staking
 *  - prevent fusebridge usage
 *  - set GOOD rewards to 0
 *  - blacklist hacked accounts to prevent burn (transfer already blocked done via tax)
 *  - upgrade/stop fuse bridge + withdraw funds
 *  - withdraw funds from MPB bridge
 *  - burn withdrawn funds
 *  - upgrade MPB bridge contract to mint/burn
 *  - give minting rights to the MPB (by adding it as scheme)
 *  - switch fuse distribution to use lz bridge insted of deprecated fuse bridge
 *
 * Fuse:
 *
 * Changes:
 *  - require guardians to approve proposals
 * PLAN:
 *  - upgrade compoundvotingmachine
 *  - prevent old fuse bridge usage
 *  - upgrade MPB bridge contract
 *  - give minting rights to the MPB (by adding it as scheme)
 *  - remove mint rights to bridge given through mintburnwrapper
 *
 * Celo:
 * Changes:
 *  - Upgrade MPB contract
 *  - Deploy new distribution helper
 *
 * PLAN:
 *  - upgrade MP bridge contract
 *  - remove minting rights from bridge (since now it is lock/unlock)
 *  - mint tokens to MPB to match G$ supply on Ethereum+Fuse-Minus locked funds
 *  - deploy CeloDistributionHelper
 *  - add recipients to distribution helper
 *  - give minting rights to mento broker directly on token
 *  - give minting rights to mento expansion controller directly on token
 *  - create the mento G$/CUSD exchange
 *  - set the expansion rate
 */

// add distributionhelper recipients

import { network, ethers, upgrades } from "hardhat";
import { reset } from "@nomicfoundation/hardhat-network-helpers";
import { defaultsDeep, last } from "lodash";
import prompt from "prompt";
// import mpbDeployments from "@gooddollar/bridge-contracts/release/mpb.json"

import { executeViaGuardian, executeViaSafe, verifyProductionSigner } from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
import {
  CeloDistributionHelper,
  Controller,
  FuseOldBridgeKill,
  GoodMarketMaker,
  IBancorExchangeProvider,
  IBroker,
  IGoodDollar,
  IGoodDollarExchangeProvider,
  IGoodDollarExpansionController,
  IMentoReserve,
  ProtocolUpgradeV4Mento
} from "../../types";
import releaser from "../releaser";
let { name: networkName } = network;

// hacker and hacked multichain bridge accounts
const LOCKED_ACCOUNTS = [
  "0xeC577447D314cf1e443e9f4488216651450DBE7c",
  "0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d",
  "0x6738fA889fF31F82d9Fe8862ec025dbE318f3Fde"
];

// TODO: import from bridge-contracts package
const mpbDeployments = {
  "1": [
    { name: "mainnet", MessagePassingBridge_Implementation: { address: "0x618fae127b803eABf72f9e86a88A7505eEBf218a" } }
  ],
  "122": [
    { name: "fuse", MessagePassingBridge_Implementation: { address: "0xFCd61ccB982ce77192E3D18a5AE3326DcE0B6874" } }
  ],
  "42220": [
    { name: "celo", MessagePassingBridge_Implementation: { address: "0x2537f22E7B2D5d14E7f571fA67FCd846d73317f6" } }
  ]
};

const isSimulation = network.name === "hardhat" || network.name === "fork" || network.name === "localhost";
export const upgradeMainnet = async network => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let guardian = root;

  //simulate produciton on fork
  if (isSimulation) {
    networkName = "production-mainnet";
  }

  let release: { [key: string]: any } = dao[networkName];
  let protocolSettings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

  //simulate on fork, make sure safe has enough eth to simulate txs
  if (isSimulation) {
    await reset("https://cloudflare-eth.com/");
    guardian = await ethers.getImpersonatedSigner(protocolSettings.guardiansSafe);

    await root.sendTransaction({
      value: ethers.constants.WeiPerEther.mul(3),
      to: protocolSettings.guardiansSafe
    });
  }

  const rootBalance = await ethers.provider.getBalance(root.address).then(_ => _.toString());
  const guardianBalance = await ethers.provider.getBalance(guardian.address).then(_ => _.toString());

  console.log("got signers:", {
    networkName,
    root: root.address,
    guardian: guardian.address,
    balance: rootBalance,
    guardianBalance: guardianBalance
  });

  const gd = (await ethers.getContractAt("IGoodDollar", release.GoodDollar)) as IGoodDollar;
  const fuseBridgeBalance = await gd.balanceOf(release.ForeignBridge);
  const mpbBridgeBalance = await gd.balanceOf(release.MpbBridge);
  const totalToBurn = fuseBridgeBalance.add(mpbBridgeBalance);
  const mpbImplementation = mpbDeployments["1"].find(_ => _.name === "mainnet")["MessagePassingBridge_Implementation"]
    .address;

  // test blacklisting to prevent burn by hacker
  if (isSimulation) {
    const locked = await ethers.getImpersonatedSigner(LOCKED_ACCOUNTS[0]);
    const tx = await gd
      .connect(locked)
      .burn("10", { maxFeePerGas: 30e9, maxPriorityFeePerGas: 1e9, gasLimit: 200000 })
      .then(_ => _.wait())
      .then(_ => _.status)
      .catch(e => e);
    console.log("Burn tx before:", tx);
  }

  const startSupply = await gd.totalSupply();
  console.log(
    `Total bridge balances to burn: Total Supply: ${startSupply.toNumber() / 1e2} Fuse: ${
      fuseBridgeBalance.toNumber() / 1e2
    } Celo: ${mpbBridgeBalance.toNumber() / 1e2} Total: ${totalToBurn.toNumber() / 1e2}`
  );
  console.log("executing proposals");

  const reserveImpl = await ethers.deployContract("GoodReserveCDai");
  const goodFundManagerImpl = await ethers.deployContract("GoodFundManager");
  const exchangeHelperImpl = await ethers.deployContract("ExchangeHelper");
  const stakersDistImpl = await ethers.deployContract("StakersDistribution");
  const govImpl = await ethers.deployContract("CompoundVotingMachine");
  const distHelperImpl = await ethers.deployContract("DistributionHelper");
  const marketMakerImpl = await ethers.deployContract("GoodMarketMaker");
  const proposalActions = [
    [
      release.GoodReserveCDai,
      "setReserveRatioDailyExpansion(uint256,uint256)",
      ethers.utils.defaultAbiCoder.encode(["uint256", "uint256"], [999711382710978, 1e15]),
      0
    ], //expansion ratio
    [
      release.GoodReserveCDai,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [reserveImpl.address]),
      "0"
    ], //upgrade reserve
    [
      release.GoodFundManager,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [goodFundManagerImpl.address]),
      "0"
    ], //upgrade fundmanager
    [
      release.ExchangeHelper,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [exchangeHelperImpl.address]),
      "0"
    ], //upgrade exchangehelper
    [release.ExchangeHelper, "setAddresses()", "0x", "0"], // activate upgrade changes
    [
      release.DistributionHelper,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [distHelperImpl.address]),
      "0"
    ], //upgrade disthelper
    [
      release.StakersDistribution,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [stakersDistImpl.address]),
      "0"
    ], //upgrade stakers dist
    [
      release.GoodMarketMaker,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [marketMakerImpl.address]),
      "0"
    ], //upgrade mm
    [
      release.CompoundVotingMachine,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [govImpl.address]),
      "0"
    ], // upgrade gov
    [release.StakingContractsV3[0][0], "pause(bool)", ethers.utils.defaultAbiCoder.encode(["bool"], [true]), "0"], // pause staking
    [release.StakingContractsV3[1][0], "pause(bool)", ethers.utils.defaultAbiCoder.encode(["bool"], [true]), "0"], // pause staking
    [
      release.ForeignBridge,
      "setExecutionDailyLimit(uint256)",
      ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
      "0"
    ], // prevent from using
    [
      release.ForeignBridge,
      "claimTokens(address,address)",
      ethers.utils.defaultAbiCoder.encode(["address", "address"], [release.GoodDollar, release.Avatar]),
      "0"
    ], // claim bridge tokens to avatar
    [
      release.StakersDistribution,
      "setMonthlyReputationDistribution(uint256)",
      ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
      "0"
    ], //set GOOD rewards to 0
    [
      release.Identity,
      "addBlacklisted(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [LOCKED_ACCOUNTS[0]]),
      "0"
    ], // set locked G$ accounts as blacklisted
    [
      release.Identity,
      "addBlacklisted(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [LOCKED_ACCOUNTS[1]]),
      "0"
    ], // set locked G$ accounts as blacklisted
    [
      release.Identity,
      "addBlacklisted(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [LOCKED_ACCOUNTS[2]]),
      "0"
    ], // set locked G$ accounts as blacklisted
    [
      release.MpbBridge,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [mpbImplementation]),
      "0"
    ], // mpb upgrade
    [
      release.MpbBridge,
      "withdraw(address,uint256)",
      ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [release.GoodDollar, 0]),
      "0"
    ], // claim bridge tokens to avatar
    [release.GoodDollar, "burn(uint256)", ethers.utils.defaultAbiCoder.encode(["uint256"], [totalToBurn]), "0"], // burn tokens
    [
      release.Controller,
      "registerScheme(address,bytes32,bytes4,address)",
      ethers.utils.defaultAbiCoder.encode(
        ["address", "bytes32", "bytes4", "address"],
        [
          release.MpbBridge, //scheme
          ethers.constants.HashZero, //paramshash
          "0x00000001", //permissions - minimal
          release.Avatar
        ]
      ),
      "0"
    ], //minting rigts to our bridge
    [
      release.DistributionHelper,
      "addOrUpdateRecipient((uint32,uint32,address,uint8))",
      ethers.utils.defaultAbiCoder.encode(
        ["uint32", "uint32", "address", "uint8"],
        [0, 122, dao["production"].UBIScheme, 1] //0% chainId 122 ubischeme 1-lz bridge
      ),
      "0"
    ], // switch to lz bridge for fuse
    [
      release.GoodReserveCDai,
      "grantRole(bytes32,address)",
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "address"],
        [
          "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a", //pauser role
          release.Avatar
        ]
      ),
      "0"
    ] // give avatar reserve pauser role
  ];

  const [proposalContracts, proposalFunctionSignatures, proposalFunctionInputs, proposalEthValues] = [
    proposalActions.map(_ => _[0]),
    proposalActions.map(_ => _[1]),
    proposalActions.map(_ => _[2]),
    proposalActions.map(_ => _[3])
  ];
  if (isProduction) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      protocolSettings.guardiansSafe,
      "mainnet"
    );
  } else {
    //simulation or dev envs
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkName
    );
  }

  if (isSimulation) {
    await mainnetPostChecks(totalToBurn, startSupply);
  }
};

const mainnetPostChecks = async (totalToBurn, startSupply) => {
  networkName = "production-mainnet";
  let release: { [key: string]: any } = dao[networkName];

  let [root, ...signers] = await ethers.getSigners();
  const gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);

  const locked = await ethers.getImpersonatedSigner(LOCKED_ACCOUNTS[0]);
  const tx = await gd
    .connect(locked)
    .burn("10", { maxFeePerGas: 30e9, maxPriorityFeePerGas: 1e9, gasLimit: 200000 })
    .then(_ => _.wait())
    .then(_ => _.status)
    .catch(e => e);
  console.log("Burn tx after should fail:", tx);
  const finalSupply = await gd.totalSupply();
  const burnOk = finalSupply.add(totalToBurn).eq(startSupply);
  console.log("Burn check:", burnOk ? "Success" : "Failed");

  const mm = (await ethers.getContractAt("GoodMarketMaker", release.GoodMarketMaker)) as GoodMarketMaker;
  const newExpansion = await mm.reserveRatioDailyExpansion();
  console.log(
    "new expansion set:",
    newExpansion,
    newExpansion.mul(1e15).div(ethers.utils.parseEther("1000000000")).toNumber() / 1e15 === 0.999711382710978
  );

  const [mpbBalance, fuseBalance] = await Promise.all([
    gd.balanceOf(release.MpbBridge),
    gd.balanceOf(release.ForeignBridge)
  ]);
  console.log("bridges shouuld have 0 balance as tokens have been burned", { mpbBalance, fuseBalance });
};

export const upgradeFuse = async network => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  let networkEnv = networkName.split("-")[0];
  if (isSimulation) networkEnv = "production";

  let release: { [key: string]: any } = dao[networkEnv];

  let guardian = root;
  //simulate on fork, make sure safe has enough eth to simulate txs
  if (isSimulation) {
    await reset("https://rpc.fuse.io");
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({ value: ethers.constants.WeiPerEther.mul(3), to: guardian.address });
  }

  const mpbImplementation = mpbDeployments["122"].find(_ => _.name === "fuse")["MessagePassingBridge_Implementation"]
    .address;
  const govImpl = await ethers.deployContract("CompoundVotingMachine");
  const killBridge = (await ethers.deployContract("FuseOldBridgeKill")) as FuseOldBridgeKill;

  const ctrl = await ethers.getContractAt("Controller", release.Controller);

  console.log({ networkEnv, mpbImplementation, guardian: guardian.address, isSimulation, isProduction });
  const proposalActions = [
    [
      release.HomeBridge,
      "upgradeToAndCall(uint256,address,bytes)", // upgrade and call end
      ethers.utils.defaultAbiCoder.encode(
        ["uint256", "address", "bytes"],
        [2, killBridge.address, killBridge.interface.encodeFunctionData("end")]
      ),
      "0"
    ], // prevent from using
    [
      release.CompoundVotingMachine,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [govImpl.address]),
      "0"
    ], //upgrade
    [
      release.MpbBridge,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [mpbImplementation]),
      "0"
    ], //upgrade
    [
      release.Controller,
      "registerScheme(address,bytes32,bytes4,address)", //make sure mpb is a registered scheme so it can mint G$ tokens
      ethers.utils.defaultAbiCoder.encode(
        ["address", "bytes32", "bytes4", "address"],
        [
          release.MpbBridge, //scheme
          ethers.constants.HashZero, //paramshash
          "0x00000001", //permissions - minimal
          release.Avatar
        ]
      ),
      "0"
    ], // set mpb as minter = add as scheme
    [
      release.GoodDollarMintBurnWrapper,
      "revokeRole(bytes32,address)",
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "address"],
        [ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE")), release.MpbBridge]
      ),
      "0"
    ] //remove bridge minting rights via wrapper
  ];

  const [proposalContracts, proposalFunctionSignatures, proposalFunctionInputs, proposalEthValues] = [
    proposalActions.map(_ => _[0]),
    proposalActions.map(_ => _[1]),
    proposalActions.map(_ => _[2]),
    proposalActions.map(_ => _[3])
  ];

  if (isProduction) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "fuse"
    );
  } else {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv
    );
  }

  if (isSimulation) {
    const isMPBScheme = await ctrl.isSchemeRegistered(release.MpbBridge, release.Avatar);
    const isFuseBridge = await ctrl.isSchemeRegistered(release.HomeBridge, release.Avatar);
    console.log("MPB scheme registration check:", isMPBScheme ? "Success" : "Failed");
    console.log("Fuse bridge scheme de-registration check:", !isFuseBridge ? "Success" : "Failed");
  }
};

export const upgradeCelo = async network => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  let networkEnv = networkName;
  if (isSimulation) networkEnv = network;

  let release: { [key: string]: any } = dao[networkEnv];

  let guardian = root;
  console.log("signer:", root.address, { networkEnv, isSimulation, isProduction, release });

  const cusd = await ethers.getContractAt("IERC20", release.CUSD);
  const gd = await ethers.getContractAt("GoodDollar", release.GoodDollar);
  const mentoReserve = (await ethers.getContractAt("IMentoReserve", release.MentoReserve)) as IMentoReserve;

  const mentoExchange = (await ethers.getContractAt(
    "IBancorExchangeProvider",
    release.MentoExchangeProvider
  )) as IBancorExchangeProvider;

  //simulate on fork, make sure safe has enough eth to simulate txs
  let DIST_HELPER_MIN_CELO_BALANCE = ethers.utils.parseEther("2");

  if (isSimulation) {
    DIST_HELPER_MIN_CELO_BALANCE = ethers.utils.parseEther("0.1");
    // await reset("https://rpc.ankr.com/celo");
    await root.sendTransaction({ value: ethers.utils.parseEther("0.5"), to: release.Avatar });

    const avatar = await ethers.getImpersonatedSigner(release.Avatar);
    const reserveOwner = await ethers.getImpersonatedSigner(await mentoReserve.owner());
    const eids = await mentoExchange.getExchangeIds();
    if (eids.length > 0) {
      await mentoExchange.connect(avatar).destroyExchange(eids[0], 0);
    }

    const devCUSD = await ethers.getContractAt(
      [
        "function mint(address,uint) external returns (uint)",
        "function setValidators(address) external",
        "function owner() view returns(address)"
      ],
      release.CUSD
    );

    console.log("minting devCUSD");
    const cusdOwner = await ethers.getImpersonatedSigner(await devCUSD.owner());
    await root.sendTransaction({ value: ethers.utils.parseEther("0.5"), to: cusdOwner.address });
    await devCUSD.connect(cusdOwner).setValidators(release.Avatar).catch(console.log);
    await devCUSD.connect(avatar).mint(root.address, ethers.utils.parseEther("2000000")).catch(console.log);

    console.log("transfering cusd to reserve");
    await cusd.connect(root).transfer(release.MentoReserve, ethers.utils.parseEther("200000"));

    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);
    await root.sendTransaction({ value: ethers.utils.parseEther("0.5"), to: guardian.address });
  } else if (!isProduction) {
    DIST_HELPER_MIN_CELO_BALANCE = ethers.utils.parseEther("0.1");
    const mentoReserve = (await ethers.getContractAt("IMentoReserve", release.MentoReserve)) as IMentoReserve;
    const ctrl = (await ethers.getContractAt("Controller", release.Controller)) as Controller;

    const eids = await mentoExchange.getExchangeIds();
    if (eids.length > 0) {
      await (
        await ctrl.genericCall(
          mentoExchange.address,
          mentoExchange.interface.encodeFunctionData("destroyExchange", [eids[0], 0]),
          release.Avatar,
          0
        )
      ).wait();
    }

    const devCUSD = await ethers.getContractAt(
      ["function mint(address,uint) external returns (uint)", "function setValidators(address) external"],
      release.CUSD
    );
    await (
      await ctrl.genericCall(
        devCUSD.address,
        devCUSD.interface.encodeFunctionData("setValidators", [release.Avatar]),
        release.Avatar,
        0
      )
    ).wait();
    await (
      await ctrl.genericCall(
        devCUSD.address,
        devCUSD.interface.encodeFunctionData("mint", [root.address, ethers.utils.parseEther("2000000")]),
        release.Avatar,
        0
      )
    ).wait();

    if ((await cusd.balanceOf(release.MentoReserve)).lt(ethers.utils.parseEther("200000"))) {
      await cusd.transfer(release.MentoReserve, ethers.utils.parseEther("200000"));
    }
  }

  const mpbImplementation = mpbDeployments["42220"].find(_ => _.name === "celo")["MessagePassingBridge_Implementation"]
    .address;
  const bridgeLocked = ["0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5", "0xD5D11eE582c8931F336fbcd135e98CEE4DB8CCB0"];
  const locked = [
    "0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d",
    "0xeC577447D314cf1e443e9f4488216651450DBE7c",
    "0x6738fA889fF31F82d9Fe8862ec025dbE318f3Fde"
  ];

  const ethprovider = new ethers.providers.JsonRpcProvider("https://rpc.ankr.com/eth");
  const fuseprovider = new ethers.providers.JsonRpcProvider("https://rpc.fuse.io");
  const TOTAL_LOCKED = (
    await Promise.all(
      locked
        .concat(bridgeLocked)
        .map(_ => gd.connect(ethprovider).attach(dao["production-mainnet"].GoodDollar).balanceOf(_))
    )
  ).reduce((prev, cur) => prev.add(cur), ethers.constants.Zero);
  const TOTAL_SUPPLY_ETH = await gd.connect(ethprovider).attach(dao["production-mainnet"].GoodDollar).totalSupply();
  const TOTAL_SUPPLY_FUSE = await gd.connect(fuseprovider).attach(dao["production"].GoodDollar).totalSupply();
  const TOTAL_SUPPLY_CELO = await gd.totalSupply();
  const TOTAL_GLOBAL_SUPPLY = TOTAL_SUPPLY_ETH.add(TOTAL_SUPPLY_FUSE)
    .sub(TOTAL_LOCKED)
    .mul(ethers.BigNumber.from("10000000000000000")) //convert to 18 decimals
    .add(TOTAL_SUPPLY_CELO);

  const exchangeParams = [release.CUSD, release.GoodDollar, 0, 0, 0, 0]; //address reserveAsset;address tokenAddress;uint256 tokenSupply;uint256 reserveBalance;uint32 reserveRatio;uint32 exitConribution;

  console.log({
    networkEnv,
    mpbImplementation,
    guardian: guardian.address,
    isSimulation,
    isProduction,
    release,
    TOTAL_GLOBAL_SUPPLY
  });

  const mentoUpgrade = release.MentoUpgradeHelper
    ? ((await ethers.getContractAt("ProtocolUpgradeV4Mento", release.MentoUpgradeHelper)) as ProtocolUpgradeV4Mento)
    : await ethers.deployContract("ProtocolUpgradeV4Mento", [release.Avatar]);
  let distHelper = release.CeloDistributionHelper
    ? ((await ethers.getContractAt("CeloDistributionHelper", release.CeloDistributionHelper)) as CeloDistributionHelper)
    : ((await upgrades.deployProxy(
        await ethers.getContractFactory("CeloDistributionHelper"),
        [release.NameService, "0x00851A91a3c4E9a4c1B48df827Bacc1f884bdE28"], //static oracle for uniswap
        { initializer: "initialize" }
      )) as CeloDistributionHelper);

  release.MentoUpgradeHelper = mentoUpgrade.address;
  release.CeloDistributionHelper = distHelper.address;
  if (!isSimulation) {
    releaser(release, networkEnv);
  }
  console.log("deployed mentoUpgrade", {
    distribuitonHelper: distHelper.address,
    mentoUpgrade: mentoUpgrade.address,
    distHelperAvatar: await distHelper.avatar()
  });
  const proposalContracts = [
    release.CeloDistributionHelper, //set fee settings
    release.CeloDistributionHelper, //add ubi recipient
    release.CeloDistributionHelper, //add community treasury recipient
    release.MpbBridge, // upgrade
    release.MpbBridge && release.GoodDollarMintBurnWrapper, // remove minting rights from bridge
    release.GoodDollar, // set mento broker as minter
    release.GoodDollar, // set reserve expansion controller as minter
    release.Controller, // register upgrade contract
    mentoUpgrade.address // create the exchange + set expansion rate
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setFeeSettings((uint128,uint128,uint8,uint8))",
    "addOrUpdateRecipient((uint32,uint32,address,uint8))",
    "addOrUpdateRecipient((uint32,uint32,address,uint8))",
    "upgradeTo(address)",
    "revokeRole(bytes32,address)", // mpb is now lock/unlock doesnt need minting
    "addMinter(address)",
    "addMinter(address)",
    "registerScheme(address,bytes32,bytes4,address)",
    "upgrade(address,(address,address,uint256,uint256,uint32,uint32),address,address,address,uint256)" //Controller _controller,PoolExchange memory _exchange,address _mentoExchange,address _mentoController, address _distHelper
  ];

  console.log("preparing inputs...");
  const proposalFunctionInputs = [
    //uint128 maxFee;uint128 minBalanceForFees;uint8 percentageToSellForFee;
    //2 celo max fee for lz bridge, min balance 2 celo, max percentage to sell 1%, max slippage 5%
    ethers.utils.defaultAbiCoder.encode(
      ["uint128", "uint128", "uint8", "uint8"],
      [ethers.utils.parseEther("2"), DIST_HELPER_MIN_CELO_BALANCE, "1", "5"]
    ),
    ethers.utils.defaultAbiCoder.encode(["uint32", "uint32", "address", "uint8"], [9000, 42220, release.UBIScheme, 1]), // ubi pool recipient
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [1000, 42220, release.CommunitySafe, 1]
    ), //community treasury recipient
    ethers.utils.defaultAbiCoder.encode(["address"], [mpbImplementation]),
    release.MpbBridge &&
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "address"],
        [ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE")), release.MpbBridge]
      ),
    ethers.utils.defaultAbiCoder.encode(["address"], [release.MentoBroker]),
    ethers.utils.defaultAbiCoder.encode(["address"], [release.MentoExpansionController]),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [mentoUpgrade.address, ethers.constants.HashZero, "0x0000001f", release.Avatar]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "(address,address,uint256,uint256,uint32,uint32)", "address", "address", "address", "uint256"],
      [
        release.Controller,
        exchangeParams,
        release.MentoExchangeProvider,
        release.MentoExpansionController,
        release.CeloDistributionHelper,
        TOTAL_GLOBAL_SUPPLY
      ]
    )
  ];

  console.log({ exchangeParams, mentoExchange: release.MentoExchangeProvider });
  console.log("executing upgrade...", { proposalContracts, proposalFunctionInputs, proposalFunctionSignatures });

  if (isProduction) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "celo"
    );
  } else {
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
    const supplyAfter = await (await ethers.getContractAt("IGoodDollar", release.GoodDollar)).totalSupply();
    console.log("Supply after upgrade:", { supplyAfter, TOTAL_GLOBAL_SUPPLY });

    const isBrokerMinter = await gd.isMinter(release.MentoBroker);
    const isExpansionMinter = await gd.isMinter(release.MentoExpansionController);
    const mentoExchange = await ethers.getContractAt("IBancorExchangeProvider", release.MentoExchangeProvider);
    const mentoBroker = (await ethers.getContractAt("IBroker", release.MentoBroker)) as IBroker;
    const eids = await mentoExchange.getExchangeIds();
    const exchange = await mentoExchange.getPoolExchange(eids[0]);
    const price = (await mentoExchange.currentPrice(eids[0])) / 1e18;
    console.log("current price:", price);
    console.log("Exchange:", exchange, eids[0]);

    console.log("Broker minter check:", isBrokerMinter ? "Success" : "Failed");
    console.log("Expansion minter check:", isExpansionMinter ? "Success" : "Failed");

    console.log("balance before swap:", await gd.balanceOf(root.address), await cusd.balanceOf(root.address));
    await cusd.approve(release.MentoBroker, ethers.utils.parseEther("1000"));
    await mentoBroker
      .swapIn(mentoExchange.address, eids[0], cusd.address, gd.address, ethers.utils.parseEther("1000"), 0)
      .then(_ => _.wait());
    console.log("Balance after swap:", await gd.balanceOf(root.address), await cusd.balanceOf(root.address));
    const mentomint = (await ethers.getContractAt(
      "IGoodDollarExpansionController",
      release.MentoExpansionController
    )) as IGoodDollarExpansionController;
    await cusd.approve(mentomint.address, ethers.utils.parseEther("1000"));
    const tx = await (await mentomint.mintUBIFromInterest(eids[0], ethers.utils.parseEther("1000"))).wait();
    console.log(
      "mint from interest:",
      tx.events.find(_ => _.event === "InterestUBIMinted").args.amount.toString() / 1e18
    );
    console.log("price after interest mint:", (await mentoExchange.currentPrice(eids[0])) / 1e18);
    const distTx = await (await distHelper.onDistribution(0, { gasLimit: 2000000 })).wait();
    const { distributionRecipients, distributed } = distTx.events.find(_ => _.event === "Distribution").args;
    console.log("Distribution events:", distributionRecipients, distributed, distTx.events);
    const bridgeBalance = await gd.balanceOf("0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5");
    console.log("Brigde balance should equal other chains total supply:", {
      bridgeBalance,
      isEqual: bridgeBalance.eq(TOTAL_GLOBAL_SUPPLY.sub(TOTAL_SUPPLY_CELO))
    });
  }
};

export const main = async () => {
  prompt.start();
  const { network } = await prompt.get(["network"]);

  console.log("running step:", { network });
  const chain = last(network.split("-"));
  switch (chain) {
    case "mainnet":
      await upgradeMainnet(network);

      break;
    case "fuse":
      await upgradeFuse(network);

      break;
    case "celo":
      await upgradeCelo(network);

      break;
  }
};

main().catch(console.log);
