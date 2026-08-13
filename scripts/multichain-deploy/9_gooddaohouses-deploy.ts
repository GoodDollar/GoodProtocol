/***
 * Deploy the GoodDaoHouses governance contract
 * steps required:
 * 1. deploy GoodDaoHouses as a UUPS proxy via the ProxyFactory (deterministic address)
 * 2. wire the FlowSplitter pool used to stream the vote outcome
 *
 * The FlowSplitter pool must already exist and have GoodDaoHouses as one of its pool
 * admins before step 2 -- configureFlowSplitter reverts with "Not pool admin" otherwise.
 * The proxy address is deterministic (CREATE2 over keccak("GoodDaoHouses") + deployer), so
 * either create the pool up front with the address printed by this script in the pool
 * `_admins` list, or have an existing pool admin call addPoolAdmin(poolId, <houses>) and
 * re-run this script.
 *
 * Upgrades are gated by _onlyAvatar(), so the DAO Controller owns the implementation.
 * Operational roles come from initialize(): DEFAULT_ADMIN_ROLE -> admin, and
 * GOVERNANCE_COMMITTEE_ROLE -> committee plus admin when the two differ. Keeping admin =
 * Avatar is what lets executeViaGuardian drive committee-only calls like
 * configureFlowSplitter below.
 */

import { network, ethers } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";

import {
  deployDeterministic,
  printDeploy,
  executeViaGuardian,
  executeViaSafe,
  verifyContract,
  verifyProductionSigner
} from "./helpers";
import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";

const { name: networkName } = network;

export const deployGoodDaoHouses = async () => {
  const viaGuardians = false;
  const isProduction = networkName.includes("production");

  let release: { [key: string]: any } = dao[networkName];
  let settings = defaultsDeep({}, ProtocolSettings[networkName], ProtocolSettings["default"]);

  let [root] = await ethers.getSigners();

  if (isProduction) verifyProductionSigner(root);

  console.log("got signers:", {
    networkName,
    root: root.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  const houseSettings = settings.gooddaohouses;
  const admin = houseSettings.admin || release.Avatar;
  const committee = houseSettings.committee || settings.guardiansSafe || release.Avatar;

  if (isProduction && !houseSettings.committee) {
    throw new Error("set gooddaohouses.committee in deploy-settings.json before a production deploy");
  }

  // Minimum stakes are configured in whole G$ -- scale by the token decimals of the target chain.
  const gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);
  const decimals = await gd.decimals();
  const citizensMinimumStake = ethers.utils.parseUnits(String(houseSettings.citizensMinimumStake), decimals);
  const alignmentMinimumStake = ethers.utils.parseUnits(String(houseSettings.alignmentMinimumStake), decimals);

  console.log("deploying GoodDaoHouses...", {
    nameService: release.NameService,
    admin,
    committee,
    decimals,
    citizensMinimumStake: citizensMinimumStake.toString(),
    alignmentMinimumStake: alignmentMinimumStake.toString()
  });

  let Houses: Contract;
  if (!release.GoodDaoHouses) {
    Houses = (await deployDeterministic(
      {
        name: "GoodDaoHouses",
        isUpgradeable: true
      },
      [release.NameService, admin, committee, citizensMinimumStake, alignmentMinimumStake]
    ).then(printDeploy)) as Contract;

    const torelease = {
      GoodDaoHouses: Houses.address
    };
    release = {
      ...release,
      ...torelease
    };
    await releaser(torelease, networkName, "deployment", false);
  } else {
    Houses = await ethers.getContractAt("GoodDaoHouses", release.GoodDaoHouses);
    console.log("GoodDaoHouses already deployed, reusing:", Houses.address);
  }

  await wireFlowSplitter(Houses, release, settings, viaGuardians, root);

  await verifyContract(Houses.address, "contracts/governance/GoodDaoHouses.sol:GoodDaoHouses", networkName);

  return Houses;
};

// Points GoodDaoHouses at the FlowSplitter pool it manages, via the DAO guardians.
const wireFlowSplitter = async (Houses: Contract, release, settings, viaGuardians: boolean, root) => {
  const { flowSplitter, flowSplitterPoolId } = settings.gooddaohouses;

  if (!flowSplitter || !flowSplitterPoolId) {
    console.log("no flowSplitter configured -- skipping pool wiring.");
    console.log(
      `create a FlowSplitter pool with ${Houses.address} in its admins list, then set ` +
        "gooddaohouses.flowSplitter / gooddaohouses.flowSplitterPoolId in deploy-settings.json and re-run"
    );
    return;
  }

  const configured = await Houses.flowSplitterConfig();
  if (
    configured.splitter.toLowerCase() === flowSplitter.toLowerCase() &&
    configured.poolId.eq(flowSplitterPoolId)
  ) {
    console.log("flowSplitter already configured, skipping", { flowSplitter, flowSplitterPoolId });
    return;
  }

  // configureFlowSplitter requires the houses proxy to already be an admin of the pool.
  const splitter = await ethers.getContractAt("IFlowSplitter", flowSplitter);
  const isPoolAdmin = await splitter.isPoolAdmin(flowSplitterPoolId, Houses.address);
  if (!isPoolAdmin) {
    console.error(
      `GoodDaoHouses (${Houses.address}) is not an admin of pool ${flowSplitterPoolId} -- ` +
        "have an existing pool admin call addPoolAdmin() and re-run this script"
    );
    return;
  }

  // The call is committee-gated, so the Avatar must hold GOVERNANCE_COMMITTEE_ROLE for the
  // guardian path to work. initialize() grants it whenever admin != committee.
  const committeeRole = await Houses.GOVERNANCE_COMMITTEE_ROLE();
  if (!(await Houses.hasRole(committeeRole, release.Avatar))) {
    console.error(
      `Avatar (${release.Avatar}) does not hold GOVERNANCE_COMMITTEE_ROLE -- ` +
        "the configured committee must call configureFlowSplitter directly"
    );
    return;
  }

  console.log("configuring flow splitter via guardian", { flowSplitter, flowSplitterPoolId });

  const proposalActions = [
    [
      Houses.address,
      "configureFlowSplitter(address,uint256)",
      ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [flowSplitter, flowSplitterPoolId]),
      0
    ]
  ];

  const [proposalContracts, proposalFunctionSignatures, proposalFunctionInputs, proposalEthValues] = [
    proposalActions.map(_ => _[0]),
    proposalActions.map(_ => _[1]),
    proposalActions.map(_ => _[2]),
    proposalActions.map(_ => _[3])
  ];

  try {
    if (viaGuardians) {
      await executeViaSafe(
        proposalContracts,
        proposalEthValues,
        proposalFunctionSignatures,
        proposalFunctionInputs,
        settings.guardiansSafe
      );
    } else {
      await executeViaGuardian(
        proposalContracts,
        proposalEthValues,
        proposalFunctionSignatures,
        proposalFunctionInputs,
        root
      );
    }
  } catch (e) {
    console.error("proposal execution failed...", e.message);
  }
};

export const main = async () => {
  await deployGoodDaoHouses();
};

if (process.argv[1].includes("gooddaohouses")) main();
