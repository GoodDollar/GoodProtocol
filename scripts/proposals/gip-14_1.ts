/**
 * increase rate of UBI distribution on Celo
 * also includes old foundation funds transfers from firstclaimpool and avatar towards initial topping of the UBI pool for the launch campaign
 */

import { ethers, network } from "hardhat";
import { defaultsDeep } from "lodash";
import prompt from "prompt";
import { reset } from "@nomicfoundation/hardhat-network-helpers";

import { executeViaGuardian, executeViaSafe, verifyProductionSigner } from "../multichain-deploy/helpers";

import ProtocolSettings from "../../releases/deploy-settings.json";

import dao from "../../releases/deployment.json";

const { name: networkName } = network;

export const step1 = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let networkEnv = networkName.split("-")[0];
  const isForkSimulation = networkName === "localhost";
  if (isForkSimulation) networkEnv = "production";
  const fuseNetwork = networkEnv;

  if (networkEnv === "fuse") networkEnv = "development";
  const celoNetwork = networkEnv + "-celo";
  const mainnetNetwork = `${networkName === "localhost" ? "production" : networkName}-mainnet`; //simulate production on localhost requires running hardhat node in fork mode

  let protocolSettings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

  if (isForkSimulation)
    // fund safe with eth so we can simulate TXs
    await root.sendTransaction({ to: dao[mainnetNetwork].GuardiansSafe, value: ethers.constants.WeiPerEther });

  console.log("got signers:", {
    networkName,
    root: root.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString()),
    mainnetNetwork,
    fuseNetwork,
    celoNetwork
  });

  const proposalContracts = [
    dao[mainnetNetwork].GoodReserveCDai, // update the nonubi bps to 55%. 10% community fund + 45% celo ubi
    dao[mainnetNetwork].DistributionHelper, //set community fund to 0.1818 so it gets 10% from 55%
    dao[mainnetNetwork].DistributionHelper //set celo ubi to 0.8182 so it gets 45% from 55%
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setDistributionHelper(address,uint32)",
    "addOrUpdateRecipient((uint32,uint32,address,uint8))",
    "addOrUpdateRecipient((uint32,uint32,address,uint8))"
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(["address", "uint32"], [dao[mainnetNetwork].DistributionHelper, 5500]),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [8182, 42220, dao[celoNetwork].UBIScheme, 1]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["uint32", "uint32", "address", "uint8"],
      [1818, 122, dao[fuseNetwork].CommunitySafe, 0] //community safe on fuse
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
    await executeViaGuardian(
      proposalContracts,
      proposalEthValues,
      proposalFunctionSignatures,
      proposalFunctionInputs,
      isForkSimulation ? await ethers.getImpersonatedSigner(dao[mainnetNetwork].GuardiansSafe) : root,
      mainnetNetwork
    );
  }

  if (isForkSimulation) {
    const reserve = await ethers.getContractAt("GoodReserveCDai", dao[mainnetNetwork].GoodReserveCDai);
    //verify balance of avatar is 0
    const events = await reserve.queryFilter(reserve.filters.DistributionHelperSet(), -10);
    console.log({ events });
    console.assert(events[0].args?.bps === 5500, "wrong bps");
    const helper = await ethers.getContractAt("DistributionHelper", dao[mainnetNetwork].DistributionHelper);
    const helperEvents = await helper.queryFilter(helper.filters.RecipientUpdated(), -10);
    console.log(
      "helperEvents",
      helperEvents.map(_ => _.args)
    );

    //verify multichain bridge did burn
    console.assert(
      helperEvents.find(
        _ =>
          _.args?.recipient[0] === 1818 &&
          _.args?.recipient[2] == dao[fuseNetwork].CommunitySafe &&
          _.args?.recipient[1] === 122 &&
          _.args?.recipient[3] === 0
      ),
      "wrong community pool bps"
    );
    console.assert(
      helperEvents.find(
        _ =>
          _.args?.recipient[0] === 8182 &&
          _.args?.recipient[2] == dao[celoNetwork].UBIScheme &&
          _.args?.recipient[1] === 42220 &&
          _.args?.recipient[3] === 1
      ),
      "wrong celo ubi pool bps"
    );
  }
};

