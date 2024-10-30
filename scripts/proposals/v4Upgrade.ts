/***
 * Mainnet:
 * FIXES:
 *  - prevent hacked funds burnFrom
 *  - set GOOD rewards to 0
 *
 * Changes:
 *  - mainnet no longer main token chain. so bridge now mints/burns instead of lock/unlock
 *
 * PLAN:
 *  - pause staking
 *  - prevent fusebridge usage
 *  - set GOOD rewards to 0
 *  - blacklist hacked accounts to prevent burn (transfer already blocked done via tax)
 *  - upgrade MP bridge contract
 *  - withdraw funds from fuse + MPB bridges
 *  - burn withdrawn funds
 *  - give minting rights to the MPB (by adding it as scheme)
 *
 * Fuse:
 * Changes:
 *  - Upgrade MPB contract
 *
 * PLAN:
 *  - prevent old fuse bridge usage
 *  - upgrade MP bridge contract
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
 *  - deploy DistributionHelper
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
import { IGoodDollar } from "../../types";
let { name: networkName } = network;

// TODO: import from bridge-contracts package
const mpbDeployments = {
  "1": [
    { name: "mainnet", MessagePassingBridge_Implementation: { address: "0xF19fB90fA4DDb67C330B41AD4D64ef75B9d8Cd33" } }
  ],
  "122": [
    { name: "fuse", MessagePassingBridge_Implementation: { address: "0xd3B5BfDacb042a89bbABAd2376Aa1a923B365a14" } }
  ],
  "42220": [
    { name: "celo", MessagePassingBridge_Implementation: { address: "0x691dE730D97d545c141D13ED5e9c12b7cB384a73" } }
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
    let upgradeabilityOwner = await ethers.getImpersonatedSigner("0xd9176e84898a0054680aEc3f7C056b200c3d96C3");
    const fuseBridge = await ethers.getContractAt(
      ["function transferProxyOwnership(address newOwner)", "function upgradeabilityOwner() view returns (address)"],
      release.ForeignBridge
    );
    await fuseBridge.connect(upgradeabilityOwner).transferProxyOwnership(release.Avatar);
    console.log("New fuse bridge owner:", await fuseBridge.upgradeabilityOwner());

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

  const goodFundManagerImpl = await ethers.deployContract("GoodFundManager");

  const gd = (await ethers.getContractAt("IGoodDollar", release.GoodDollar)) as IGoodDollar;
  const fuseBridgeBalance = await gd.balanceOf(release.ForeignBridge);
  const mpbBridgeBalance = await gd.balanceOf(release.MpbBridge);
  const totalToBurn = fuseBridgeBalance.add(mpbBridgeBalance);
  const mpbImplementation = mpbDeployments["1"].find(_ => _.name === "mainnet")["MessagePassingBridge_Implementation"]
    .address;

  // test blacklisting to prevent burn by hacker
  if (isSimulation) {
    const locked = await ethers.getImpersonatedSigner("0xeC577447D314cf1e443e9f4488216651450DBE7c");
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

  const proposalContracts = [
    release.StakingContractsV3[0][0], // pause staking
    release.StakingContractsV3[1][0], // pause staking
    release.ForeignBridge, // prevent from using
    release.StakersDistribution, //set GOOD rewards to 0
    release.Identity, // set locked G$ accounts as blacklisted
    release.Identity, // set locked G$ accounts as blacklisted
    release.Identity, // set locked G$ accounts as blacklisted
    release.MpbBridge, // mpb upgrade
    release.ForeignBridge, // claim bridge tokens - requires Fuse to set us as upgradeabilityOwner
    release.MpbBridge, // claim bridge tokens
    release.GoodDollar, // burn tokens
    release.Controller //minting rigts to our bridge
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "pause(bool)",
    "pause(bool)",
    "setExecutionDailyLimit(uint256)", // set limit to 0 so old bridge cant be used
    "setMonthlyReputationDistribution(uint256)",
    "addBlacklisted(address)",
    "addBlacklisted(address)",
    "addBlacklisted(address)",
    "upgradeTo(address)",
    "claimTokens(address,address)",
    "withdraw(address,uint256)",
    "burn(uint256)",
    "registerScheme(address,bytes32,bytes4,address)" //make sure mpb is a registered scheme so it can mint G$ tokens
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["bool"], [true]),
    ethers.utils.defaultAbiCoder.encode(["bool"], [true]),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
    ethers.utils.defaultAbiCoder.encode(["address"], ["0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d"]),
    ethers.utils.defaultAbiCoder.encode(["address"], ["0xeC577447D314cf1e443e9f4488216651450DBE7c"]),
    ethers.utils.defaultAbiCoder.encode(["address"], ["0x6738fA889fF31F82d9Fe8862ec025dbE318f3Fde"]),
    ethers.utils.defaultAbiCoder.encode(["address"], [mpbImplementation]),
    ethers.utils.defaultAbiCoder.encode(["address", "address"], [release.GoodDollar, release.Avatar]),
    ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [release.GoodDollar, 0]),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [totalToBurn]),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [
        release.MpbBridge, //scheme
        ethers.constants.HashZero, //paramshash
        "0x00000001", //permissions - minimal
        release.Avatar
      ]
    )
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
    const finalSupply = await gd.totalSupply();
    const burnOk = finalSupply.add(totalToBurn).eq(startSupply);
    console.log("Burn check:", burnOk ? "Success" : "Failed");
    const locked = await ethers.getImpersonatedSigner("0xeC577447D314cf1e443e9f4488216651450DBE7c");
    const tx = await gd
      .connect(locked)
      .burn("10", { maxFeePerGas: 10e9, maxPriorityFeePerGas: 1e9, gasLimit: 200000 })
      .then(_ => _.wait())
      .then(_ => _.status !== 1)
      .catch(e => true);
    console.log("Burn tx check after:", tx);
  }
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

  const ctrl = await ethers.getContractAt("Controller", release.Controller);

  console.log({ networkEnv, mpbImplementation, guardian: guardian.address, isSimulation, isProduction });
  const proposalContracts = [
    release.HomeBridge, // prevent from using
    release.MpbBridge, // upgrade
    release.Controller, // set mpb as minter = add as scheme
    release.GoodDollarMintBurnWrapper //remove bridge minting rights via wrapper
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setExecutionDailyLimit(uint256)", // set limit to 0 so old bridge cant be used
    "upgradeTo(address)", //upgrade mpb bridge
    "registerScheme(address,bytes32,bytes4,address)", //make sure mpb is a registered scheme so it can mint G$ tokens
    "revokeRole(bytes32,address)" // mpb is now lock/unlock doesnt need minting
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
    ethers.utils.defaultAbiCoder.encode(["address"], [mpbImplementation]),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [
        release.MpbBridge, //scheme
        ethers.constants.HashZero, //paramshash
        "0x00000001", //permissions - minimal
        release.Avatar
      ]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address"],
      [ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE")), release.MpbBridge]
    )
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
    // const isMintBurnwRapperScheme = await ctrl.isSchemeRegistered(release.GoodDollarMintBurnWrapper, release.Avatar);
    console.log("MPB scheme registration check:", isMPBScheme ? "Success" : "Failed");
    // console.log("MintBurnWrapper scheme de-registration check:", !isMintBurnwRapperScheme ? "Success" : "Failed");
  }
};

export const upgradeCelo = async network => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  let networkEnv = networkName;
  if (isSimulation) networkEnv = network;

  let release: { [key: string]: any } = dao[networkEnv];

  let guardian = root;
  console.log("signer:", root.address);
  //simulate on fork, make sure safe has enough eth to simulate txs
  if (isSimulation) {
    await reset("https://forno.celo.org");

    await root.sendTransaction({ value: ethers.constants.WeiPerEther.mul(3), to: release.Avatar });

    const avatar = await ethers.getImpersonatedSigner(release.Avatar);
    const mentoReserve = await ethers.getContractAt(
      ["function addToken(address) external returns (bool)"],
      release.MentoReserve
    );
    const mentoExchange = await ethers.getContractAt("IBancorExchangeProvider", release.MentoExchangeProvider);
    const eids = await mentoExchange.getExchangeIds();
    if (eids.length > 0) {
      await mentoExchange.connect(avatar).destroyExchange(eids[0], 0);
      // const ctrl = await ethers.getContractAt("Controller", release.Controller);
      // const e = mentoExchange.interface.encodeFunctionData("destroyExchange", [eids[0], 0]);
      // await ctrl.genericCall(mentoExchange.address, e, release.Avatar, 0);
      // console.log("deleted exchage:", eids[0]);
    }
    try {
      await mentoReserve.connect(avatar).addToken(release.CUSD);
      await mentoReserve.connect(avatar).addToken(release.GoodDollar);
    } catch (e) {
      console.log("addToken failed", e);
    }
    const devCUSD = await ethers.getContractAt(
      ["function mint(address,uint) external returns (uint)", "function setValidators(address) external"],
      release.CUSD
    );

    await devCUSD.connect(avatar).setValidators(release.Avatar);
    const mintTX = await (
      await devCUSD.connect(avatar).mint(release.MentoReserve, ethers.utils.parseEther("200000"))
    ).wait();
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({ value: ethers.constants.WeiPerEther.mul(3), to: guardian.address });
  }

  const mpbImplementation = mpbDeployments["42220"].find(_ => _.name === "celo")["MessagePassingBridge_Implementation"]
    .address;
  const locked = [
    "0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d",
    "0xeC577447D314cf1e443e9f4488216651450DBE7c",
    "0x6738fA889fF31F82d9Fe8862ec025dbE318f3Fde"
  ];
  const gd = await ethers.getContractAt("GoodDollar", release.GoodDollar);
  const ethprovider = new ethers.providers.JsonRpcProvider("https://cloudflare-eth.com");
  const fuseprovider = new ethers.providers.JsonRpcProvider("https://rpc.fuse.io");
  const TOTAL_LOCKED = (
    await Promise.all(
      locked.map(_ => gd.connect(ethprovider).attach(dao["production-mainnet"].GoodDollar).balanceOf(_))
    )
  ).reduce((prev, cur) => prev.add(cur), ethers.constants.Zero);
  const TOTAL_SUPPLY_ETH = await gd.connect(ethprovider).attach(dao["production-mainnet"].GoodDollar).totalSupply();
  const TOTAL_SUPPLY_FUSE = await gd.connect(fuseprovider).attach(dao["production"].GoodDollar).totalSupply();
  const TOTAL_MINT_BRIDGE = TOTAL_SUPPLY_ETH.add(TOTAL_SUPPLY_FUSE)
    .sub(TOTAL_LOCKED)
    .mul(ethers.BigNumber.from("10000000000000000"));

  const exchangeParams = [release.CUSD, release.GoodDollar, 0, 0, 0, 0]; //address reserveAsset;address tokenAddress;uint256 tokenSupply;uint256 reserveBalance;uint32 reserveRatio;uint32 exitConribution;

  console.log({
    networkEnv,
    mpbImplementation,
    guardian: guardian.address,
    isSimulation,
    isProduction,
    release
  });

  const mentoUpgrade = await ethers.deployContract("ProtocolUpgradeV4Mento", [release.Avatar]);
  // const distHelper = await upgrades.deployProxy(
  //   await ethers.getContractFactory("CeloDistributionHelper"),
  //   [release.NameService, "0x00851A91a3c4E9a4c1B48df827Bacc1f884bdE28"], //static oracle for uniswap
  //   { initializer: "initialize" }
  // );

  console.log("deployed mentoUpgrade", {
    // distribuitonHelper: distHelper.address,
    mentoUpgrade: mentoUpgrade.address
  });
  const proposalContracts = [
    release.MpbBridge, // upgrade
    release.MpbBridge && release.GoodDollarMintBurnWrapper, // remove minting rights from bridge
    release.MpbBridge && release.GoodDollar, // mint to bridge
    release.GoodDollar, // set mento broker as minter
    release.GoodDollar, // set reserve expansion controller as minter
    release.Controller, // register upgrade contract
    mentoUpgrade.address // create the exchange + set expansion rate
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)",
    "revokeRole(bytes32,address)", // mpb is now lock/unlock doesnt need minting
    "mint(address,uint256)", // mint to bridge
    "addMinter(address)",
    "addMinter(address)",
    "registerScheme(address,bytes32,bytes4,address)",
    "upgrade(address,(address,address,uint256,uint256,uint32,uint32),address,address,address)" //Controller _controller,PoolExchange memory _exchange,address _mentoExchange,address _mentoController, address _distHelper
  ];

  console.log("preparing inputs...");
  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [mpbImplementation]),
    release.MpbBridge &&
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "address"],
        [ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE")), release.MpbBridge]
      ),
    release.MpbBridge &&
      ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [release.MpbBridge, TOTAL_MINT_BRIDGE]),
    ethers.utils.defaultAbiCoder.encode(["address"], [release.MentoBroker]),
    ethers.utils.defaultAbiCoder.encode(["address"], [release.MentoExpansionController]),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [mentoUpgrade.address, ethers.constants.HashZero, "0x0000001f", release.Avatar]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "(address,address,uint256,uint256,uint32,uint32)", "address", "address", "address"],
      [
        release.Controller,
        exchangeParams,
        release.MentoExchangeProvider,
        release.MentoExpansionController,
        release.CeloDistributionHelper
      ]
    )
  ];
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
    console.log("Supply after upgrade:", { supplyAfter, TOTAL_MINT_BRIDGE });

    const ctrl = await ethers.getContractAt("Controller", release.Controller);

    const isBrokerMinter = await gd.isMinter(release.MentoBroker);
    const isExpansionMinter = await gd.isMinter(release.MentoExpansionController);
    const mentoExchange = await ethers.getContractAt("IBancorExchangeProvider", release.MentoExchangeProvider);
    const eids = await mentoExchange.getExchangeIds();
    const exchange = await mentoExchange.getPoolExchange(eids[0]);
    const price = (await mentoExchange.currentPrice(eids[0])) / 1e18;
    console.log("current price:", price);
    console.log("Exchange:", exchange);

    console.log("Broker minter check:", isBrokerMinter ? "Success" : "Failed");
    console.log("Expansion minter check:", isExpansionMinter ? "Success" : "Failed");
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
