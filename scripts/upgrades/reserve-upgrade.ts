/***
 * Upgrade Reserve to fix distribution bug and use only disthelper for distribution
 * Upgrade fundmanager to allow minting of ubi even without collecting interest, removing ubi distribution
 * Upgrade distribution helper to work with new bridge replacing multichain
 * Upgrade Plan:
 * - deploy new impl, fund manager, distribution helper
 * - call disthelper updateAddresses
 * - create guardians safe proposal to upgrade reserve + fundmanager + distribution helper
 * - create guardians safe proposal to call setGDXDisabled (optional)
 * - create guardians safe proposal to set the new distribution helper amounts  * ** THIS SHOULD BE DONE ONLY AFTER BRIDGE WAS DEPLOYED **
 * - create guardians safe proposal to set the disthelper fee settings
 */

/** NOTICE **/
/**
 * To test it on a fork make sure to first deploy the messagepassingbridge @gooddollar/GoodBridge deployMessagePassingBridge.ts
 * to the same fork
 */
import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";

import {
  deployDeterministic,
  printDeploy,
  executeViaGuardian,
  executeViaSafe,
  verifyProductionSigner
} from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
import { verifyContract } from "../multichain-deploy/helpers";
import { IStaticOracle } from "../../types";
let { name: networkName } = network;

