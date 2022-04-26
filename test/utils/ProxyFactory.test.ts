import hre, { ethers } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { expect } from "chai";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { ProxyFactory1967, ERC1967Proxy } from "../../types";
import { createDAO } from "../helpers";

const BN = ethers.BigNumber;
const MaxUint256 = ethers.constants.MaxUint256;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("proxyfactory", () => {
  let factory: ProxyFactory1967, factory2: ProxyFactory1967, signers, avatar, genericCall;
  let proxy, proxy2;
  before(async () => {
    signers = await ethers.getSigners();
    const f = await ethers.getContractFactory("ProxyFactory1967");
    const f2 = await ethers.getContractFactory("ProxyFactory1967");
    factory = (await f.deploy()) as unknown as ProxyFactory1967;
    factory2 = (await f2.deploy()) as unknown as ProxyFactory1967;
    
    let {
      // controller: ctrl,
      avatar: av,
      // gd,
      // identity,
      genericCall: gc
    } = await createDAO();

    avatar = av;
    genericCall = gc;
  });

  it("[@skip-on-coverage] [hardhat BUG] should deploy with linked library", async () => {
    const uf = await ethers.getContractFactory("UniswapV2SwapHelper");
    const uniswap = await uf.deploy();
    const Contract = await ethers.getContractFactory("CompoundStakingFactory", {
      libraries: { UniswapV2SwapHelper: uniswap.address }
    });
    expect(
      await factory.deployCode(308932532, Contract.bytecode).catch(e => e)
    ).to.be.an("error");
    // const tx = await (
    //   await factory.deployCode(308932532, Contract.bytecode)
    // ).wait();
    // const event = tx.events.find(_ => _.event === "ContractDeployed");
    // expect(event).not.empty;
  });

  it("should deploy non upgradable code", async () => {
    const Contract = await ethers.getContractFactory("UniswapV2SwapHelper");
    const constructor = Contract.interface.encodeDeploy([]);
    const bytecode = ethers.utils.solidityPack(
      ["bytes", "bytes"],
      [Contract.bytecode, constructor]
    );
    // const deployTX = await (await factory.deployCode(123, bytecode)).wait();
    // const proxyAddr = deployTX.events.find(_ => _.event === "ContractCreated")
    //   .args.addr;
    // expect(proxyAddr).to.equal(
    //   await factory["getDeploymentAddress(uint256,address,bytes32)"](
    //     123,
    //     signers[0].address,
    //     ethers.utils.keccak256(bytecode)
    //   )
    // );

    const encodedData = factory2.interface.encodeFunctionData(
      "deployCode",
      [123, bytecode]
    );
    const deployTX2 = await (await genericCall(factory2.address, encodedData)).wait();
  });

  it("should deploy proxy with impl", async () => {
    // const c1 = await (
    //   await ethers.getContractFactory("UpgradableMock")
    // ).deploy();
    // const deployTX = await (
    //   await factory.deployProxy(1, c1.address, ethers.utils.toUtf8Bytes(""))
    // ).wait();
    // const proxyAddr = deployTX.events.find(_ => _.event === "ProxyCreated").args
    //   .proxy;
    // proxy = await ethers.getContractAt("UpgradableMock", proxyAddr);
    // expect(await proxy.decimals()).to.eq(8);

    const c2 = await (
      await ethers.getContractFactory("UpgradableMock")
    ).deploy();
    
    const encodedData = factory2.interface.encodeFunctionData(
      "deployProxy",
      [1, c2.address, ethers.utils.toUtf8Bytes("")]
    );
    const deployTX2 = await (await genericCall(factory2.address, encodedData)).wait();
    console.log({events: deployTX2.events});
    const proxyAddr2 = deployTX2.events.find(_ => _.event === "ProxyCreated").args;
    proxy2 = await ethers.getContractAt("UpgradableMock", proxyAddr2);
    expect(await proxy2.decimals()).to.eq(8);
  });

  it("should autorize update when avatar", async () => {
    const c2 = await (
      await ethers.getContractFactory("UpgradableMock3")
    ).deploy();
    
	// Remove this
  // const deployTX = await (await proxy.upgradeTo(c2.address)).wait();
    
    //Insert this
    const encodedData = proxy2.interface.encodeFunctionData(
      "upgradeTo",
      [c2.address]
    );
    const deployTX = await (await genericCall(proxy2.address, encodedData)).wait();
    
    const upgradedAddress = deployTX.events.find(_ => _.event === "Upgraded")
    .args.implementation;
    expect(upgradedAddress).to.eq(c2.address);
    expect(await proxy.decimals()).to.eq(14);
  });

  // it("should be able to upgrade impl", async () => {
  //   const c2 = await (
  //     await ethers.getContractFactory("UpgradableMock2")
  //   ).deploy();
  //   await proxy.upgradeTo(c2.address);
  //   expect(await proxy.decimals()).to.eq(18);
  // });

  // it("should not be upgradable if not authorized", async () => {
  //   const c1 = await (
  //     await ethers.getContractFactory("UpgradableMock")
  //   ).deploy();
  //   await expect(proxy.connect(signers[1]).upgradeTo(c1.address)).revertedWith(
  //     "authorized"
  //   );
  //   expect(await proxy.decimals()).to.eq(18);
  // });

  // it("should deploy proxy with impl and initialize it", async () => {
  //   const c1 = await (
  //     await ethers.getContractFactory("UpgradableMock")
  //   ).deploy();
  //   const encoded = c1.interface.encodeFunctionData("initialize", [
  //     signers[2].address
  //   ]);
  //   const deployTX = await (
  //     await factory.deployProxy(3, c1.address, encoded)
  //   ).wait();
  //   const proxyAddr = deployTX.events.find(_ => _.event === "ProxyCreated").args
  //     .proxy;
  //   proxy = await ethers.getContractAt("UpgradableMock", proxyAddr);
  //   expect(await proxy.owner()).to.eq(signers[2].address);
  // });

  // it("should not be able to re-initialize proxy", async () => {
  //   const c1 = await (
  //     await ethers.getContractFactory("UpgradableMock")
  //   ).deploy();
  //   const encoded = c1.interface.encodeFunctionData("initialize", [
  //     signers[2].address
  //   ]);

  //   const deployTX = await (
  //     await factory.deployProxy(4, c1.address, encoded)
  //   ).wait();
  //   const proxyAddr = deployTX.events.find(_ => _.event === "ProxyCreated").args
  //     .proxy;
  //   let proxy = await ethers.getContractAt("ERC1967Proxy", proxyAddr);

  //   const c2 = await (
  //     await ethers.getContractFactory("UpgradableMock")
  //   ).deploy();

  //   const encoded2 = c1.interface.encodeFunctionData("initialize", [
  //     signers[3].address
  //   ]);

  //   await expect(
  //     proxy["initialize(address,bytes)"](c2.address, encoded)
  //   ).revertedWith("initialized");

  //   let orgproxy = await ethers.getContractAt("UpgradableMock", proxyAddr);
  //   expect(await orgproxy.owner()).to.eq(signers[2].address);
  // });

  // it("should use deploy minimal to deploy proxy with impl and initialize it", async () => {
  //   const c1 = await (
  //     await ethers.getContractFactory("UpgradableMock")
  //   ).deploy();

  //   const encoded = c1.interface.encodeFunctionData("initialize", [
  //     signers[2].address
  //   ]);
  //   const deployTX = await (
  //     await factory.deployMinimal(c1.address, encoded)
  //   ).wait();
  //   const proxyAddr = deployTX.events.find(_ => _.event === "ProxyCreated").args
  //     .proxy;
  //   proxy = await ethers.getContractAt("UpgradableMock", proxyAddr);
  //   expect(await proxy.owner()).to.eq(signers[2].address);
  // });  
});
