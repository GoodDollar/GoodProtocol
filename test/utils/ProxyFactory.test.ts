import hre, { ethers } from "hardhat";
import { BigNumber, Contract } from "ethers";
import { expect } from "chai";
import { deployMockContract, MockContract } from "ethereum-waffle";

import { ProxyFactory1967, ERC1967Proxy } from "../../types";
const BN = ethers.BigNumber;
const MaxUint256 = ethers.constants.MaxUint256;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("proxyfactory", () => {
  let factory: ProxyFactory1967, signers;
  let proxy;
  before(async () => {
    signers = await ethers.getSigners();
    const f = await ethers.getContractFactory("ProxyFactory1967");
    factory = (await f.deploy()) as unknown as ProxyFactory1967;
  });

  it("[hardhat BUG] should deploy with linked library", async () => {
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
    const deployTX = await (await factory.deployCode(123, bytecode)).wait();
    const proxyAddr = deployTX.events.find(_ => _.event === "ContractCreated")
      .args.addr;
    expect(proxyAddr).to.equal(
      await factory["getDeploymentAddress(uint256,address,bytes32)"](
        123,
        signers[0].address,
        ethers.utils.keccak256(bytecode)
      )
    );
  });

  it("should deploy proxy with impl", async () => {
    const c1 = await (
      await ethers.getContractFactory("UpgradableMock")
    ).deploy();
    const deployTX = await (
      await factory.deployProxy(1, c1.address, ethers.utils.toUtf8Bytes(""))
    ).wait();
    const proxyAddr = deployTX.events.find(_ => _.event === "ProxyCreated").args
      .proxy;
    proxy = await ethers.getContractAt("UpgradableMock", proxyAddr);
    expect(await proxy.decimals()).to.eq(8);
  });

  it("should be able to upgrade impl", async () => {
    const c2 = await (
      await ethers.getContractFactory("UpgradableMock2")
    ).deploy();
    await proxy.upgradeTo(c2.address);
    expect(await proxy.decimals()).to.eq(18);
  });

  it("should not be upgradable if not authorized", async () => {
    const c1 = await (
      await ethers.getContractFactory("UpgradableMock")
    ).deploy();
    await expect(proxy.connect(signers[1]).upgradeTo(c1.address)).revertedWith(
      "authorized"
    );
    expect(await proxy.decimals()).to.eq(18);
  });

  it("should deploy proxy with impl and initialize it", async () => {
    const c1 = await (
      await ethers.getContractFactory("UpgradableMock")
    ).deploy();
    const encoded = c1.interface.encodeFunctionData("initialize", [
      signers[2].address
    ]);
    const deployTX = await (
      await factory.deployProxy(3, c1.address, encoded)
    ).wait();
    const proxyAddr = deployTX.events.find(_ => _.event === "ProxyCreated").args
      .proxy;
    proxy = await ethers.getContractAt("UpgradableMock", proxyAddr);
    expect(await proxy.owner()).to.eq(signers[2].address);
  });
});
