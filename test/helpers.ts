import { ethers, upgrades } from "hardhat";

import DAOCreatorABI from "@gooddollar/goodcontracts/build/contracts/DaoCreatorGoodDollar.json";
import IdentityABI from "@gooddollar/goodcontracts/build/contracts/Identity.json";
import FeeFormulaABI from "@gooddollar/goodcontracts/build/contracts/FeeFormula.json";
import AddFoundersABI from "@gooddollar/goodcontracts/build/contracts/AddFoundersGoodDollar.json";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import { GoodMarketMaker } from "../types";

export const createDAO = async () => {
  let [root, ...signers] = await ethers.getSigners();
  const DAOCreatorFactory = new ethers.ContractFactory(
    DAOCreatorABI.abi,
    DAOCreatorABI.bytecode,
    root
  );

  const IdentityFactory = new ethers.ContractFactory(
    IdentityABI.abi,
    IdentityABI.bytecode,
    root
  );
  const FeeFormulaFactory = new ethers.ContractFactory(
    FeeFormulaABI.abi,
    FeeFormulaABI.bytecode,
    root
  );
  const AddFoundersFactory = new ethers.ContractFactory(
    AddFoundersABI.abi,
    AddFoundersABI.bytecode,
    root
  );

  const BancorFormula = await (
    await ethers.getContractFactory("BancorFormula")
  ).deploy();
  const AddFounders = await AddFoundersFactory.deploy();
  const Identity = await IdentityFactory.deploy();
  const daoCreator = await DAOCreatorFactory.deploy(AddFounders.address);
  const FeeFormula = await FeeFormulaFactory.deploy(0);

  await daoCreator.forgeOrg(
    "G$",
    "G$",
    0,
    FeeFormula.address,
    Identity.address,
    [root.address],
    1000,
    [100000]
  );

  const Avatar = new ethers.Contract(
    await daoCreator.avatar(),
    [
      "function owner() view returns (address)",
      "function nativeToken() view returns (address)"
    ],
    root
  );

  await Identity.setAvatar(Avatar.address);
  const controller = await Avatar.owner();

  const ccFactory = new ethers.ContractFactory(
    ContributionCalculation.abi,
    ContributionCalculation.bytecode,
    root
  );

  const contribution = await ccFactory.deploy(Avatar.address, 0, 1e15);

  const nameService = await upgrades.deployProxy(
    await ethers.getContractFactory("NameService"),
    [
      controller,
      [
        "AVATAR",
        "IDENTITY",
        "GOODDOLLAR",
        "CONTRIBUTION_CALCULATION",
        "BANCOR_FORMULA"
      ].map(_ => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(_))),
      [
        Avatar.address,
        Identity.address,
        await Avatar.nativeToken(),
        contribution.address,
        BancorFormula.address
      ]
    ]
  );

  const MM = await ethers.getContractFactory("GoodMarketMaker");

  let marketMaker = (await upgrades.deployProxy(MM, [
    nameService.address,
    999388834642296,
    1e15
  ])) as GoodMarketMaker;

  //generic call permissions
  let schemeMock = signers[signers.length - 1];

  const setSchemes = addrs =>
    daoCreator.setSchemes(
      Avatar.address,
      addrs,
      new Array(addrs.length).fill(ethers.constants.HashZero),
      new Array(addrs.length).fill("0x0000001F"),
      ""
    );

  const setDAOAddress = async (
    name,
    addr,
    signerWithGenericCall = schemeMock
  ) => {
    const nsFactory = await ethers.getContractFactory("NameService");
    const encoded = nsFactory.interface.encodeFunctionData("setAddress", [
      name,
      addr
    ]);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      signerWithGenericCall
    );

    await ictrl.genericCall(nameService.address, encoded, Avatar.address, 0);
  };

  return {
    daoCreator,
    controller,
    avatar: await daoCreator.avatar(),
    gd: await Avatar.nativeToken(),
    identity: Identity.address,
    nameService,
    setDAOAddress,
    setSchemes,
    marketMaker
  };
};

export async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await advanceBlocks(1);
}

export const advanceBlocks = async (blocks: number) => {
  let ps = [];
  for (let i = 0; i < blocks; i++) {
    ps.push(ethers.provider.send("evm_mine", []));
    if (i % 5000 === 0) {
      await Promise.all(ps);
      ps = [];
    }
  }
};
