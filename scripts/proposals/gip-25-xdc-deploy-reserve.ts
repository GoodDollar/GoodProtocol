// Part 2 Reserve
// upgrade bridge + identity on all networks - V
// upgrade celo exchangeprovider so we can update the params - V
// upgrade celo broker so it can support no in limits - V
// set the new limits on the broker - V
// create uniswap pools on xdc - they exists
// calculate how much G$s each reserve is backing - V
// deploy distribution helper on xdc - V
// set distribution helper on xdc expansion controller - V
// deploy mento contracts on xdc before upgrade
// deploy circuit breakers on xdc/fuse/ethereum/celo before upgrade
// give genericcall permissions to circuit breaker on all networks
// deploy identity v4 on all chains
// create exchange on mento reserve xdc with calculated parameters - V
// give mento broker minting rights on xdc - V
// give expansion controller minting rights - V
// transfer usdc to xdc reserve
// update celo reserve parameters accordingly

import { network, ethers, upgrades } from "hardhat";
import { reset } from "@nomicfoundation/hardhat-network-helpers";
import { defaultsDeep, last } from "lodash";
import prompt from "prompt";
import {
  deployDeterministic,
  executeViaGuardian,
  executeViaSafe,
  verifyContract,
  verifyProductionSigner
} from "../multichain-deploy/helpers";

import dao from "../../releases/deployment.json";
import {
  Controller,
  IBancorExchangeProvider,
  IBroker,
  IdentityV3,
  IGoodDollar,
  IGoodDollarExpansionController,
  IMessagePassingBridge,
  Ownable,
  UBISchemeV2,
  UpdateReserveRatio
} from "../../types";
import releaser from "../releaser";
import { keccak256, toUtf8Bytes } from "ethers/lib/utils";
let { name: networkName } = network;
const isSimulation = network.name === "hardhat" || network.name === "fork" || network.name === "localhost";
const bridgeUpgradeImpl = {
  "production-celo": "0xF3eAB7018d74E7Df95A5d8dC70987C0539bDF48f",
  production: "0xFB62aA509a7B260b6697B671C969a184d6c39E90",
  "production-mainnet": "0x12ab702f015D3302f3cc0c4AbA0626A127D06A07",
  "production-xdc": "0xe4CFA18A3d0a7d77fAA42961ee943c9221d61937"
};
const XDC_INITIAL_USDC = 200000 * 1e6;