export const upgrade = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let guardian = root;

  //simulate produciton on fork
  if (network.name === "hardhat" || network.name === "fork") {
    networkName = "production-mainnet";
  }

  let release: { [key: string]: any } = dao[networkName];
  let protocolSettings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

  //simulate on fork, make sure safe has enough eth to simulate txs
  if (network.name === "hardhat" || network.name === "fork") {
    guardian = await ethers.getImpersonatedSigner(protocolSettings.guardiansSafe);
    networkName = "production-mainnet";

    await root.sendTransaction({ value: ethers.constants.WeiPerEther.mul(3), to: protocolSettings.guardiansSafe });
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

  let networkEnv = networkName.split("-")[0];
  const fuseNetwork = networkEnv;
  if (networkEnv === "fuse") networkEnv = "development";
  const celoNetwork = networkEnv + "-celo";

  console.log("deploying new implementatios...");

  let newReserveImpl = (await ethers.deployContract("GoodReserveCDai").then(printDeploy)) as Contract;
  let newFundmanagerImpl = (await ethers.deployContract("GoodFundManager").then(printDeploy)) as Contract;
  let newDisthelperImpl = (await ethers.deployContract("DistributionHelper").then(printDeploy)) as Contract;

  if (isProduction) {
    await verifyContract(newReserveImpl, "GoodReserveCDai", networkName);
    await verifyContract(newFundmanagerImpl, "GoodFundManager", networkName);
    await verifyContract(newDisthelperImpl, "DistributionHelper", networkName);
  }

  // make sure price oracle for fuse/celo/eth has enough observations
  console.log("preparing price oracle...");
  const oracle = (await ethers.getContractAt(
    "IStaticOracle",
    "0xB210CE856631EeEB767eFa666EC7C1C57738d438"
  )) as IStaticOracle;
  const [celoPool] = await oracle.callStatic.prepareSpecificFeeTiersWithTimePeriod(
    await newDisthelperImpl.CELO_TOKEN(),
    await newDisthelperImpl.WETH_TOKEN(),
    [3000],
    60
  );
  const [fusePool] = await oracle.callStatic.prepareSpecificFeeTiersWithTimePeriod(
    await newDisthelperImpl.FUSE_TOKEN(),
    await newDisthelperImpl.WETH_TOKEN(),
    [3000],
    60
  );
  const [usdcPool] = await oracle.callStatic.prepareSpecificFeeTiersWithTimePeriod(
    await newDisthelperImpl.USDC_TOKEN(),
    await newDisthelperImpl.WETH_TOKEN(),
    [3000],
    60
  );

  const pool = await ethers.getContractAt(
    [
      "function slot0() view returns (uint160 sqrtPriceX96,int24 sqrtPriceX96,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)"
    ],
    celoPool
  );
  const validPools: Array<[string, boolean]> = await Promise.all(
    [celoPool, fusePool, usdcPool].map(async _ => {
      const { observationCardinalityNext } = await pool.attach(_).slot0();
      return [_, observationCardinalityNext < 5];
    })
  );

  console.log({ celoPool, fusePool, usdcPool, validPools });
  await oracle
    .prepareSpecificPoolsWithTimePeriod(
      validPools.filter(_ => _[1]).map(_ => _[0]),
      60
    )
    .then(printDeploy);

  console.log("executing proposals");

  const proposalContracts = [
    release.GoodReserveCDai, //controller -> upgrade reserve
    release.GoodFundManager, //controller -> upgrade fundmanager
    release.DistributionHelper, //controller -> upgrade disthelper
    release.DistributionHelper, //update addresses
    release.DistributionHelper, //set fee settings
    release.DistributionHelper, //remove distribution to guardians
    release.DistributionHelper, //remove distribution to community pool on fuse
    release.DistributionHelper, //set new distribution params
    release.DistributionHelper, //set new distribution params
    release.DistributionHelper, //set new distribution params
    release.DistributionHelper, //set new distribution params
    release.GoodReserveCDai // call setGDXDisabled
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeTo(address)", //upgrade reserve
    "upgradeTo(address)", //upgrade fundmanager
    "upgradeTo(address)", //upgrade disthelper
    "updateAddresses()", //upgrade disthelper
    "setFeeSettings((uint128,uint128,uint128,uint128,uint128,uint8))",
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // remove guardians distribution
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // remove fuse community distribution
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // fuse distribution
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // celo distribution
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // community pool distribution on celo
    "addOrUpdateRecipient((uint32,uint32,address,uint8))", // savings rewards distribution
    "setGDXDisabled(bool,bool)"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address"], [newReserveImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [newFundmanagerImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [newDisthelperImpl.address]),
    ethers.constants.HashZero,
    //uint128 axelarBaseFeeUSD;uint128 bridgeExecuteGas;uint128 targetChainGasPrice;uint128 maxFee;uint128 minBalanceForFees;uint8 percentageToSellForFee;
    //0.1$ base fee, 400000 bridge execute, 5 gwei gas price, 5e15 eth max fee, min balance 1e16, percentage 5%
    ethers.utils.defaultAbiCoder.encode(
      ["uint128", "uint128", "uint128", "uint128", "uint128", "uint8"],
      ["100000000000000000", "400000", "5000000000", "5000000000000000", "10000000000000000", "5"]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [0, 1, dao[networkName].GuardiansSafe, 3] //0% to guardians (contract transfer)
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [0, 122, dao[fuseNetwork].CommunitySafe, 0] //0% to guardians (contract transfer)
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [1000, 122, dao[fuseNetwork].UBIScheme, 0] //10% chainId 122 ubischeme 0-fuse bridge
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [7000, 42220, dao[celoNetwork].UBIScheme, 2] //70% chainId 42220 ubischeme 2-axelar bridge
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [1000, 42220, dao[celoNetwork].GoodDollarMintBurnWrapper, 2] //10% chainId 42220 mintburnwrapper 2-axelar bridge
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [1000, 42220, dao[celoNetwork].CommunitySafe, 2] //10% chainId 42220 community treasury 2-axelar bridge
    ),
    ethers.utils.defaultAbiCoder.encode(["bool", "bool"], [false, false])
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

  //perform sanity checks
  let fm = await ethers.getContractAt("GoodFundManager", release.GoodFundManager);
  let dh = await ethers.getContractAt("DistributionHelper", release.DistributionHelper);
  let r = await ethers.getContractAt("GoodReserveCDai", release.GoodReserveCDai);

  console.log(await dh.distributionRecipients(0));
  console.log(await dh.distributionRecipients(1));
  console.log(await dh.distributionRecipients(2));
  console.log(await dh.distributionRecipients(3));
  console.log(await dh.distributionRecipients(4));
  console.log(await dh.distributionRecipients(5));

  console.log("gdx/discount disabled", await r.gdxDisabled(), await r.discountDisabled());
  if (isProduction) {
    let tx = await fm.callStatic.collectInterest([], false);
    console.log(tx);
  } else {
    let tx = await (await fm.collectInterest([], false)).wait();
    console.log(tx.events);
  }
};

export const main = async () => {
  await upgrade().catch(console.log);
};
if (process.argv[1].includes("reserve-upgrade")) main();
