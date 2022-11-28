import { Contract, ContractFactory, Signer } from "ethers";
import { network, ethers, upgrades, run } from "hardhat";
import * as safeethers from "ethers";
import { TransactionResponse } from "@ethersproject/providers";
import Safe from "@gnosis.pm/safe-core-sdk";
import EthersAdapter from "@gnosis.pm/safe-ethers-lib";
import { MetaTransactionData } from "@gnosis.pm/safe-core-sdk-types";

import dao from "../../releases/deployment.json";

const networkName =
  network.name === "localhost" ? "production-mainnet" : network.name;
let totalGas = 0;
const gasUsage = {};
const GAS_SETTINGS = { gasLimit: 5000000 };
let release: { [key: string]: any } = dao[networkName];

export const printDeploy = async (
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

export const countTotalGas = async (tx, name) => {
  let res = tx;
  if (tx.deployTransaction) tx = tx.deployTransaction;
  if (tx.wait) res = await tx.wait();
  if (res.gasUsed) {
    totalGas += parseInt(res.gasUsed);
    gasUsage[name] = gasUsage[name] || 0;
    gasUsage[name] += parseInt(res.gasUsed);
  } else console.log("no gas data", { res, tx });
};

export const deployDeterministic = async (
  contract,
  args: any[],
  factoryOpts = {}
) => {
  try {
    let proxyFactory;
    if (networkName.startsWith("develop")) {
      proxyFactory = await (
        await ethers.getContractFactory("ProxyFactory1967")
      ).deploy();
    } else
      proxyFactory = await ethers.getContractAt(
        "ProxyFactory1967",
        release.ProxyFactory
      );
    const Contract =
      (contract.factory as ContractFactory) ||
      (await ethers.getContractFactory(contract.name, factoryOpts));

    const salt = ethers.BigNumber.from(
      ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(contract.salt || contract.name)
      )
    );

    if (contract.isUpgradeable === true) {
      console.log("Deploying:", contract.name, "using proxyfactory", {
        args,
        proxyFactory: proxyFactory.address
      });
      const encoded = Contract.interface.encodeFunctionData(
        contract.initializer || "initialize",
        args
      );
      const tx = await Contract.deploy(GAS_SETTINGS);
      const impl = await tx.deployed();
      console.log("implementation deployed:", contract.name, impl.address);
      await countTotalGas(tx, contract.name);

      const tx2 = await proxyFactory.deployProxy(
        salt,
        impl.address,
        encoded,
        GAS_SETTINGS
      );
      await countTotalGas(tx2, contract.name);
      const deployTx = await tx2
        .wait()
        .catch(e =>
          console.error("failed to deploy proxy, assuming it exists...", e)
        );
      const proxyAddr = await proxyFactory[
        "getDeploymentAddress(uint256,address)"
      ](salt, await proxyFactory.signer.getAddress());
      console.log("proxy deployed:", contract.name, proxyAddr);
      return Contract.attach(proxyAddr);
    } else {
      console.log("Deploying:", contract.name, "using proxyfactory code", {
        proxyFactory: proxyFactory.address,
        args
      });
      const constructor = Contract.interface.encodeDeploy(args);
      const bytecode = ethers.utils.solidityPack(
        ["bytes", "bytes"],
        [Contract.bytecode, constructor]
      );
      const deployTx = await (
        await proxyFactory.deployCode(salt, bytecode, GAS_SETTINGS)
      ).wait();

      const proxyAddr = await proxyFactory[
        "getDeploymentAddress(uint256,address,bytes32)"
      ](
        salt,
        await proxyFactory.signer.getAddress(),
        ethers.utils.keccak256(bytecode)
      );
      console.log("proxy deployed:", contract.name, proxyAddr);

      return Contract.attach(proxyAddr);
    }
  } catch (e) {
    console.log("Failed deploying contract:", { contract });
    throw e;
  }
};

export const executeViaGuardian = async (
  contracts,
  ethValues,
  functionSigs,
  functionInputs,
  guardian: Signer
) => {
  let release: { [key: string]: any } = dao[networkName];
  const ctrl = await (
    await ethers.getContractAt("Controller", release.Controller)
  ).connect(guardian);

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    console.log("executing:", contracts[i], functionSigs[i], functionInputs[i]);
    const sigHash = ethers.utils
      .keccak256(ethers.utils.toUtf8Bytes(functionSigs[i]))
      .slice(0, 10);
    const encoded = ethers.utils.solidityPack(
      ["bytes4", "bytes"],
      [sigHash, functionInputs[i]]
    );
    if (contract === ctrl.address) {
      console.log("executing directly on controller:", sigHash, encoded);

      await guardian
        .sendTransaction({ to: contract, data: encoded })
        .then(printDeploy);
    } else {
      const simulationResult = await ctrl.callStatic.genericCall(
        contract,
        encoded,
        release.Avatar,
        ethValues[i],
        { from: await guardian.getAddress() }
      );
      console.log("executing genericCall:", {
        sigHash,
        encoded,
        simulationResult
      });
      await ctrl
        .genericCall(contract, encoded, release.Avatar, ethValues[i])
        .then(printDeploy);
    }
  }
};

export const executeViaSafe = async (
  contracts,
  ethValues,
  functionSigs,
  functionInputs,
  safeAddress: string,
  safeSigner: Signer
) => {
  const ethAdapter = new EthersAdapter({
    ethers,
    signer: safeSigner
  } as any);
  const safeSdk = await Safe.create({ ethAdapter, safeAddress });

  let release: { [key: string]: any } = dao[networkName];
  const ctrl = await await ethers.getContractAt(
    "Controller",
    release.Controller
  );

  const safeTransactionData: MetaTransactionData[] = [];

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    console.log(
      "creating tx:",
      contracts[i],
      functionSigs[i],
      functionInputs[i]
    );
    const sigHash = ethers.utils
      .keccak256(ethers.utils.toUtf8Bytes(functionSigs[i]))
      .slice(0, 10);
    const encoded = ethers.utils.solidityPack(
      ["bytes4", "bytes"],
      [sigHash, functionInputs[i]]
    );
    if (contract === ctrl.address) {
      const simulationResult = await ctrl.callStatic[functionSigs[i]](
        ...functionInputs[i],
        { from: safeAddress, value: ethValues[i] }
      );
      console.log("executing directly on controller:", {
        sigHash,
        encoded,
        simulationResult
      });
      safeTransactionData.push({
        to: ctrl.address,
        value: ethValues[i],
        data: encoded
      });
    } else {
      const simulationResult = await ctrl.callStatic.genericCall(
        contract,
        encoded,
        release.Avatar,
        ethValues[i],
        { from: safeAddress }
      );
      console.log("executing genericCall:", {
        sigHash,
        encoded,
        simulationResult
      });
      const genericEncode = ctrl.interface.encodeFunctionData("genericCall", [
        contract,
        encoded,
        release.Avatar,
        ethValues[i]
      ]);
      safeTransactionData.push({
        to: ctrl.address,
        value: ethValues[i],
        data: genericEncode
      });
    }
  }

  const safeTransaction = await safeSdk.createTransaction({
    safeTransactionData
  });
  console.log({ safeTransaction });
  const signedTx = await safeSdk.signTransaction(safeTransaction);
};