export const upgradeCeloStep2 = async (network, checksOnly) => {
  const ExchangeProviderV2Impl = "0xe930CDE20f60d0A4fc9487874861AE259F5Bed48";
  const MentoBrokerV2Impl = "0xc69ae3550E25C7AB28301B9Bf75F20f5AF47B7d2";

  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  if (isProduction) verifyProductionSigner(root);

  let networkEnv = networkName;
  let guardian = root;
  if (isSimulation) {
    networkEnv = network;
  }

  let release: { [key: string]: any } = dao[networkEnv];

  console.log("signer:", root.address, { networkEnv, isSimulation, isProduction, release });

  if (isSimulation) {
    networkEnv = network;
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({
      value: ethers.utils.parseEther("1"),
      to: release.GuardiansSafe
    });
  }

  const identityImpl = await ethers.deployContract("IdentityV3");
  const reserveUpdate = (await deployDeterministic(
    { name: "UpdateReserveRatio" },
    [root.address],
    {},
    false,
    networkEnv
  )) as UpdateReserveRatio;

  const bridgeImpl = bridgeUpgradeImpl[networkEnv];

  // Extract the first four bytes as the function selector
  console.log("deployed new impls", { identityImpl: identityImpl.address });

  const proposalActions = [
    [
      release.MentoProxyAdmin,
      "upgrade(address,address)",
      ethers.utils.defaultAbiCoder.encode(
        ["address", "address"],
        [release.MentoExchangeProvider, ExchangeProviderV2Impl]
      ),
      "0"
    ],
    [
      release.MentoProxyAdmin,
      "upgrade(address,address)",
      ethers.utils.defaultAbiCoder.encode(["address", "address"], [release.MentoBroker, MentoBrokerV2Impl]),
      "0"
    ],
    [
      release.MentoBroker,
      "configureTradingLimit(bytes32,address,(uint32,uint32,int48,int48,int48,int48,int48,uint8))",
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "address", "tuple(uint32,uint32,int48,int48,int48,int48,int48,uint8)"],
        [
          release.CUSDExchangeId,
          release.CUSD,
          [7 * 86400, 30 * 86400, 140737488355326, 40000, 140737488355327, 80000, 0, 3]
        ]
      ),
      "0"
    ],
    [
      release.Identity,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [identityImpl.address]),
      "0"
    ], //upgrade identity
    [release.MpbBridge, "upgradeTo(address)", ethers.utils.defaultAbiCoder.encode(["address"], [bridgeImpl]), "0"], //upgrade bridge
    [
      release.Controller,
      "registerScheme(address,bytes32,bytes4,address)",
      ethers.utils.defaultAbiCoder.encode(
        ["address", "bytes32", "bytes4", "address"],
        [reserveUpdate.address, ethers.constants.HashZero, "0x00000010", release.Avatar]
      ),
      "0"
    ] //give generic call rights to update reserve ratio
  ];

  console.log({
    networkEnv,
    guardian: guardian.address,
    isSimulation,
    isProduction,
    release
  });

  const proposalContracts = proposalActions.map(a => a[0]);
  const proposalFunctionSignatures = proposalActions.map(a => a[1]);
  const proposalFunctionInputs = proposalActions.map(a => a[2]);
  const proposalEthValues = proposalActions.map(a => a[3]);
  if (isProduction && !checksOnly) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "celo"
    );
  } else if (!checksOnly) {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv
    );
  }

  if (!isProduction && isSimulation) {
    const exchange = (await ethers.getContractAt(
      "IBancorExchangeProvider",
      release.MentoExchangeProvider
    )) as IBancorExchangeProvider;

    const reserveParams = await calculateReserveParams();
    const reserveUpdateResult = await (
      await reserveUpdate.upgrade(
        release.Controller,
        release.MentoExchangeProvider,
        release.CUSDExchangeId,
        reserveParams.reserveRatioCelo,
        reserveParams.celoSupply,
        reserveParams.celoGdSupplyEquivalent
      )
    ).wait();
    console.log("Exchange after update", await exchange.getPoolExchange(release.CUSDExchangeId));
    console.log("Price:", await exchange.currentPrice(release.CUSDExchangeId));
  }
};

export const upgradeFuseStep2 = async (network, checksOnly) => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  if (isProduction) verifyProductionSigner(root);

  let networkEnv = networkName;
  let guardian = root;
  if (isSimulation) {
    networkEnv = network;
  }

  let release: { [key: string]: any } = dao[networkEnv];

  console.log("signer:", root.address, { networkEnv, isSimulation, isProduction, release });

  if (isSimulation) {
    networkEnv = network;
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({
      value: ethers.utils.parseEther("1"),
      to: release.GuardiansSafe
    });
  }

  const identityImpl = await ethers.deployContract("IdentityV3");
  const bridgeImpl = bridgeUpgradeImpl[networkEnv];

  // Extract the first four bytes as the function selector
  console.log("deployed new impls", { identityImpl: identityImpl.address });

  const proposalActions = [
    [
      release.Identity,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [identityImpl.address]),
      "0"
    ], //upgrade identity
    [release.MpbBridge, "upgradeTo(address)", ethers.utils.defaultAbiCoder.encode(["address"], [bridgeImpl]), "0"] //upgrade bridge
  ];

  console.log({
    networkEnv,
    guardian: guardian.address,
    isSimulation,
    isProduction,
    release
  });

  const proposalContracts = proposalActions.map(a => a[0]);
  const proposalFunctionSignatures = proposalActions.map(a => a[1]);
  const proposalFunctionInputs = proposalActions.map(a => a[2]);
  const proposalEthValues = proposalActions.map(a => a[3]);
  if (isProduction && !checksOnly) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "fuse"
    );
  } else if (!checksOnly) {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv
    );
  }
};

