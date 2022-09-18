/***
 * Deploy helper contracts
 * AdminWallet, Faucet, Invites
 */
import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";
import { defaultsDeep } from "lodash";
import { deployDeterministic, executeViaGuardian } from "./helpers";
import releaser from "../releaser";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { TransactionResponse } from "@ethersproject/providers";
import { InvitesV1__factory } from "../../types";
import { keccak256, toUtf8Bytes } from "ethers/lib/utils";

const { name } = network;

const printDeploy = async (
  c: Contract | TransactionResponse
): Promise<Contract | TransactionResponse> => {
  if (c instanceof Contract) {
    await c.deployed();
    console.log("deployed to: ", c.address);
  }
  if (c.wait) {
    await c.wait();
    console.log("tx done:", c.hash);
  }
  return c;
};

export const deployHelpers = async () => {
  let protocolSettings = defaultsDeep(
    {},
    ProtocolSettings[network.name],
    ProtocolSettings["default"]
  );
  let release: { [key: string]: any } = dao[network.name];

  let [root, ...signers] = await ethers.getSigners();
  //generic call permissions
  let schemeMock = root;

  console.log("got signers:", {
    network,
    root: root.address,
    schemeMock: schemeMock.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then(_ => _.toString())
  });

  console.log("deploying ubi pool");
  const UBIScheme = (await deployDeterministic(
    {
      name: "UBIScheme",
      isUpgradeable: true
    },
    [
      release.NameService,
      ethers.constants.AddressZero,
      protocolSettings.ubi.maxInactiveDays
    ]
  ).then(printDeploy)) as Contract;

  console.log("deploying claimers distribution");

  const ClaimersDistribution = (await deployDeterministic(
    { name: "ClaimersDistribution", isUpgradeable: true },
    [release.NameService]
  ).then(printDeploy)) as Contract;

  console.log("setting nameservice addresses via guardian");
  const proposalContracts = [
    release.NameService //nameservice add MinterWrapper
  ];

  const proposalEthValues = proposalContracts.map(_ => 0);

  const proposalFunctionSignatures = [
    "setAddresses(bytes32[],address[])" //add ubischeme and claimersdistribution in nameservice
  ];

  const proposalFunctionInputs = [
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32[]", "address[]"],
      [
        [
          keccak256(toUtf8Bytes("UBISCHEME")),
          keccak256(toUtf8Bytes("GDAO_CLAIMERS"))
        ],
        [UBIScheme.address, ClaimersDistribution.address]
      ]
    )
  ];

  await executeViaGuardian(
    proposalContracts,
    proposalEthValues,
    proposalFunctionSignatures,
    proposalFunctionInputs,
    root
  );

  if (!network.name.includes("production")) {
    console.log("minting G$s to pool on dev envs");
    const gd = await ethers.getContractAt("IGoodDollar", release.GoodDollar);
    await gd.mint(UBIScheme.address, 1e8); //1million GD (2 decimals)
  }

  release = {
    UBIScheme: UBIScheme.address,
    ClaimersDistribution: ClaimersDistribution.address
  };
  await releaser(release, network.name, "deployment", false);
};

export const main = async (networkName = name) => {
  await deployHelpers().catch(console.log);
};
main();
