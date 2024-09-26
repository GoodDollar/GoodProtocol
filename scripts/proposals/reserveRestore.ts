/***
 * Mainnet:
 * FIXES:
 *  - prevent hacked funds burnFrom
 *  - set GOOD rewards to 0
 *  - prevent untrusted contracts in goodfundmanager
 *  - use bonding curve for actual cDAI balance (prevent the "buy" instead of "transferTo" used in hack to trick reserve into minting UBI from interest)
 *  - set exit contribution to 10%
 *  - disable gdx
 * 
 * PLAN:
 *  - pause staking
 *  - prevent fusebridge usage
 *  - set GOOD rewards to 0
 *  - blacklist hacked accounts to prevent burn (transfer already blocked done via tax)
 *  - withdraw funds from fuse
 *  - transfer to MPB bridge
 *  - upgrade reserve
 *    - set new reserve ratio, supply(minus hacked funds) and reserve
 *    - set contribution to 10%
 *    - unpause reserve
 *  - upgrade exchangeHelper
 *  - upgrade goodfundmanager
 *  - unpause reserve
 *  - unpause goodfundmanager
 * 
 *
 * Fuse:
 * PLAN:
 *  - prevent old fuse bridge usage
 *  - give minting rights to the MPB (by adding it as scheme)
 *  - remove mint rights to bridge given through mintburnwrapper
 *
 **/

import { network, ethers } from "hardhat";
import { reset, time } from "@nomicfoundation/hardhat-network-helpers";
import { defaultsDeep, last } from "lodash";
import prompt from "prompt";
// import mpbDeployments from "@gooddollar/bridge-contracts/release/mpb.json"

import { executeViaGuardian, executeViaSafe, verifyProductionSigner } from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";
import { Controller, ExchangeHelper, GoodFundManager, GoodMarketMaker, GoodReserveCDai, IGoodDollar } from "../../types";
import { ubi } from "../../types/contracts";
import { kill } from "process";
let { name: networkName } = network;

