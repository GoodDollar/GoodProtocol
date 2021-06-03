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
import ProtocolAddresses from "../../releases/deployment.json";
import ProtocolSettings from "../../releases/deploy-settings.json";

console.log({
  networkNames,
  network: network.name,
  upgrade: process.env.UPGRADE
});
const { name: networkName } = network;
networkNames[1] = networkName;
networkNames[122] = networkName;
networkNames[3] = networkName;

const isProduction = networkName.startsWith("production");
const isDevelop = !isProduction;
const isMainnet = networkName.includes("mainnet");
const main = async () => {
  let protocolSettings = {
    ...ProtocolSettings["default"],
    ...ProtocolSettings[networkName]
  };
  const dao = OldDAO[networkName];
  const newfusedao = ProtocolAddresses[networkName.replace(/\-mainnet/, "")];
  const newdao = ProtocolAddresses[networkName] || {};

  let [root] = await ethers.getSigners();

  let avatar = dao.Avatar;
  let controller = dao.Controller;
  let repStateId = isMainnet ? "fuse" : "rootState";
  let oldVotingMachine = dao.SchemeRegistrar;

  let grep: GReputation, vm: CompoundVotingMachine;
  const founders = await getFounders(networkName);

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
            protocolSettings.dai || dao.DAI,
            protocolSettings.cdai || dao.cDAI,
            dao.Bridge,
            protocolSettings.uniswapRouter,
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
          protocolSettings.repStateHash ||
            (isDevelop && ethers.constants.HashZero), //should fail on real deploy if not set
          protocolSettings.repTotalSupply || (isDevelop && 0) //should fail on real deploy if not set
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
        args: [dao.Controller, dao.COMP],
        isUpgradable: false
      },
      {
        network: "fuse",
        name: "ProtocolUpgradeFuse",
        args: [dao.Controller],
        isUpgradable: false
      }
    ];
    ethers.constants;

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

      const args = contract.args.map(_ => (isFunction(_) ? _() : _));

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

      console.log(`${contract.name} deployed to: ${deployed.address}`);
      release[contract.name] = deployed.address;
    }
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
    const upgrade: ProtocolUpgrade = (await ethers.getContractAt(
      "ProtocolUpgrade",
      release.ProtocolUpgrade
    )) as ProtocolUpgrade;

    console.log("performing protocol v2 upgrade on Mainnet...", {
      release,
      dao
    });
    await upgrade.upgrade(
      release.NameService,
      //old contracts
      [
        dao.Reserve,
        dao.DAIStaking || ethers.constants.AddressZero,
        dao.SchemeRegistrar,
        dao.UpgradeScheme,
        dao.MarketMaker
      ],
      //new gov
      release.CompoundVotingMachine,
      //TODO: replace with new contracts to be added to nameservice
      [
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RESERVE")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MARKET_MAKER")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUND_MANAGER")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("REPUTATION")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GDAO_STAKERS")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BRIDGE_CONTRACT")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UBI_RECIPIENT"))
      ],
      [
        release.GoodReserveCDai,
        release.GoodMarketMaker,
        release.GoodFundManager,
        release.GReputation,
        release.StakersDistribution,
        dao.Bridge,
        newfusedao.UBIScheme
      ],
      //TODO: replace with default staking contracts
      [],
      []
    );
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
      //TODO: replace with new contracts to be added to nameservice
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
          .then(_ => _.wait())
          .catch(e => console.log("founder vote failed:", f.address, e.message))
      )
    );
  };

  const release: any = await deployContracts();
  await voteProtocolUpgrade(release);

  isMainnet && (await performUpgrade(release));
  !isMainnet && (await performUpgradeFuse(release));
  // await proveNewRep();
  // await proposeRemoveOldSchemes();
  // await voteToRevoke();
  //   voteNewGovernance(vm.address, "0x07FFf2171d99792f3eE692B6EA04F674888BA496");
};

main().catch(console.log);