export const step2 = async () => {
  const isProduction = networkName.includes("production");
  let [root, ...signers] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  let networkEnv = networkName.split("-")[0];
  const isForkSimulation = networkName === "localhost";
  if (isForkSimulation) networkEnv = "production";
  const fuseNetwork = networkEnv;

  if (networkEnv === "fuse") networkEnv = "development";
  const celoNetwork = networkEnv + "-celo";
  const mainnetNetwork = `${networkName === "localhost" ? "production" : networkName}-mainnet`; //simulate production on localhost requires running hardhat node in fork mode

  let protocolSettings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

  if (isForkSimulation)
    // fund safe with eth so we can simulate TXs
    await root.sendTransaction({ to: dao[fuseNetwork].GuardiansSafe, value: ethers.constants.WeiPerEther });

  console.log("got signers:", {
    networkName,
    root: root.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString()),
    mainnetNetwork,
    fuseNetwork,
    celoNetwork
  });

  const fuseProposalContracts = [
    dao[fuseNetwork].FirstClaimPool, // end the pool to get locked funds
    dao[fuseNetwork].GoodDollar, //approve multichain wrapper
    dao[fuseNetwork].MultichainRouter //anyswapout
  ];

  const fuseProposalEthValues = fuseProposalContracts.map(_ => 0);

  const fuseProposalFunctionSignatures = [
    "end()",
    // "transferAndCall(address,uint256,bytes)"//transferAndcall not working in simulation. using aprrove+anyswapout
    "approve(address,uint256)",
    "anySwapOut(address,address,uint256,uint256)"
  ];

  const gd = await ethers.getContractAt("GoodDollar", dao[fuseNetwork].GoodDollar);
  const aBalance = await gd.balanceOf(dao[fuseNetwork].Avatar);
  const bBalance = await gd.balanceOf(dao[fuseNetwork].FirstClaimPool);

  console.log("balances to bridge:", aBalance.toString(), bBalance.toString());
  const fuseProposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode([], []),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256"],
      [dao[fuseNetwork].GoodDollarMintBurnWrapper, aBalance.add(bBalance)]
    ),
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "uint256", "uint256"],
      [dao[fuseNetwork].GoodDollarMintBurnWrapper, dao[celoNetwork].UBIScheme, aBalance.add(bBalance), 42220]
    )

    //transferAndCall isnt working in simualation for some reason
    // ethers.utils.defaultAbiCoder.encode(
    //   ["address", "uint256", "bytes"],
    //   [
    //     dao[fuseNetwork].GoodDollarMintBurnWrapper,
    //     aBalance.add(bBalance),
    //     ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [dao[celoNetwork].UBIScheme, 42220])
    //   ] //target ubipool on celo for multichain bridge
    // )
  ];

  const totalSupplyBefore = await gd.totalSupply();
  if (isProduction) {
    await executeViaSafe(
      fuseProposalContracts,
      fuseProposalEthValues,
      fuseProposalFunctionSignatures,
      fuseProposalFunctionInputs,
      protocolSettings.guardiansSafe,
      "fuse"
    );
  } else {
    await executeViaGuardian(
      fuseProposalContracts,
      fuseProposalEthValues,
      fuseProposalFunctionSignatures,
      fuseProposalFunctionInputs,
      isForkSimulation ? await ethers.getImpersonatedSigner(dao[fuseNetwork].GuardiansSafe) : root,
      fuseNetwork
    );
  }

  if (isForkSimulation) {
    //verify balance of avatar is 0
    console.assert((await gd.balanceOf(dao[fuseNetwork].Avatar)).eq(0), await gd.balanceOf(dao[fuseNetwork].Avatar));
    //verify multichain bridge did burn
    console.assert((await gd.totalSupply()).lt(totalSupplyBefore), "bridge didnt burn G$s");
  }
};

export const main = async () => {
  prompt.start();
  const { stepNumber } = await prompt.get(["stepNumber"]);

  console.log("running step:", { stepNumber });
  switch (stepNumber) {
    case "1":
      await reset("https://cloudflare-eth.com");
      await step1();
      break;

    //to simulate run first
    //npx hardhat node --fork https://rpc.fuse.io
    //then run npx hardhat run scripts/proposals/gip-14_1.ts --network localhost
    case "2":
      await reset("https://rpc.fuse.io");
      await step2();
      break;
  }
  // await upgrade().catch(console.log);
};

main();
