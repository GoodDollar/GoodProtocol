/***
 * Mainnet:
 * FIXES:
 *  - prevent hacked funds burnFrom
 *  - set GOOD rewards to 0
 *  - prevent untrusted contracts in goodfundmanager
 *  - use bonding curve for actual cDAI balance (prevent the "buy" instead of "transferTo" used in hack to trick reserve into minting UBI from interest)
 *  - set exit contribution to 10%
 *  - disable gdx
 *  - fix reserve calculations of expansion/currentprice
 *  - add requirement of guardians to approve on-chain proposals
 *  - reserve should not trust exchange helper
 *  - resere should not trust fundmanager for its starting balance
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
 *  - upgrade governance
 *  - unpause reserve
 *  - unpause goodfundmanager
 * 
 *
 * Fuse:
 * PLAN:
 *  - prevent old fuse bridge usage
 *  - upgrade governance
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
import { ExchangeHelper, FuseOldBridgeKill, GoodFundManager, GoodMarketMaker, GoodReserveCDai, IGoodDollar } from "../../types";
let { name: networkName } = network;


const isSimulation = network.name === "hardhat" || network.name === "fork" || network.name === "localhost";

// hacker and hacked multichain bridge accounts
const LOCKED_ACCOUNTS = ["0xeC577447D314cf1e443e9f4488216651450DBE7c", "0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d", "0x6738fA889fF31F82d9Fe8862ec025dbE318f3Fde"]

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
      value: ethers.utils.parseEther("1"),
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

  // reserve funder (goodlabs safe)
  const funder = "0xF0652a820dd39EC956659E0018Da022132f2f40a"
  // test blacklisting to prevent burn by hacker
  if (isSimulation) {

    const locked = await ethers.getImpersonatedSigner(LOCKED_ACCOUNTS[0]);
    const tx = await gd
      .connect(locked)
      .burn("10")
      .then(_ => _.wait())
      .then(_ => _.status)
      .catch(e => e);

    console.log("Burn tx before:", tx);

    const funderSigner = await ethers.getImpersonatedSigner(funder)
    const dai = await ethers.getContractAt("IGoodDollar", release.DAI)
    await dai.connect(funderSigner).approve(upgradeImpl.address, ethers.utils.parseEther("200000"))
    const whale = await ethers.getImpersonatedSigner("0xa359Fc83C48277EedF375a5b6DC9Ec7D093aD3f2")
    await dai.connect(whale).transfer(root.address, ethers.utils.parseEther("100000"))

    const lockedFunds = await Promise.all(LOCKED_ACCOUNTS.map(_ => gd.balanceOf(_)))
    const totalLocked = lockedFunds.reduce((acc, cur) => acc.add(cur), ethers.constants.Zero)
    console.log({ totalLocked })

  }

  const startSupply = await gd.totalSupply();


  console.log("executing proposals");

  const proposalContracts = [
    release.StakingContractsV3[0][0], // pause staking
    release.StakingContractsV3[1][0], // pause staking
    release.StakersDistribution, //set GOOD rewards to 0
    release.GoodReserveCDai, //expansion ratio
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
    "upgrade(address)",
    "unpause()"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["bool"], [true]),
    ethers.utils.defaultAbiCoder.encode(["bool"], [true]),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
    ethers.utils.defaultAbiCoder.encode(["uint256", "uint256"], [999711382710978, 1e15]),
    ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
    ethers.utils.defaultAbiCoder.encode(["address"], [LOCKED_ACCOUNTS[0]]),
    ethers.utils.defaultAbiCoder.encode(["address"], [LOCKED_ACCOUNTS[1]]),
    ethers.utils.defaultAbiCoder.encode(["address"], [LOCKED_ACCOUNTS[2]]),
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
    ethers.utils.defaultAbiCoder.encode(["address"], [funder]),
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

  const locked = await ethers.getImpersonatedSigner(LOCKED_ACCOUNTS[0]);
  const tx = await gd
    .connect(locked)
    .burn("10", { maxFeePerGas: 30e9, maxPriorityFeePerGas: 1e9, gasLimit: 200000 })
    .then(_ => _.wait())
    .then(_ => _.status)
    .catch(e => e);
  console.log("Burn tx after should fail:", tx);

  const dai = await ethers.getContractAt("IGoodDollar", release.DAI);
  const cdai = await ethers.getContractAt("IGoodDollar", release.cDAI);
  const reserve = await ethers.getContractAt("GoodReserveCDai", release.GoodReserveCDai) as GoodReserveCDai
  const mm = await ethers.getContractAt("GoodMarketMaker", release.GoodMarketMaker) as GoodMarketMaker
  const newExpansion = await mm.reserveRatioDailyExpansion()
  console.log("new expansion set:", newExpansion, newExpansion.mul(1e15).div(ethers.utils.parseEther("1000000000")).toNumber() / 1e15 === 0.999711382710978)
  console.log("discount should be disabled:", await reserve.discountDisabled(), " gdx should be disabled:", await reserve.gdxDisabled());
  const resereState = await mm.reserveTokens(release.cDAI)
  console.log({ resereState })
  const finalSupply = await gd.totalSupply();
  const distHelper = await ethers.getContractAt("DistributionHelper", release.DistributionHelper)
  const result = await distHelper.calcGDToSell(1e9)
  console.log("how much G$ to sell to cover distribution fees out of 1M:", result.toNumber() / 100)
  const [cdaiPriceBefore, daiPriceBefore] = await (await Promise.all([reserve.currentPrice(), reserve.currentPriceDAI()])).map(_ => _.toNumber())
  console.log({ cdaiPriceBefore, daiPriceBefore })
  const dex = await ethers.getContractAt("ExchangeHelper", release.ExchangeHelper) as ExchangeHelper
  await dai.approve(dex.address, ethers.utils.parseEther("10000"))
  await dex.buy([release.DAI], ethers.utils.parseEther("10000"), 0, 0, root.address);
  // check g$ prices
  const [cdaiPriceAfter, daiPriceAfter] = await (await Promise.all([reserve.currentPrice(), reserve.currentPriceDAI()])).map(_ => _.toNumber())
  console.log("prices after buying form reserve with 10k DAI", { cdaiPriceAfter, daiPriceAfter })
  await gd.approve(dex.address, await gd.balanceOf(root.address))
  await dex.sell([release.DAI], await gd.balanceOf(root.address), 0, 0, root.address);
  const daiBalanceAfterSell = await dai.balanceOf(root.address)
  // expect a 10% sell fee
  console.log("expect 10% sell fee (selling 10K gets only 9K of dai, balance should be ~99K):", { daiBalanceAfterSell })
  const cdaiReserveBalance = await cdai.balanceOf(reserve.address)
  console.log({ cdaiReserveBalance })

  const [mpbBalance, fuseBalance] = await Promise.all([gd.balanceOf(release.MpbBridge), gd.balanceOf(release.ForeignBridge)])
  console.log("fuse bridge should have 0 balance and Mpb should be >6B", { mpbBalance, fuseBalance })
  const gfm = await ethers.getContractAt("GoodFundManager", release.GoodFundManager) as GoodFundManager
  const stakingContracts = await gfm.callStatic.calcSortedContracts()
  console.log({ stakingContracts })
  const interesTX = await (await gfm.collectInterest(stakingContracts.map(_ => _[0]), false)).wait()
  const ubiEvents = last(await reserve.queryFilter(reserve.filters.UBIMinted(), -1))
  console.log("collectinterest gfm events:", interesTX.events?.find(_ => _.event === 'FundsTransferred'))
  console.log("ubiEvents after collect interest:", ubiEvents)
  // check expansion after some time
  await time.increase(365 * 60 * 60 * 24)
  const expansionTX = await (await gfm.collectInterest([], false)).wait()
  const ubiExpansionEvents = last(await reserve.queryFilter(reserve.filters.UBIMinted(), -1))
  console.log("gfm events after 1 year expansion:", expansionTX.events?.filter(_ => _.event === 'FundsTransferred'))
  console.log("ubiEvents after 1 year expansion:", ubiExpansionEvents)
  const reserveStateAfterYearExpansion = await mm.reserveTokens(release.cDAI)
  console.log({ reserveStateAfterYearExpansion })
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



  const gd = (await ethers.getContractAt("IGoodDollar", release.GoodDollar)) as IGoodDollar;

  const isMinter = await gd.isMinter(release.HomeBridge);

  console.log({ networkEnv, guardian: guardian.address, isSimulation, isProduction, isMinter });

  const govImpl = await ethers.deployContract("CompoundVotingMachine");
  const killBridge = await ethers.deployContract("FuseOldBridgeKill") as FuseOldBridgeKill

  const proposalContracts = [
    release.HomeBridge, // prevent from using by upgrading to empty contract and removing minting rights
    release.CompoundVotingMachine, //upgrade gov
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "upgradeToAndCall(uint256,address,bytes)", // upgrade and call end
    "upgradeTo(address)"
  ];


  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["uint256", "address", "bytes"], [2, killBridge.address, killBridge.interface.encodeFunctionData("end")]),
    ethers.utils.defaultAbiCoder.encode(["address"], [govImpl.address]),

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
