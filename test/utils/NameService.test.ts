import { expect } from "chai";
import { ethers, upgrades, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { createDAO } from "../helpers";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("NameService - Setup and functionalities", () => {
  let nameService,
    dai,
    avatar,
    controller,
    schemeMock,
    signers,
    genericCall,
    runAsAvatarOnly;

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
      daoCreator,
      nameService: ns,
      setDAOAddress: sda,
      setSchemes,
      marketMaker: mm,
      genericCall: gc,
      runAsAvatarOnly: raao
    } = await loadFixture(createDAO);

    controller = ctrl;
    avatar = av;
    nameService = ns;
    genericCall = gc;
    runAsAvatarOnly = raao;
    console.log("deployed dao", {
      gd,
      identity,
      controller,
      avatar
    });

    await setSchemes([schemeMock.address]);
  });

  it("should set address by avatar", async () => {
    await runAsAvatarOnly(
      nameService,
      "setAddress(string,address)",
      "DAI",
      dai.address
    );
    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address);
  });

  it("should set multiple addresses by avatar", async () => {
    await runAsAvatarOnly(
      nameService,
      "setAddresses(bytes32[],address[])",
      [
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("DAI")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("cDAI"))
      ],
      [signers[0].address, signers[1].address]
    );

    expect(await nameService.getAddress("DAI")).to.be.equal(signers[0].address);
    expect(await nameService.getAddress("cDAI")).to.be.equal(
      signers[1].address
    );
  });

  it("should authorize upgrade only for avatar", async () => {
    const nameServiceProxy = await upgrades.deployProxy(
      await ethers.getContractFactory("NameService"),
      [
        controller,
        ["CONTROLLER"].map(_ =>
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes(_))
        ),
        [controller]
      ],
      {
        kind: "uups"
      }
    );
    const implementationBeforeUpgrade = await getImplementationAddress(
      network.provider,
      nameServiceProxy.address
    );
    const newNameServiceLogic = await (
      await ethers.getContractFactory("NameService")
    ).deploy();
    const encodedData = nameServiceProxy.interface.encodeFunctionData(
      "upgradeTo",
      [newNameServiceLogic.address]
    );
    await (await genericCall(nameServiceProxy.address, encodedData)).wait();
    const implementationAfterUpgrade = await getImplementationAddress(
      network.provider,
      nameServiceProxy.address
    );
    expect(implementationBeforeUpgrade).to.not.equal(
      implementationAfterUpgrade
    );
    expect(implementationAfterUpgrade).to.equal(newNameServiceLogic.address);

    const newNameServiceLogic2 = await (
      await ethers.getContractFactory("NameService")
    ).deploy();
    await expect(
      nameServiceProxy.upgradeTo(newNameServiceLogic2.address)
    ).to.be.revertedWith("only avatar can call this method");
  });
});
