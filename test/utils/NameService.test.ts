import { expect } from "chai";
import { ethers } from "hardhat";
import { createDAO } from "../helpers";

describe("NameService - Setup and functionalities", () => {
  let nameService, dai, avatar, controller, schemeMock, signers, genericCall;

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
      genericCall: gc
    } = await createDAO();

    controller = ctrl;
    avatar = av;
    nameService = ns;
    genericCall = gc;
    console.log("deployed dao", {
      gd,
      identity,
      controller,
      avatar
    });

    await setSchemes([schemeMock.address]);
  });

  it(" address should not be set  ", async () => {
    await expect(nameService.setAddress("DAI", dai.address)).to.be.revertedWith(
      "only avatar can call this method"
    );
  });

  it(" addresses should not be set  ", async () => {
    await expect(
      nameService.setAddresses(
        [
          ethers.utils.formatBytes32String("DAI"),
          ethers.utils.formatBytes32String("cDAI")
        ],
        [(signers[0].address, signers[1].address)]
      )
    ).to.be.revertedWith("only avatar can call this method");
  });

  it("should set address by avatar", async () => {
    const nsFactory = await ethers.getContractFactory("NameService");
    const encoded = nsFactory.interface.encodeFunctionData("setAddress", [
      "DAI",
      dai.address
    ]);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(nameService.address, encoded, avatar, 0);
    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address);
  });

  it("should set multiple addresses by avatar", async () => {
    const nsFactory = await ethers.getContractFactory("NameService");
    const encoded = nsFactory.interface.encodeFunctionData("setAddresses", [
      [
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("DAI")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("cDAI"))
      ],
      [signers[0].address, signers[1].address]
    ]);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(nameService.address, encoded, avatar, 0);
    expect(await nameService.getAddress("DAI")).to.be.equal(signers[0].address);
    expect(await nameService.getAddress("cDAI")).to.be.equal(
      signers[1].address
    );
  });

  it("Should authorize upgrade for name service only by avatar", async () => {
    const nameServiceMockFactory = await ethers.getContractFactory(
      "NameServiceMock"
    );
    const nameServiceMock = await nameServiceMockFactory.deploy();
    // Work when avatar
    const encoded = nameServiceMockFactory.interface.encodeFunctionData("authorizeUpgrade", [
      dai.address
    ]);
    await expect(genericCall(nameServiceMock.address, encoded)).to.not.be.reverted;

    // Fail when not avatar
    expect(nameServiceMock.authorizeUpgrade(dai.address)).to.be.revertedWith(
      "only avatar can call this method"
    );
  });
});