export const upgradeEthStep2 = async (network, checksOnly) => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  if (isProduction) verifyProductionSigner(root);

  let networkEnv = networkName;
  let guardian = root;
  if (isSimulation) {
    networkEnv = network;
  }

  let release: { [key: string]: any } = dao[networkEnv];

  console.log("signer:", root.address, { networkEnv, isSimulation, isProduction, release });

  if (isSimulation) {
    networkEnv = network;
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({
      value: ethers.utils.parseEther("1"),
      to: release.GuardiansSafe
    });
  }

  const bridgeImpl = bridgeUpgradeImpl[networkEnv];

  const proposalActions = [
    [release.MpbBridge, "upgradeTo(address)", ethers.utils.defaultAbiCoder.encode(["address"], [bridgeImpl]), "0"] //upgrade bridge
  ];

  console.log({
    networkEnv,
    guardian: guardian.address,
    isSimulation,
    isProduction,
    release
  });

  const proposalContracts = proposalActions.map(a => a[0]);
  const proposalFunctionSignatures = proposalActions.map(a => a[1]);
  const proposalFunctionInputs = proposalActions.map(a => a[2]);
  const proposalEthValues = proposalActions.map(a => a[3]);
  if (isProduction && !checksOnly) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "mainnet"
    );
  } else if (!checksOnly) {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv
    );
  }
};

