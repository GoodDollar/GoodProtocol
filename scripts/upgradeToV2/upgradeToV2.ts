/**
 * Mainnet:
 * 0. deploy nameService
 * 1. deploy votingmachine  +  reputation
 * 2. deploy Reserve, MarketMaker
 * 3. deploy FundManager
 * 4. deploy ubi staking contracts
 */

import { network, ethers, upgrades } from "hardhat";
import { networkNames } from "@openzeppelin/upgrades-core";
import { isFunction, get } from "lodash";
import { AaveStakingFactory, CompoundStakingFactory } from "../../types";
import releaser from "../releaser";
import {
  GReputation,
  SchemeRegistrar,
  CompoundVotingMachine,
  ProtocolUpgrade,
  ProtocolUpgradeFuse,
  NameService
} from "../../types";
import { getFounders } from "../getFounders";
import { fetchOrDeployProxyFactory } from "../fetchOrDeployProxyFactory";
import OldDAO from "../../releases/olddao.json";

import ProtocolSettings from "../../releases/deploy-settings.json";

console.log({
  networkNames,
  network: network.name,
  upgrade: process.env.UPGRADE
});
const { name } = network;

export const main = async (networkName = name) => {
  networkNames[1] = networkName;
  networkNames[122] = networkName;
  networkNames[3] = networkName;

  const isProduction = networkName.startsWith("production");
  const isDevelop = !isProduction;
  const isMainnet = networkName.includes("mainnet");
  let protocolSettings = {
    ...ProtocolSettings["default"],
    ...ProtocolSettings[networkName]
  };
  console.log(`networkName ${networkName}`);
  const dao = OldDAO[networkName];
  const ProtocolAddresses = await require("../../releases/deployment.json");
  const newfusedao = ProtocolAddresses[networkName.replace(/\-mainnet/, "")];
  console.log(`newfusedao ${newfusedao}`);
  const newdao = ProtocolAddresses[networkName] || {};

  let [root] = await ethers.getSigners();

  let avatar = dao.Avatar;
  let controller = dao.Controller;
  let repStateId = isMainnet ? "fuse" : "rootState";
  let oldVotingMachine = dao.SchemeRegistrar;

  let grep: GReputation, vm: CompoundVotingMachine;
  const founders = await getFounders(networkName);

  const compoundTokens = [
    {
      name: "cdai",
      address: protocolSettings.compound.cdai || dao.cDAI,
      usdOracle: protocolSettings.compound.daiUsdOracle || dao.DAIUsdOracle,
      compUsdOracle:
        protocolSettings.compound.compUsdOracle || dao.COMPUsdOracle
    }
  ];

  const aaveTokens = [
    {
      name: "usdc",
      address: protocolSettings.aave.usdc || dao.USDC,
      usdOracle: protocolSettings.aave.usdcUsdOracle || dao.USDCUsdOracle,
      aaveUsdOracle: protocolSettings.aave.aaveUsdOracle || dao.AAVEUsdOracle
    }
  ];

  let totalGas = 0;
  const countTotalGas = async tx => {
    let res = tx;
    if (tx.deployTransaction) tx = tx.deployTransaction;
    if (tx.wait) res = await tx.wait();
    if (res.gasUsed) totalGas += parseInt(res.gasUsed);
    else console.log("no gas data", { res, tx });
  };

  const deployContracts = async () => {
    console.log({ dao, newdao, protocolSettings });
    let release = {};

    const toDeployUpgradable = [
      {
        network: "mainnet",
        name: "NameService",
        //TODO: arguments based on network
        args: [
          controller,
          [
            "CONTROLLER",
            "AVATAR",
            "IDENTITY",
            "GOODDOLLAR",
            "CONTRIBUTION_CALCULATION",
            "BANCOR_FORMULA",
            "DAI",
            "CDAI",
            "COMP",
            "BRIDGE_CONTRACT",
            "UNISWAP_ROUTER",
            "GAS_PRICE_ORACLE",
            "DAI_ETH_ORACLE",
            "ETH_USD_ORACLE"
          ].map(_ => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(_))),
          [
            controller,
            avatar,
            dao.Identity,
            dao.GoodDollar,
            dao.Contribution,
            protocolSettings.bancor || dao.BancorFormula,
            get(protocolSettings, "compound.dai", dao.DAI),
            get(protocolSettings, "compound.cdai", dao.cDAI),
            get(protocolSettings, "compound.comp", dao.COMP),
            dao.Bridge,
            protocolSettings.uniswapRouter || dao.UniswapRouter,
            !isMainnet || protocolSettings.chainlink.gasPrice, //should fail if missing only on mainnet
            !isMainnet || protocolSettings.chainlink.dai_eth,
            !isMainnet || protocolSettings.chainlink.eth_usd
          ]
        ]
      },
      {
        network: "fuse",
        name: "NameService",
        //TODO: arguments based on network
        args: [
          controller,
          [
            "CONTROLLER",
            "AVATAR",
            "IDENTITY",
            "GOODDOLLAR",
            "BRIDGE_CONTRACT"
          ].map(_ => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(_))),
          [controller, avatar, dao.Identity, dao.GoodDollar, dao.Bridge]
        ]
      },
      {
        network: "both",
        name: "GReputation",
        initializer: "initialize(address, string, bytes32, uint256)",
        args: [
          () => get(release, "NameService", newdao.NameService),
          repStateId,
          protocolSettings.governance.gdaoAirdrop, //should fail on real deploy if not set
          protocolSettings.governance.gdaoTotalSupply //should fail on real deploy if not set
        ]
      },
      {
        network: "both",
        name: "CompoundVotingMachine",
        args: [
          () => get(release, "NameService", newdao.NameService),
          //TODO: make sure this changes by network
          protocolSettings.governance.proposalVotingPeriod
        ]
      },
      {
        network: "mainnet",
        name: "GoodMarketMaker",
        args: [
          () => get(release, "NameService", newdao.NameService),
          protocolSettings.expansionRatio.nom,
          protocolSettings.expansionRatio.denom
        ]
      },
      {
        network: "mainnet",
        name: "GoodReserveCDai",
        initializer: "initialize(address, bytes32)",
        args: [
          () => get(release, "NameService", newdao.NameService),
          protocolSettings.gdxAirdrop
        ]
      },
      {
        network: "mainnet",
        name: "ExchangeHelper",
        initializer: "initialize(address)",
        args: [() => get(release, "NameService", newdao.NameService)]
      },
      {
        network: "mainnet",
        name: "GoodFundManager",
        args: [() => get(release, "NameService", newdao.NameService)]
      },
      {
        network: "mainnet",
        name: "StakersDistribution",
        args: [() => get(release, "NameService", newdao.NameService)]
      },
      {
        network: "fuse",
        name: "ClaimersDistribution",
        args: [() => get(release, "NameService", newdao.NameService)]
      },
      {
        network: "fuse",
        name: "GovernanceStaking",
        args: [() => get(release, "NameService", newdao.NameService)],
        isUpgradable: false
      },
      {
        network: "fuse",
        name: "UBIScheme",
        initializer: "initialize(address, address, uint256)",
        args: [
          () => get(release, "NameService", newdao.NameService),
          dao.FirstClaimPool,
          14
        ]
      },
      {
        network: "mainnet",
        name: "ProtocolUpgrade",
        args: [dao.Controller],
        isUpgradable: false,
        initializer: null
      },
      {
        network: "fuse",
        name: "ProtocolUpgradeFuse",
        args: [dao.Controller],
        isUpgradable: false
      },
      {
        network: "mainnet",
        name: "CompoundStakingFactory",
        args: [],
        isUpgradable: false
      },
      {
        network: "mainnet",
        name: "AaveStakingFactory",
        args: [],
        isUpgradable: false
      }
    ];

    for (let contract of toDeployUpgradable) {
      if (
        contract.network !== "both" &&
        (contract.network === "mainnet") !== isMainnet
      ) {
        console.log(
          contract,
          " Skipping non mainnet/sidechain contract:",
          contract.network,
          contract.name
        );
        continue;
      }
      if (isDevelop === false && newdao[contract.name]) {
        console.log(
          contract.name,
          " Skipping deployed contract at:",
          newdao[contract.name],
          "upgrading:",
          !!process.env.UPGRADE
        );
        continue;
      }

      const args = await Promise.all(
        contract.args.map(async _ => await (isFunction(_) ? _() : _))
      );

      console.log(`deploying contract upgrade ${contract.name}`, {
        args,
        release
        // pf: ProxyFactory.factory.address
      });

      const Contract = await ethers.getContractFactory(contract.name);
      //   const ProxyFactory = await fetchOrDeployProxyFactory();

      let deployed;
      if (contract.isUpgradable !== false)
        deployed = await upgrades.deployProxy(Contract, args, {
          // proxyFactory: ProxyFactory,
          initializer: contract.initializer,
          kind: "uups"
        });
      else deployed = await Contract.deploy(...args);
      countTotalGas(deployed);
      console.log(`${contract.name} deployed to: ${deployed.address}`);
      release[contract.name] = deployed.address;
    }

    const { DonationsStaking, StakingContracts } =
      isMainnet && (await deployStakingContracts(release));

    release["StakingContracts"] = StakingContracts;
    release["DonationsStaking"] = DonationsStaking;

    console.log({ StakingContracts, DonationsStaking });
    let res = Object.assign(newdao, release);
    await releaser(release, networkName);
    return res;
  };

  const proveNewRep = async () => {
    console.log("prooving new rep...");
    if (networkName.includes("production") === false) {
      const proofs = [
        [
          "0x23d8bd1cdfa398986bb91927d3011fb1ded1425b6ae3ff794e497235481fe57f",
          "0xe4ac4e67088f036e8dc535fee10a3ad42065e444d2b0bd3668e0df21e1590db3"
        ],
        ["0x4c01c2c86a047dc65fc8ff0a1d9ac11842597af9a363711e4db7dcabcfda307b"],
        [
          "0x235dc3126b01e763befb96ead059e3f19d0380e65e477e6ebb95c1d9fc90e0b7",
          "0xe4ac4e67088f036e8dc535fee10a3ad42065e444d2b0bd3668e0df21e1590db3"
        ]
      ];
      let proofResults = await Promise.all(
        founders.map((f, idx) =>
          grep
            .connect(f)
            .proveBalanceOfAtBlockchain(repStateId, f.address, 100, proofs[idx])
            .then(_ => _.wait())
        )
      );
      console.log(
        "proofs:",
        proofResults.map(_ => _.events)
      );
    } else {
      //prove foundation multi sig account
      const proof = [];
      const foundationAddress = protocolSettings.governance.foundationAddress;
      let proofResult = await grep
        .proveBalanceOfAtBlockchain(
          repStateId,
          foundationAddress,
          12000000,
          proof
        )
        .then(_ => _.wait());

      console.log("proofs:", proofResult.events);
    }
  };

  const performUpgrade = async release => {
    const isKovan = networkName.includes("kovan");
    const upgrade: ProtocolUpgrade = (await ethers.getContractAt(
      "ProtocolUpgrade",
      release.ProtocolUpgrade
    )) as ProtocolUpgrade;

    console.log("performing protocol v2 upgrade on Mainnet...", {
      release,
      dao
    });
    console.log("upgrading nameservice + staking rewards...");
    let tx;
    tx = await upgrade.upgradeBasic(
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
        dao.Bridge,
        isKovan ? root.address : newfusedao.UBIScheme, //fake for kovan
        release.ExchangeHelper
      ],
      release.StakingContracts.map((_: any) => _[0]),
      release.StakingContracts.map((_: any) => _[1])
    );
    await countTotalGas(tx);

    console.log("upgrading reserve...", {
      params: [release.NameService, dao.Reserve, dao.MarketMaker, dao.COMP]
    });
    tx = await upgrade.upgradeReserve(
      release.NameService,
      dao.Reserve,
      dao.MarketMaker,
      dao.COMP
    );
    await countTotalGas(tx);
    console.log("upgrading donationstaking...", {
      params: [
        release.NameService,
        dao.DonationsStaking, //old
        release.DonationsStaking
      ]
    });
    tx = await upgrade.upgradeDonationStaking(
      release.NameService,
      dao.DonationsStaking, //old
      release.DonationsStaking //new
    );
    await countTotalGas(tx);

    //extract just the addresses without the rewards
    release.StakingContracts = release.StakingContracts.map(_ => _[0]);

    if (isProduction) {
      console.log(
        "SKIPPING GOVERNANCE UPGRADE FOR PRODUCTION. RUN IT MANUALLY"
      );
    } else {
      console.log("upgrading governance...");

      tx = await upgrade.upgradeGovernance(
        dao.SchemeRegistrar,
        dao.UpgradeScheme,
        release.CompoundVotingMachine
      );
      await countTotalGas(tx);
    }
  };

  const performUpgradeFuse = async release => {
    const upgrade: ProtocolUpgradeFuse = (await ethers.getContractAt(
      "ProtocolUpgradeFuse",
      release.ProtocolUpgradeFuse
    )) as ProtocolUpgradeFuse;

    console.log("performing protocol v2 upgrade on Fuse...", { release, dao });
    await upgrade.upgrade(
      release.NameService,
      //old contracts
      [
        dao.SchemeRegistrar,
        dao.UpgradeScheme,
        dao.UBIScheme,
        dao.FirstClaimPool
      ],
      //new gov
      release.CompoundVotingMachine,
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
        dao.Bridge,
        release.UBIScheme,
        release.GovernanceStaking,
        release.ClaimersDistribution
      ]
    );
  };

  //give Avatar permissions to the upgrade process contract
  const voteProtocolUpgrade = async release => {
    const Upgrade = release.ProtocolUpgrade || release.ProtocolUpgradeFuse;

    console.log(
      "approve upgrade scheme in dao...",
      Upgrade,
      dao.SchemeRegistrar
    );
    const schemeRegistrar: SchemeRegistrar = (await ethers.getContractAt(
      "SchemeRegistrar",
      dao.SchemeRegistrar
    )) as SchemeRegistrar;

    const proposal = await (
      await schemeRegistrar.proposeScheme(
        avatar,
        Upgrade,
        ethers.constants.HashZero,
        "0x0000001F",
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ProtocolUpgrade"))
      )
    ).wait();
    await countTotalGas(proposal);

    console.log("proposal tx:", proposal.transactionHash);
    let proposalId = proposal.events.find(_ => _.event === "NewSchemeProposal")
      .args._proposalId;

    console.log("proposal", { scheme: Upgrade, proposalId });

    console.log("voting...");

    const absoluteVote = await ethers.getContractAt(
      ["function vote(bytes32,uint,uint,address) returns (bool)"],
      dao.AbsoluteVote
    );

    console.log("voteUpgradeScheme", {
      absoluteVote: dao.AbsoluteVote,
      founders
    });
    await Promise.all(
      founders.slice(0, Math.ceil(founders.length / 2)).map(f =>
        absoluteVote
          .connect(f)
          .vote(proposalId, 1, 0, f.address, { gasLimit: 300000 })
          .then(_ => countTotalGas(_.wait()))
          .catch(e => console.log("founder vote failed:", f.address, e.message))
      )
    );
  };

  const deployStakingContracts = async release => {
    console.log("deployStakingContracts", {
      factory: release.CompoundStakingFactory,
      ns: release.NameService
    });
    const compfactory = await ethers.getContractAt(
      "CompoundStakingFactory",
      release.CompoundStakingFactory
    );
    const aavefactory = await ethers.getContractAt(
      "AaveStakingFactory",
      release.AaveStakingFactory
    );
    const compps = compoundTokens.map(async token => {
      let rewardsPerBlock = protocolSettings.staking.rewardsPerBlock;
      console.log("deployStakingContracts", {
        token,
        settings: protocolSettings.staking,
        rewardsPerBlock,
        factory: compfactory.address,
        params: [
          token.address,
          release.NameService,
          protocolSettings.staking.fullRewardsThreshold, //blocks before switching for 0.5x rewards to 1x multiplier
          token.usdOracle,
          token.compUsdOracle
        ]
      });
      const tx = await (
        await compfactory.cloneAndInit(
          token.address,
          release.NameService,
          protocolSettings.staking.fullRewardsThreshold, //blocks before switching for 0.5x rewards to 1x multiplier
          token.usdOracle,
          token.compUsdOracle
        )
      ).wait();
      countTotalGas(tx);
      const log = tx.events.find(_ => _.event === "Deployed");
      if (!log.args.proxy)
        throw new Error(`staking contract deploy failed ${token}`);
      return [log.args.proxy, rewardsPerBlock];
    });

    await Promise.all(compps);
    // const compps = [
    //   Promise.resolve(["0x9999c40c8b88c740076b15d2e708db6a7a071b53", 13888])
    // ];

    const aaveps = aaveTokens.map(async token => {
      let rewardsPerBlock = (protocolSettings.staking.rewardsPerBlock / 2) //aave gets half of the rewards
        .toFixed(0);
      console.log("deployStakingContracts", {
        token,
        settings: protocolSettings.staking,
        rewardsPerBlock
      });
      const tx = await (
        await aavefactory.cloneAndInit(
          token.address,
          get(protocolSettings, "aave.lendingPool", dao.AaveLendingPool),
          release.NameService,
          protocolSettings.staking.fullRewardsThreshold, //blocks before switching for 0.5x rewards to 1x multiplier
          token.usdOracle,

          get(
            protocolSettings,
            "aave.incentiveController",
            dao.AaveIncentiveController
          ),
          token.aaveUsdOracle
        )
      ).wait();
      await countTotalGas(tx);
      const log = tx.events.find(_ => _.event === "Deployed");
      if (!log.args.proxy)
        throw new Error(`staking contract deploy failed ${token}`);
      return [log.args.proxy, rewardsPerBlock];
    });

    // const aaveps = [
    //   Promise.resolve(["0x8f0c4f59b4c593193e5b5e0224d848ac803ad1a2", 13888 / 2])
    // ];
    await Promise.all(aaveps);
    const deployed = await Promise.all(compps.concat(aaveps));

    console.log("deploying donation staking");
    const deployedDonationsStaking = await upgrades.deployProxy(
      await ethers.getContractFactory("DonationsStaking"),
      [release.NameService, deployed[0][0]],
      {
        kind: "uups"
      }
    );
    await countTotalGas(deployedDonationsStaking);

    console.log(
      `DonationsStaking deployed to: ${deployedDonationsStaking.address}`
    );

    return {
      DonationsStaking: deployedDonationsStaking.address,
      StakingContracts: deployed
    };

    // return {
    //   DonationsStaking: release["DonationsStaking"],
    //   StakingContracts: deployed
    // };
  };

  const release: any = await deployContracts();
  console.log("deployed contracts", { totalGas });
  await voteProtocolUpgrade(release);
  console.log("voted contracts", { totalGas });
  isMainnet && (await performUpgrade(release));
  !isMainnet && (await performUpgradeFuse(release));
  console.log("upgraded contracts", { totalGas });
  await releaser(release, networkName);
  // await proveNewRep();
};
if (network.name != "test" && network.name != "test-mainnet") {
  main(name).catch(console.log);
}