// // TODO: import from bridge-contracts package
// const mpbDeployments = {
//   "1": [
//     { name: "mainnet", MessagePassingBridge_Implementation: { address: "0xF19fB90fA4DDb67C330B41AD4D64ef75B9d8Cd33" } }
//   ],
//   "122": [
//     { name: "fuse", MessagePassingBridge_Implementation: { address: "0xd3B5BfDacb042a89bbABAd2376Aa1a923B365a14" } }
//   ],
//   "42220": [
//     { name: "celo", MessagePassingBridge_Implementation: { address: "0x691dE730D97d545c141D13ED5e9c12b7cB384a73" } }
//   ]
// };

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
    await reset("https://eth.drpc.org");
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

  const reserveImpl = await ethers.deployContract("GoodReserveCDai");
  const goodFundManagerImpl = await ethers.deployContract("GoodFundManager");
  const exchangeHelperImpl = await ethers.deployContract("ExchangeHelper");
  const stakersDistImpl = await ethers.deployContract("StakersDistribution");
  const govImpl = await ethers.deployContract("CompoundVotingMachine");
  const distHelperImplt = await ethers.deployContract("DistributionHelper");
  const marketMakerImpl = await ethers.deployContract("GoodMarketMaker");
  const upgradeImpl = await ethers.deployContract("ReserveRestore", [release.NameService]);

  const gd = (await ethers.getContractAt("IGoodDollar", release.GoodDollar)) as IGoodDollar;

  // test blacklisting to prevent burn by hacker
  if (isSimulation) {

    const locked = await ethers.getImpersonatedSigner("0xeC577447D314cf1e443e9f4488216651450DBE7c");
    const tx = await gd
      .connect(locked)
      .burn("10")
      .then(_ => _.wait())
      .then(_ => _.status)
      .catch(e => e);

    console.log("Burn tx before:", tx);

    const whale = await ethers.getImpersonatedSigner("0xa359Fc83C48277EedF375a5b6DC9Ec7D093aD3f2")
    const dai = await ethers.getContractAt("IGoodDollar", release.DAI)
    await dai.connect(whale).transfer(upgradeImpl.address, ethers.utils.parseEther("200000"))
    await dai.connect(whale).transfer(root.address, ethers.utils.parseEther("100000"))

    const lockedFunds = await Promise.all([gd.balanceOf("0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d"), gd.balanceOf("0xeC577447D314cf1e443e9f4488216651450DBE7c"), gd.balanceOf("0x6738fA889fF31F82d9Fe8862ec025dbE318f3Fde")])
    const totalLocked = lockedFunds.reduce((acc, cur) => acc.add(cur), ethers.constants.Zero)
    console.log({ totalLocked })

  }

  const startSupply = await gd.totalSupply();


  console.log("executing proposals");

  const proposalContracts = [
    release.StakingContractsV3[0][0], // pause staking
    release.StakingContractsV3[1][0], // pause staking
    release.StakersDistribution, //set GOOD rewards to 0
    release.GoodReserveCDai,
    release.ForeignBridge, // prevent from using
    release.Identity, // set locked G$ accounts as blacklisted so cant do burn from
    release.Identity, // set locked G$ accounts as blacklisted so cant do burn from
    release.Identity, // set locked G$ accounts as blacklisted so cant do burnfrom
    release.ForeignBridge, // claim bridge tokens to mpb bridge
    release.GoodReserveCDai, //upgrade reserve
    release.GoodFundManager,  //upgrade fundmanager
    release.ExchangeHelper, //upgrade exchangehelper
    release.DistributionHelper, //upgrade disthelper
    release.StakersDistribution, //upgrade stakers dist
    release.GoodMarketMaker, //upgrade mm
    release.CompoundVotingMachine, // upgrade gov
    release.ExchangeHelper, // activate upgrade changes
    release.Controller,
    upgradeImpl.address,
    release.GuardiansSafe + "_" + release.GoodReserveCDai
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "pause(bool)",
    "pause(bool)",
    "setMonthlyReputationDistribution(uint256)",
    "setReserveRatioDailyExpansion(uint256,uint256)",
    "setExecutionDailyLimit(uint256)", // set limit to 0 so old bridge cant be used
    "addBlacklisted(address)",
    "addBlacklisted(address)",
    "addBlacklisted(address)",
    "claimTokens(address,address)",
    "upgradeTo(address)",
    "upgradeTo(address)",
    "upgradeTo(address)",
    "upgradeTo(address)",
    "upgradeTo(address)",
    "upgradeTo(address)",
    "upgradeTo(address)",
    "setAddresses()",
    "registerScheme(address,bytes32,bytes4,address)", // give upgrade contract permissions
    "upgrade()",
    "unpause()"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["bool"], [true]),
    ethers.utils.defaultAbiCoder.encode(["bool"], [true]),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
    ethers.utils.defaultAbiCoder.encode(["uint256", "uint256"], [999711382710978, 1e15]),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
    ethers.utils.defaultAbiCoder.encode(["address"], ["0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d"]),
    ethers.utils.defaultAbiCoder.encode(["address"], ["0xeC577447D314cf1e443e9f4488216651450DBE7c"]),
    ethers.utils.defaultAbiCoder.encode(["address"], ["0x6738fA889fF31F82d9Fe8862ec025dbE318f3Fde"]),
    ethers.utils.defaultAbiCoder.encode(["address", "address"], [release.GoodDollar, release.MpbBridge]),
    ethers.utils.defaultAbiCoder.encode(["address"], [reserveImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [goodFundManagerImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [exchangeHelperImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [distHelperImplt.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [stakersDistImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [marketMakerImpl.address]),
    ethers.utils.defaultAbiCoder.encode(["address"], [govImpl.address]),
    "0x", //setAddresses
    ethers.utils.defaultAbiCoder.encode(
      ["address", "bytes32", "bytes4", "address"],
      [
        upgradeImpl.address, //scheme
        ethers.constants.HashZero, //paramshash
        "0x000000f1", //permissions - minimal
        release.Avatar
      ]
    ),
    "0x",
    "0x"
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
    await mainnetPostChecks()
  }
};

const mainnetPostChecks = async () => {
  networkName = "production-mainnet";
  let release: { [key: string]: any } = dao[networkName];

  let [root, ...signers] = await ethers.getSigners();
  const gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);

  const locked = await ethers.getImpersonatedSigner("0xeC577447D314cf1e443e9f4488216651450DBE7c");
  const tx = await gd
    .connect(locked)
    .burn("10", { maxFeePerGas: 30e9, maxPriorityFeePerGas: 1e9, gasLimit: 200000 })
    .then(_ => _.wait())
    .then(_ => _.status)
    .catch(e => e);
  console.log("Burn tx after:", tx);

  const dai = await ethers.getContractAt("IGoodDollar", release.DAI);
  const cdai = await ethers.getContractAt("IGoodDollar", release.cDAI);
  const reserve = await ethers.getContractAt("GoodReserveCDai", release.GoodReserveCDai) as GoodReserveCDai
  const mm = await ethers.getContractAt("GoodMarketMaker", release.GoodMarketMaker) as GoodMarketMaker
  const newExpansion = await mm.reserveRatioDailyExpansion()
  console.log("new expansion set:", newExpansion, newExpansion.mul(1e15).div(ethers.utils.parseEther("1000000000")).toNumber() / 1e15 === 0.999711382710978)
  const reserveToken = await mm.reserveTokens(release.cDAI)
  console.log({ reserveToken })
  const finalSupply = await gd.totalSupply();
  const distHelper = await ethers.getContractAt("DistributionHelper", release.DistributionHelper)
  const result = await distHelper.calcGDToSell(1e9)
  console.log("calcGdToSell 1M:", result.toNumber() / 100)
  const pricesBefore = await Promise.all([reserve.currentPrice(), reserve.currentPriceDAI()])
  console.log({ pricesBefore })
  const dex = await ethers.getContractAt("ExchangeHelper", release.ExchangeHelper) as ExchangeHelper
  await dai.approve(dex.address, ethers.utils.parseEther("10000"))
  await dex.buy([release.DAI], ethers.utils.parseEther("10000"), 0, 0, root.address);
  // check g$ prices
  const pricesAfter = await Promise.all([reserve.currentPrice(), reserve.currentPriceDAI()])
  console.log({ pricesAfter })
  await gd.approve(dex.address, await gd.balanceOf(root.address))
  await dex.sell([release.DAI], await gd.balanceOf(root.address), 0, 0, root.address);
  const daiBalanceAfterSell = await dai.balanceOf(root.address)
  // expect a 10% sell fee
  console.log({ daiBalanceAfterSell })
  const cdaiReserveBalance = await cdai.balanceOf(reserve.address)
  console.log({ cdaiReserveBalance })

  const bridgBalances = await Promise.all([gd.balanceOf(release.MpbBridge), gd.balanceOf(release.ForeignBridge)])
  console.log({ bridgBalances })
  //TODO: check ubi minting from interest/expansion
  const gfm = await ethers.getContractAt("GoodFundManager", release.GoodFundManager) as GoodFundManager
  const stakingContracts = await gfm.callStatic.calcSortedContracts()
  console.log({ stakingContracts })
  const interesTX = await (await gfm.collectInterest(stakingContracts.map(_ => _[0]), false)).wait()
  const ubiEvents = await reserve.queryFilter(reserve.filters.UBIMinted(), -10)
  console.log("gfm events:", interesTX.events?.find(_ => _.event === 'FundsTransferred'))
  console.log("ubiEvents:", ubiEvents)
  // check expansion after some time
  await time.increase(365 * 60 * 60 * 24)
  const expansionTX = await (await gfm.collectInterest([], false)).wait()
  const ubiExpansionEvents = await reserve.queryFilter(reserve.filters.UBIMinted(), -10)
  console.log("gfm events:", expansionTX.events?.filter(_ => _.event === 'FundsTransferred'))
  console.log("ubiEvents:", ubiExpansionEvents)
  const reserveTokenAfterYearExpansion = await mm.reserveTokens(release.cDAI)
  console.log({ reserveTokenAfterYearExpansion })
}
export const upgradeFuse = async network => {
  let [root] = await ethers.getSigners();

  const isProduction = networkName.includes("production");

  let networkEnv = networkName.split("-")[0];
  if (isSimulation) networkEnv = "production";

  let release: { [key: string]: any } = dao[networkEnv];

  let guardian = root;
  //simulate on fork, make sure safe has enough eth to simulate txs
  if (isSimulation) {
    await reset("https://fuse.liquify.com");
    guardian = await ethers.getImpersonatedSigner(release.GuardiansSafe);

    await root.sendTransaction({ value: ethers.constants.WeiPerEther.mul(3), to: guardian.address });
  }


  const killBridge = await ethers.deployContract("FuseOldBridgeKill") as FuseOldBridgeKill

  const gd = (await ethers.getContractAt("IGoodDollar", release.GoodDollar)) as IGoodDollar;

  const isMinter = await gd.isMinter(release.HomeBridge);

  console.log({ networkEnv, guardian: guardian.address, isSimulation, isProduction, isMinter });
  const proposalContracts = [
    release.HomeBridge, // burn locked G$s
    release.HomeBridge, // prevent from using by upgrading to empty contract and removing minting rights
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeToAndCall(uint256,address,bytes)", // upgrade and call end
  ];


  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["uint256", "address", "bytes"], [2, killBridge.address, killBridge.interface.encodeFunctionData("end", [])]),

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

    const isMinter = await gd.isMinter(release.HomeBridge);
    console.log("Fuse bridge scheme registration check:", isMinter ? "Failed" : "Success");
  }
};

export const main = async () => {
  prompt.start();
  const { network } = await prompt.get(["network"]);

  console.log("running step:", { network });
  const chain = last(network.split("-"));
  switch (chain) {
    case "mainnet":
      // await mainnetPostChecks()
      await upgradeMainnet(network);

      break;
    case "fuse":
      await upgradeFuse(network);

      break;
  }
};

main().catch(console.log);