export const upgradeXdcStep2 = async (network, checksOnly) => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  if (isProduction) verifyProductionSigner(root);

  let networkEnv = networkName;
  let guardian = root;
  if (isSimulation) {
    networkEnv = network;
  }

  const celoNetwork = networkEnv.split("-")[0] + "-celo";
  let release: { [key: string]: any } = dao[networkEnv];

  console.log("signer:", root.address, { networkEnv, isSimulation, isProduction, release, celoNetwork });

  if (isSimulation) {
    networkEnv = network;
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({
      value: ethers.utils.parseEther("1"),
      to: release.GuardiansSafe
    });
  }

  console.log({
    networkEnv,
    guardian: guardian.address,
    isSimulation,
    isProduction,
    release
  });

  const identityImpl = await ethers.deployContract("IdentityV3");
  const bridgeImpl = bridgeUpgradeImpl[networkEnv];
  console.log("deploying dist helper");

  const DistHelper = await deployDeterministic(
    {
      name: "DistributionHelper",
      factory: await ethers.getContractFactory("GenericDistributionHelper"),
      isUpgradeable: true
    },
    [
      release.NameService,
      release.StaticOracle,
      release.WXDC,
      release.ReserveToken,
      release.UniswapV3Router,
      [ethers.utils.parseEther("20"), ethers.utils.parseEther("20"), 5, 5]
    ],
    {},
    false,
    networkEnv
  );

  const exchangeId = keccak256(ethers.utils.solidityPack(["string", "string"], ["USDC", "G$"]));

  const torelease = {
    DistributionHelper: DistHelper.address,
    USDCEXchangeId: exchangeId
  };
  release = {
    ...release,
    ...torelease
  };
  await releaser(torelease, networkName, "deployment", false);

  console.log({ exchangeId });
  const reserveParams = undefined;

  const proposalActions = [
    [release.MpbBridge, "upgradeTo(address)", ethers.utils.defaultAbiCoder.encode(["address"], [bridgeImpl]), "0"], //upgrade bridge
    [
      release.Identity,
      "upgradeTo(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [identityImpl.address]),
      "0"
    ], //upgrade identity
    [
      release.NameService, //nameservice
      "setAddresses(bytes32[],address[])", //add ubischeme
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32[]", "address[]"],
        [
          [keccak256(toUtf8Bytes("DISTRIBUTION_HELPER")), keccak256(toUtf8Bytes("MPBBRIDGE_CONTRACT"))],
          [DistHelper.address, release.MpbBridge]
        ]
      ),
      0
    ],
    [
      DistHelper.address,
      "addOrUpdateRecipient((uint32,uint32,address,uint8))",
      ethers.utils.defaultAbiCoder.encode(
        ["uint32", "uint32", "address", "uint8"],
        [dao[celoNetwork].CommunitySafe ? 9000 : 10000, release.networkId, release.UBIScheme, 1] //90% to ubi scheme
      ),
      0
    ],
    [
      release.MentoExpansionController,
      "setDistributionHelper(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [DistHelper.address]),
      "0"
    ],
    [
      release.MentoExchangeProvider,
      "createExchange((address,address,uint256,uint256,uint32,uint32))",
      ethers.utils.defaultAbiCoder.encode(
        ["tuple(address, address, uint256, uint256, uint32, uint32)"],
        [
          [
            release.ReserveToken,
            release.GoodDollar,
            reserveParams.xdcGdSupplyEquivalent,
            XDC_INITIAL_USDC,
            reserveParams.reserveRatioXdc,
            10000000
          ]
        ]
      ),
      "0"
    ],
    [
      release.GoodDollar,
      "addMinter(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [release.MentoBroker]),
      "0"
    ], //give minting rights to broker
    [
      release.GoodDollar,
      "addMinter(address)",
      ethers.utils.defaultAbiCoder.encode(["address"], [release.MentoExpansionController]),
      "0"
    ] //give minting rights to expansion controller
  ];

  if (dao[celoNetwork].CommunitySafe) {
    proposalActions.push([
      DistHelper.address,
      "addOrUpdateRecipient((uint32,uint32,address,uint8))",
      ethers.utils.defaultAbiCoder.encode(
        ["uint32", "uint32", "address", "uint8"],
        [1000, 42220, dao[celoNetwork].CommunitySafe, networkName === celoNetwork ? 1 : 0] //10% to celo community safe, use LZ bridge if not on celo
      ),
      0
    ]);
  }

  const proposalContracts = proposalActions.map(a => a[0]);
  const proposalFunctionSignatures = proposalActions.map(a => a[1]);
  const proposalFunctionInputs = proposalActions.map(a => a[2]);
  const proposalEthValues = proposalActions.map(a => a[3]);
  if (isProduction && !checksOnly) {
    await executeViaSafe(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      release.GuardiansSafe,
      "xdc"
    );
  } else if (!checksOnly) {
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      guardian,
      networkEnv,
      false
    );
  }

  if (!isProduction && isSimulation) {
    const swapper = networkEnv.includes("production")
      ? await ethers.getImpersonatedSigner("0x66582D24FEaD72555adaC681Cc621caCbB208324")
      : root;
    const USDC_AMOUNT = 5000e6;
    const usdc = await ethers.getContractAt("IERC20", release.USDC);
    const usdcSwapper = await ethers.getImpersonatedSigner("0xD0Ad6BC1c9E6fd9fC1Be1d674109E1AFcC78B058");
    await usdc.connect(usdcSwapper).transfer(swapper.address, 10000e6);
    const gd = (await ethers.getContractAt("IGoodDollar", release.GoodDollar)) as IGoodDollar;
    const isBrokerMinter = await gd.isMinter(release.MentoBroker);
    const isExpansionMinter = await gd.isMinter(release.MentoExpansionController);
    const mentoExchange = (await ethers.getContractAt(
      "IBancorExchangeProvider",
      release.MentoExchangeProvider
    )) as IBancorExchangeProvider;
    const mentoBroker = (await ethers.getContractAt("IBroker", release.MentoBroker)) as IBroker;
    // const eids = await mentoExchange.getExchangeIds();
    const eids = ["0xf8d028730f58a008390c265fca425bb912e4c7efa370d4cef756a06f5029acd2"];
    const exchange = await mentoExchange.getPoolExchange(eids[0]);
    const price = (await mentoExchange.currentPrice(eids[0])).toNumber() / 1e6;
    console.log("current price:", price, await mentoExchange.currentPrice(eids[0]));
    console.log("Exchange:", exchange, eids[0]);

    console.log("Broker minter check:", isBrokerMinter ? "Success" : "Failed");
    console.log("Expansion minter check:", isExpansionMinter ? "Success" : "Failed");
    await gd.connect(swapper).approve(release.MentoBroker, ethers.utils.parseEther("10000"));
    console.log("balance before G$ swap:", await gd.balanceOf(swapper.address), await usdc.balanceOf(swapper.address));
    const shouldFail = await mentoBroker
      .connect(swapper)
      .swapIn(mentoExchange.address, eids[0], gd.address, usdc.address, ethers.utils.parseEther("10000"), 0)
      .then(_ => _.wait())
      .catch(e => e.message);
    console.log("initial gd swap should fail:", shouldFail);
    console.log(
      "balance before usdc swap:",
      await gd.balanceOf(swapper.address),
      await usdc.balanceOf(swapper.address)
    );
    await usdc.connect(swapper).approve(release.MentoBroker, USDC_AMOUNT);
    await mentoBroker
      .connect(swapper)
      .swapIn(mentoExchange.address, eids[0], usdc.address, gd.address, USDC_AMOUNT, 0)
      .then(_ => _.wait());
    console.log(
      "Balance after swap:",
      swapper.address,
      await gd.balanceOf(swapper.address),
      await usdc.balanceOf(swapper.address)
    );
    console.log("price after swap:", (await mentoExchange.currentPrice(eids[0])).toNumber() / 1e6);

    const mentomint = (await ethers.getContractAt(
      "IGoodDollarExpansionController",
      release.MentoExpansionController
    )) as IGoodDollarExpansionController;
    await usdc.connect(swapper).approve(mentomint.address, USDC_AMOUNT);
    const tx = await (await mentomint.connect(swapper).mintUBIFromInterest(eids[0], USDC_AMOUNT)).wait();
    console.log(
      "mint from interest:",
      tx.events.find(_ => _.event === "InterestUBIMinted").args.amount.toString() / 1e18
    );
    console.log("price after interest mint:", (await mentoExchange.currentPrice(eids[0])).toNumber() / 1e6);
    const distTx = await (await DistHelper.onDistribution(0, { gasLimit: 4000000 })).wait();
    const { distributionRecipients, distributed } = distTx.events.find(_ => _.event === "Distribution").args;
    console.log(
      "Distribution events:",
      distributionRecipients,
      distributed,
      distTx.events.length,
      distTx.events.map(_ => _.address)
    );
  }
};

