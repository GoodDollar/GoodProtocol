import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { createDAO } from "../helpers";

describe("DAOUpgradeableContract", () => {
  let signers, avatar, genericCall, controller, nameService;
  before(async () => {
    signers = await ethers.getSigners();

    let {
      controller: ctrl,
      avatar: av,
      genericCall: gc,
      nameService: ns
    } = await createDAO();

    avatar = av;
    genericCall = gc;
    controller = ctrl;
    nameService = ns;
  });

  it("should be able to authorize upgrade for dao upgradable contract", async () => {
    const upgradableMockFactory = await ethers.getContractFactory(
      "UpgradableMock3"
    );
    
    const daoUpgradableProxy = await upgrades.deployProxy(
      upgradableMockFactory,
      [nameService.address],
      { kind: "uups" }
    );
    const differentUpgradableMock = await (
      await ethers.getContractFactory("UpgradableMock4")
    ).deploy();
    const secondContractDecimals = await differentUpgradableMock.decimals();
    const decimalsBeforeUpgrade = await daoUpgradableProxy.decimals();
    const encodedData = daoUpgradableProxy.interface.encodeFunctionData(
      "upgradeTo",
      [differentUpgradableMock.address]
    );
    await (await genericCall(daoUpgradableProxy.address, encodedData)).wait();
    const decimalsAfterUpgrade = await daoUpgradableProxy.decimals();
    expect(decimalsBeforeUpgrade).to.not.eq(decimalsAfterUpgrade);
    expect(decimalsAfterUpgrade).to.eq(secondContractDecimals);
  });
});
