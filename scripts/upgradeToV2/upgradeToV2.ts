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
  ProtocolUpgrade
} from "../../types";
import { getFounders } from "../getFounders";
import { fetchOrDeployProxyFactory } from "../fetchOrDeployProxyFactory";
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

const main = async () => {
  let protocolSettings = {
    ...ProtocolSettings["default"],
    ...ProtocolSettings[networkName]
  };
  const dao = ProtocolAddresses[networkName];

  let [root] = await ethers.getSigners();

  let avatar = dao.Avatar;
  let controller = dao.Controller;
  const isMainnet = networkName.includes("mainnet");
  let repStateId = networkName.includes("mainnet") ? "fuse" : "rootState";
  let oldVotingMachine = dao.SchemeRegistrar;

  let grep: GReputation, vm: CompoundVotingMachine;
  const founders = await getFounders(networkName);

  const deployContracts = async () => {
    console.log({ dao, protocolSettings });
    let release = {};

    const toDeployUpgradable = [
      {
        network: "both",
        name: "NameService",
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
            "CDAI"
          ].map(_ => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(_))),
          [
            controller,
            avatar,
            dao.Identity,
            dao.GoodDollar,
            dao.Contribution || ethers.constants.AddressZero,
            "0xA049894d5dcaD406b7C827D6dc6A0B58CA4AE73a", //bancor
            dao.DAI || ethers.constants.AddressZero,
            dao.cDAI || ethers.constants.AddressZero
          ]
        ]
      },
      {
        network: "both",
        name: "GReputation",
        initializer: "initialize(address, string, bytes32, uint256)",
        args: [
          () => get(release, "NameService", dao.NameService),
          networkName.includes("mainnet") ? "fuse" : "rootState",
          protocolSettings.repStateHash || ethers.constants.HashZero,
          protocolSettings.repTotalSupply || 0
        ]
      },
      {
        network: "both",
        name: "CompoundVotingMachine",
        args: [
          () => get(release, "NameService", dao.NameService),
          protocolSettings.governance.proposalVotingPeriod
        ]
      },
      {
        network: "both",
        name: "ProtocolUpgrade",
        args: [dao.Controller],
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
      if (networkName !== "develop" && dao[contract.name]) {
        console.log(
          contract.name,
          " Skipping deployed contract at:",
          dao[contract.name],
          "upgrading:",
          !!process.env.UPGRADE
        );
        continue;
      }
      const Contract = await ethers.getContractFactory(contract.name);
      //   const ProxyFactory = await fetchOrDeployProxyFactory();
      const args = contract.args.map(_ => (isFunction(_) ? _() : _));

      console.log(`deploying contract ${contract.name}`, {
        args,
        release
        // pf: ProxyFactory.factory.address
      });
      let deployed;
      if (contract.isUpgradable !== false)
        deployed = await upgrades.deployProxy(Contract, args, {
          unsafeAllowCustomTypes: true,
          // proxyFactory: ProxyFactory,
          initializer: contract.initializer
        });
      else deployed = await Contract.deploy(...args);

      console.log(`${contract.name} deployed to: ${deployed.address}`);
      release[contract.name] = deployed.address;
    }
    let res = Object.assign({}, release);
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

    console.log("performing protocol v2 upgrade...", { release });
    await upgrade.upgrade(
      release.NameService,
      [
        dao.Reserve,
        dao.DAIStaking || ethers.constants.AddressZero,
        dao.SchemeRegistrar,
        dao.UpgradeScheme
      ],
      release.CompoundVotingMachine,
      //TODO: replace with new contracts to be added to nameservice
      [
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("0x01")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("0x02"))
      ],
      [release.SchemeRegistrar, release.UpgradeScheme],
      //TODO: replace with default staking contracts
      [],
      []
    );
  };

  const voteProtocolUpgrade = async release => {
    console.log(
      "approve upgrade scheme in dao...",
      release.ProtocolUpgrade,
      release.SchemeRegistrar
    );
    const schemeRegistrar: SchemeRegistrar = (await ethers.getContractAt(
      "SchemeRegistrar",
      release.SchemeRegistrar
    )) as SchemeRegistrar;

    const proposal = await (
      await schemeRegistrar.proposeScheme(
        avatar,
        release.ProtocolUpgrade,
        ethers.constants.HashZero,
        "0x0000001F",
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ProtocolUpgrade"))
      )
    ).wait();

    console.log("proposal tx:", proposal.transactionHash);
    let proposalId = proposal.events.find(_ => _.event === "NewSchemeProposal")
      .args._proposalId;

    console.log("proposal", { scheme: release.ProtocolUpgrade, proposalId });

    console.log("voting...");

    const absoluteVote = await ethers.getContractAt(
      ["function vote(bytes32,uint,uint,address) returns (bool)"],
      release.AbsoluteVote
    );

    console.log("voteUpgradeScheme", {
      absoluteVote: release.AbsoluteVote,
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
  await performUpgrade(release);
  // await proveNewRep();
  // await proposeRemoveOldSchemes();
  // await voteToRevoke();
  //   voteNewGovernance(vm.address, "0x07FFf2171d99792f3eE692B6EA04F674888BA496");
};

main().catch(console.log);