const calculateReserveParams = async () => {
  // hacker and hacked multichain bridge accounts
  const LOCKED_ACCOUNTS = [
    "0xeC577447D314cf1e443e9f4488216651450DBE7c",
    "0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d",
    "0x6738fA889fF31F82d9Fe8862ec025dbE318f3Fde"
  ];

  const celoProvider = new ethers.providers.JsonRpcProvider("https://forno.celo.org");
  const xdcProvider = new ethers.providers.JsonRpcProvider("https://rpc.ankr.com/xdc");
  const fuseProvider = new ethers.providers.JsonRpcProvider("https://rpc.fuse.io");
  const ethProvider = new ethers.providers.JsonRpcProvider("https://eth.drpc.org");
  const gdCelo = (await ethers.getContractAt("GoodDollar", dao["production-celo"].GoodDollar)).connect(celoProvider);
  const gdXdc = (await ethers.getContractAt("GoodDollar", dao["production-xdc"].GoodDollar)).connect(xdcProvider);
  const gdFuse = (await ethers.getContractAt("GoodDollar", dao["production"].GoodDollar)).connect(fuseProvider);
  const gdEth = (await ethers.getContractAt("GoodDollar", dao["production-mainnet"].GoodDollar)).connect(ethProvider);
  const celoCusd = (await ethers.getContractAt("IERC20", dao["production-celo"].CUSD)).connect(celoProvider);
  const celoSupply = await gdCelo.totalSupply();
  const totalSupply = [
    await gdCelo.totalSupply(),
    await gdXdc.totalSupply(),
    (await gdFuse.totalSupply()).mul(ethers.utils.parseEther("0.01")), //scale to 18 decimals
    (await gdEth.totalSupply()).mul(ethers.utils.parseEther("0.01"))
  ].reduce((acc, cur) => acc.add(cur), ethers.constants.Zero);
  const lockedFunds = await Promise.all(LOCKED_ACCOUNTS.map(_ => gdEth.balanceOf(_)));
  const totalLocked = lockedFunds
    .reduce((acc, cur) => acc.add(cur), ethers.constants.Zero)
    .mul(ethers.utils.parseEther("0.01")); //scale to 18 decimals
  const realSupply = totalSupply.sub(totalLocked);
  const reserveBalance = await celoCusd.balanceOf(dao["production-celo"].MentoReserve);
  const xdcReserveBalance = ethers.utils.parseUnits("200000", 18); //200k in xdc
  const totalUSD = reserveBalance.add(xdcReserveBalance); //reserve + 200k in xdc
  const xdcSupplyShare = xdcReserveBalance.mul(ethers.constants.WeiPerEther).div(totalUSD);
  const xdcGdSupplyEquivalent = realSupply.mul(xdcSupplyShare).div(ethers.constants.WeiPerEther);
  const price = ethers.utils.parseUnits("0.0001283", 18);
  const celoGdSupplyEquivalent = realSupply.sub(xdcGdSupplyEquivalent);

  console.log({
    totalSupply,
    totalLocked,
    realSupply,
    reserveBalance,
    totalUSD,
    xdcSupplyShare,
    xdcGdSupplyEquivalent,
    celoGdSupplyEquivalent
  });

  // uint32 reserveRatio = uint32(
  // 		(cUSDBalance * 1e18 * 1e8) / (price * totalGlobalSupply)
  // 	);
  //calculate reserve ratio
  const reserveRatioXdc = xdcReserveBalance
    .mul(ethers.constants.WeiPerEther) //1e8
    .mul(ethers.constants.WeiPerEther) //1e18
    .div(xdcGdSupplyEquivalent.mul(price));
  console.log(
    "recommended reserve ratio for xdc:",
    reserveRatioXdc.toString(),
    reserveRatioXdc.div(ethers.constants.WeiPerEther).toNumber() / 1e8
  );

  //calcualte reserve ratio for celo
  const reserveRatioCelo = reserveBalance
    .mul(ethers.constants.WeiPerEther) //1e8
    .mul(ethers.constants.WeiPerEther) //1e18
    .div(celoGdSupplyEquivalent.mul(price));

  console.log(
    "recommended reserve ratio for celo:",
    reserveRatioCelo.toString(),
    reserveRatioCelo.div(ethers.constants.WeiPerEther).toNumber() / 1e18
  );

  const normalizedRatioXdc = reserveRatioXdc.div("10000000000"); //reduce to 1e8 basis points
  const normalizedRatioCelo = reserveRatioCelo.div("10000000000"); //reduce to 1e8 basis points
  return {
    celoSupply,
    reserveRatioXdc: normalizedRatioXdc,
    xdcGdSupplyEquivalent,
    reserveRatioCelo: normalizedRatioCelo,
    celoGdSupplyEquivalent
  };
};

export const main = async () => {
  // await calculateReserveParams();
  // return;
  prompt.start();
  const { network } = await prompt.get(["network"]);

  console.log("running step:", { network });
  const chain = last(network.split("-")) || "fuse";
  console.log("detected chain:", chain, network);
  switch (chain) {
    case "mainnet":
      await upgradeEthStep2(network, false);

      break;
    case "production":
    case "fuse":
      await upgradeFuseStep2(network, false);

      break;
    case "celo":
      await upgradeCeloStep2(network, false);

      break;
    case "xdc":
      await upgradeXdcStep2(network, false);
      break;
  }
};

main().catch(console.log);
