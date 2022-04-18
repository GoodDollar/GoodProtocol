import { expect } from "chai";
import { ethers } from "hardhat";
import { createDAO } from "../helpers";

describe("DAOUpgradeableContract", () => {
  let dai, avatar, controller, schemeMock, signers, genericCall;

  before(async () => {
    signers = await ethers.getSigners();
    schemeMock = signers.pop();
    const daiFactory = await ethers.getContractFactory("DAIMock");

    dai = await daiFactory.deploy();

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      genericCall: gc
    } = await createDAO();

    controller = ctrl;
    avatar = av;
    genericCall = gc;
    console.log("deployed dao", {
      gd,
      identity,
      controller,
      avatar
    });
  });

  it("should authorize upgrade for dao upgradeable contract only when when avatar", async () => {
    const daoUpgradeableContractMockFactory = await ethers.getContractFactory(
      "DAOUpgradeableContractMock"
    );
    const daoUpgradeableContractMock = await daoUpgradeableContractMockFactory.deploy();

    // Work when avatar
    const encoded = daoUpgradeableContractMockFactory.interface.encodeFunctionData("authorizeUpgrade", [
      dai.address
    ]);
    expect(genericCall(daoUpgradeableContractMock.address, encoded)).to.not.be.reverted;

    //Fail when not avatar
    expect(daoUpgradeableContractMock.authorizeUpgrade(dai.address)).to.be.revertedWith(
      "only avatar can call this method"
    );
  });
});