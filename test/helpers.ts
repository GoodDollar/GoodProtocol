import { ethers } from "hardhat";

import DAOCreatorABI from "@gooddollar/goodcontracts/build/contracts/DaoCreatorGoodDollar.json";
import IdentityABI from "@gooddollar/goodcontracts/build/contracts/Identity.json";
import FeeFormulaABI from "@gooddollar/goodcontracts/build/contracts/FeeFormula.json";
import AddFoundersABI from "@gooddollar/goodcontracts/build/contracts/AddFoundersGoodDollar.json";

export const createDAO = async () => {
  let [root] = await ethers.getSigners();
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

  const AddFounders = await AddFoundersFactory.deploy();
  const Identity = await IdentityFactory.deploy();
  const daoCreator = await DAOCreatorFactory.deploy(AddFounders.address);
  const FeeFormula = await FeeFormulaFactory.deploy(0);

  await daoCreator.forgeOrg(
    "G$",
    "G$",
    10000,
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
  return {
    daoCreator,
    controller,
    avatar: await daoCreator.avatar(),
    gd: await Avatar.nativeToken(),
    identity: Identity.address
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