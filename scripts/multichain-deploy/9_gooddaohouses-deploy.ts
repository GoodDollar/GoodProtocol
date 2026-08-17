/***
 * Deploy the GoodDaoHouses governance contract
 * steps required:
 * 1. deploy GoodDaoHouses as a UUPS proxy via the ProxyFactory (deterministic address)
 * 2. wire the FlowSplitter pool used to stream the vote outcome
 *
 * On development-celo, if a FlowSplitter address is set and no pool id is stored yet, this
 * script creates the pool with GoodDaoHouses as the only admin, then calls
 * configureFlowSplitter via the Avatar. Other networks still require an existing pool.
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

const createHousesFlowSplitterPool = async (Houses: Contract, flowSplitter: string, gdAddress: string, root) => {
  const splitter = await ethers.getContractAt("IFlowSplitter", flowSplitter);
  const tx = await splitter.connect(root).createPool(
    gdAddress,
    {
      transferabilityForUnitsOwner: false,
      distributionFromAnyAddress: true
    },
    {
      name: "GoodDAO Houses",
      symbol: "GDAH",
      decimals: 18
    },
    [],
    [Houses.address],
    '{"listed":false}',
    { gasLimit: 8000000 }
  );
  const receipt = await tx.wait();
  const created = receipt.events.find(e => e.event === "PoolCreated");
  if (!created) {
    throw new Error(`PoolCreated event missing from ${receipt.transactionHash}`);
  }

  console.log("created FlowSplitter pool", {
    txHash: receipt.transactionHash,
    poolId: created.args.poolId.toString(),
    poolAddress: created.args.poolAddress
  });

  return {
    poolId: created.args.poolId,
    poolAddress: created.args.poolAddress
  };
};

const wireFlowSplitter = async (Houses: Contract, release, settings, viaGuardians: boolean, root) => {
  const houseSettings = settings.gooddaohouses || {};
  const flowSplitter = houseSettings.flowSplitter || release.GoodDaoHousesFlowSplitter;

  if (!flowSplitter) {
    console.log("no flowSplitter configured -- skipping pool wiring.");
    return;
  }

  const configured = await Houses.flowSplitterConfig();
  if (configured.poolAddress !== ethers.constants.AddressZero) {
    console.log("flowSplitter already configured, skipping", {
      splitter: configured.splitter,
      poolId: configured.poolId.toString(),
      poolAddress: configured.poolAddress
    });
    return;
  }

  let flowSplitterPoolId = houseSettings.flowSplitterPoolId || release.GoodDaoHousesPoolId;
  if (!flowSplitterPoolId || ethers.BigNumber.from(flowSplitterPoolId).eq(0)) {
    if (networkName !== "development-celo") {
      console.log(
        `create a FlowSplitter pool with ${Houses.address} in its admins list, then set ` +
          "gooddaohouses.flowSplitter / gooddaohouses.flowSplitterPoolId in deploy-settings.json and re-run"
      );
      return;
    }

    const created = await createHousesFlowSplitterPool(Houses, flowSplitter, release.GoodDollar, root);
    flowSplitterPoolId = created.poolId;
    await releaser(
      {
        GoodDaoHousesFlowSplitter: flowSplitter,
        GoodDaoHousesPoolId: created.poolId.toString(),
        GoodDaoHousesPool: created.poolAddress
      },
      networkName,
      "deployment",
      false
    );
    await releaser(
      {
        gooddaohouses: {
          ...(ProtocolSettings[networkName].gooddaohouses || {}),
          flowSplitter,
          flowSplitterPoolId: Number(created.poolId.toString())
        }
      },
      networkName,
      "deploy-settings",
      false
    );
  }

  const splitter = await ethers.getContractAt("IFlowSplitter", flowSplitter);
  const poolId = ethers.BigNumber.from(flowSplitterPoolId);
  let isPoolAdmin = false;
  for (let attempt = 0; attempt < 5 && !isPoolAdmin; attempt++) {
    isPoolAdmin = await splitter.isPoolAdmin(poolId, Houses.address);
    if (!isPoolAdmin && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (!isPoolAdmin) {
    console.error(
      `GoodDaoHouses (${Houses.address}) is not an admin of pool ${poolId.toString()} -- ` +
        "have an existing pool admin call addPoolAdmin() and re-run this script"
    );
    return;
  }

  // The call is committee-gated, so the Avatar must hold GOVERNANCE_COMMITTEE_ROLE for the
  // Controller.genericCall path to work. initialize() always grants it to `committee`, and also to `admin` when admin != committee.
  const committeeRole = await Houses.GOVERNANCE_COMMITTEE_ROLE();
  if (!(await Houses.hasRole(committeeRole, release.Avatar))) {
    console.error(
      `Avatar (${release.Avatar}) does not hold GOVERNANCE_COMMITTEE_ROLE -- ` +
        "the configured committee must call configureFlowSplitter directly"
    );
    return;
  }

  console.log(`configuring flow splitter via ${viaGuardians ? "guardians safe" : "guardian"}`, { flowSplitter, flowSplitterPoolId });

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
    // Log the full thrown value to preserve stack/context and avoid assuming Error shape
    console.error("proposal execution failed...", e);
  }
};

export const main = async () => {
  await deployGoodDaoHouses();
};

if (process.argv[1].includes("gooddaohouses")) main();
