import { Contract, ContractFactory, Signer } from "ethers";
import { network, ethers, upgrades, run } from "hardhat";
import * as safeethers from "ethers";
import { TransactionResponse, TransactionReceipt } from "@ethersproject/providers";
// import Safe from "@gnosis.pm/safe-core-sdk";
import EthersAdapter from "@gnosis.pm/safe-ethers-lib";
// import { MetaTransactionData } from "@gnosis.pm/safe-core-sdk-types";
// import SafeClient from "@gnosis.pm/safe-service-client";

import SafeApiKit from "@safe-global/api-kit";
import Safe, { Eip1193Provider } from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";

import util from "util";
import dao from "../../releases/deployment.json";

const exec = util.promisify(require("child_process").exec);

const networkName = network.name === "localhost" ? "production-mainnet" : network.name;
let totalGas = 0;
const gasUsage = {};
const GAS_SETTINGS = { gasLimit: 10000000 };
let release: { [key: string]: any } = dao[networkName];

export const verifyProductionSigner = signer => {
  if (signer.address.toLowerCase() !== "0x5128E3C1f8846724cc1007Af9b4189713922E4BB".toLowerCase()) {
    throw new Error(
      "signer not 0x5128E3C1f8846724cc1007Af9b4189713922E4BB to get same deployed addresses on production"
    );
  }
};
export const printDeploy = async (
  c: Contract | TransactionResponse
): Promise<Contract | TransactionReceipt | TransactionResponse> => {
  if (c instanceof Contract) {
    await c.deployed();
    console.log("deployed to: ", c.address);
    return c.deployed();
  }
  if (c.wait) {
    await c.wait();
    console.log("tx done:", c.hash);
    return c.wait();
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

export const deploySuperGoodDollar = async (
  { superfluidHost, superfluidInflowNFTLogic, superfluidOutflowNFTLogic },
  tokenArgs
) => {
  const SuperGoodDollar = (await deployDeterministic(
    {
      name: "SuperGoodDollar",
      salt: "SuperGoodDollarLogic"
    },
    [superfluidHost]
  ).then(printDeploy)) as Contract;

  const uupsFactory = await ethers.getContractFactory("UUPSProxy");
  const GoodDollarProxy = (await deployDeterministic(
    {
      name: "SuperGoodDollar",
      factory: uupsFactory
    },
    []
  ).then(printDeploy)) as Contract;

  await GoodDollarProxy.initializeProxy(SuperGoodDollar.address).then(printDeploy);

  const OutFlowNFT = (await deployDeterministic(
    {
      name: "SuperGoodDollar OutflowNFT",
      factory: uupsFactory
    },
    []
  ).then(printDeploy)) as Contract;

  const InFlowNFT = (await deployDeterministic(
    {
      name: "SuperGoodDollar InflowNFT",
      factory: uupsFactory
    },
    []
  ).then(printDeploy)) as Contract;

  await OutFlowNFT.initializeProxy(superfluidOutflowNFTLogic);
  await InFlowNFT.initializeProxy(superfluidInflowNFTLogic);

  await SuperGoodDollar.attach(GoodDollarProxy.address)[
    "initialize(string,string,uint256,address,address,address,address,address,address)"
  ](...tokenArgs, OutFlowNFT.address, InFlowNFT.address);

  const GoodDollar = await ethers.getContractAt("ISuperGoodDollar", GoodDollarProxy.address);

  const constantInflowNFT = await ethers.getContractAt("ConstantInflowNFT", InFlowNFT.address);

  const constantOutflowNFT = await ethers.getContractAt("ConstantOutflowNFT", OutFlowNFT.address);

  await constantOutflowNFT
    .attach(OutFlowNFT.address)
    .initialize(
      GoodDollarProxy.address,
      (await GoodDollar.symbol()) + " Outflow NFT",
      (await GoodDollar.symbol()) + " COF"
    );
  await constantInflowNFT
    .attach(InFlowNFT.address)
    .initialize(
      GoodDollarProxy.address,
      (await GoodDollar.symbol()) + " Inflow NFT",
      (await GoodDollar.symbol()) + " CIF"
    );

  return GoodDollar;
};

export const deployDeterministic = async (contract, args: any[], factoryOpts = {}, redeployProxyFactory = false) => {
  try {
    let proxyFactory;
    if (networkName.startsWith("develop") && redeployProxyFactory) {
      proxyFactory = await (await ethers.getContractFactory("ProxyFactory1967")).deploy();
    } else proxyFactory = await ethers.getContractAt("ProxyFactory1967", release.ProxyFactory);
    const Contract =
      (contract.factory as ContractFactory) || (await ethers.getContractFactory(contract.name, factoryOpts));

    const salt = ethers.BigNumber.from(
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes(contract.salt || contract.name))
    );

    if (contract.isUpgradeable === true) {
      console.log("Deploying:", contract.name, "using proxyfactory", {
        args,
        proxyFactory: proxyFactory.address
      });
      const encoded = Contract.interface.encodeFunctionData(contract.initializer || "initialize", args);
      const tx = await Contract.deploy(GAS_SETTINGS);
      const impl = await tx.deployed();
      console.log("implementation deployed:", contract.name, impl.address);
      await countTotalGas(tx, contract.name);

      const tx2 = await proxyFactory.deployProxy(salt, impl.address, encoded, GAS_SETTINGS);
      await countTotalGas(tx2, contract.name);
      const deployTx = await tx2.wait().catch(e => console.error("failed to deploy proxy, assuming it exists...", e));
      const proxyAddr = await proxyFactory["getDeploymentAddress(uint256,address)"](
        salt,
        await proxyFactory.signer.getAddress()
      );
      console.log("proxy deployed:", contract.name, proxyAddr);
      return Contract.attach(proxyAddr);
    } else {
      console.log("Deploying:", contract.name, "using proxyfactory code", {
        proxyFactory: proxyFactory.address,
        args
      });
      const constructor = Contract.interface.encodeDeploy(args);
      const bytecode = ethers.utils.solidityPack(["bytes", "bytes"], [Contract.bytecode, constructor]);
      const deployTx = await (await proxyFactory.deployCode(salt, bytecode, GAS_SETTINGS)).wait();

      const proxyAddr = await proxyFactory["getDeploymentAddress(uint256,address,bytes32)"](
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
  guardian: Signer,
  network?: string
) => {
  let release: { [key: string]: any } = dao[network || networkName];
  const ctrl = await (await ethers.getContractAt("Controller", release.Controller)).connect(guardian);

  const results = [];
  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    if (!contract) {
      console.warn("skipping executing missing contract", i, contracts[i], functionSigs[i], functionInputs[i]);
      continue;
    }
    console.log("executing:", contracts[i], functionSigs[i], functionInputs[i]);
    const sigHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(functionSigs[i])).slice(0, 10);
    const encoded = ethers.utils.solidityPack(["bytes4", "bytes"], [sigHash, functionInputs[i]]);
    if (contract.toLowerCase().startsWith((await guardian.getAddress()).toLocaleLowerCase())) {
      const [, target] = contract.split("_");
      console.log("executing directly on target contract:", sigHash, encoded);

      const tx = await guardian.sendTransaction({ to: target, data: encoded }).then(printDeploy);
      results.push(tx);
    } else if (contract === ctrl.address) {
      console.log("executing directly on controller:", sigHash, encoded);

      const tx = await guardian.sendTransaction({ to: contract, data: encoded }).then(printDeploy);

      results.push(tx);
    } else {
      const simulationResult = await ctrl.callStatic.genericCall(contract, encoded, release.Avatar, ethValues[i], {
        from: await guardian.getAddress()
      });
      console.log("executing genericCall:", {
        sigHash,
        contract,
        encoded,
        simulationResult
      });
      if (simulationResult[0] === false) throw new Error("simulation failed:" + contract);
      const tx = await ctrl
        .genericCall(contract, encoded, release.Avatar, ethValues[i], {
          gasLimit: 8000000
        })
        .then(printDeploy);
      // console.log("generic call events:", tx.events);
      results.push(tx);
    }
  }
  return results;
};

export const executeViaSafe = async (
  contracts,
  ethValues,
  functionSigs,
  functionInputs,
  safeAddress: string,
  safeSignerOrNetwork?: Signer | string,
  isSimulation = false
) => {
  if (typeof safeSignerOrNetwork !== "object" && !process.env.SAFEOWNER_PRIVATE_KEY) {
    throw new Error("safe signer is missing");
  }

  let safeSigner = new ethers.Wallet(
    process.env.SAFEOWNER_PRIVATE_KEY,
    new ethers.providers.JsonRpcProvider("https://rpc.flashbots.net")
  );
  if (typeof safeSignerOrNetwork === "string") {
    switch (safeSignerOrNetwork) {
      case "mainnet":
        break;
      case "celo":
        safeSigner = new ethers.Wallet(process.env.SAFEOWNER_PRIVATE_KEY).connect(
          new ethers.providers.JsonRpcProvider("https://forno.celo.org")
        );
        break;
      case "fuse":
        safeSigner = new ethers.Wallet(process.env.SAFEOWNER_PRIVATE_KEY).connect(
          new ethers.providers.JsonRpcProvider("https://rpc.fuse.io")
        );
        break;
    }
  } else if (safeSignerOrNetwork) {
    safeSigner = safeSignerOrNetwork as any;
  }
  const chainId = await safeSigner.getChainId();

  console.log("safeSigner:", safeSigner.address, { chainId, safeAddress });
  let txServiceUrl;
  switch (chainId) {
    case 1:
      txServiceUrl = "https://safe-transaction-mainnet.safe.global";
      break;
    case 122:
      txServiceUrl = "https://transaction-fuse.safe.fuse.io";
      break;
    case 42220:
      txServiceUrl = "https://safe-transaction-celo.safe.global";
      break;
  }
  console.log("creating safe adapter", { txServiceUrl });
  const safeService = new SafeApiKit({
    chainId: BigInt(chainId)
  });

  const safeSdk = await Safe.init({
    provider: "https://rpc.flashbots.net",
    signer: process.env.SAFEOWNER_PRIVATE_KEY,
    safeAddress
  });

  // console.log("creating safe client", { txServiceUrl });

  // const safeService = new SafeClient({
  //   txServiceUrl,
  //   ethAdapter
  // });

  // const safeSdk = await Safe.create({ ethAdapter, safeAddress });

  let release: { [key: string]: any } = dao[networkName];
  const ctrl = await ethers.getContractAt("Controller", release.Controller, null);

  const safeTransactionData: MetaTransactionData[] = [];

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];

    const sigHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(functionSigs[i])).slice(0, 10);
    console.log("creating tx:", contracts[i], functionSigs[i], functionInputs[i]);
    const encoded = ethers.utils.solidityPack(["bytes4", "bytes"], [sigHash, functionInputs[i]]);
    if (contract.toLowerCase().startsWith(safeAddress.toLocaleLowerCase())) {
      const [, target] = contract.split("_");
      const simulationResult = await ethers.provider.call({
        to: target,
        data: encoded,
        from: safeAddress,
        value: ethValues[i]
      });

      console.log("executing from guardians safe:", {
        sigHash,
        encoded,
        simulationResult
      });
      safeTransactionData.push({
        to: target,
        value: ethValues[i],
        data: encoded
      });
    } else if (contract === ctrl.address) {
      const simulationResult = await ethers.provider.call({
        to: ctrl.address,
        data: encoded,
        from: safeAddress,
        value: ethValues[i]
      });
      console.log("executing controller call:", {
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
      console.log("executing genericCall:", {
        sigHash,
        encoded,
        contract,
        avatar: release.Avatar,
        value: ethValues[i]
      });

      const simulationResult = await ctrl.callStatic.genericCall(contract, encoded, release.Avatar, ethValues[i], {
        from: safeAddress
      });
      console.log("executing genericCall simulation result:", {
        sigHash,
        simulationResult
      });
      if (isSimulation === true && simulationResult[0] === false) throw new Error("simulation failed:" + contract);
      const genericEncode = ctrl.interface.encodeFunctionData("genericCall", [
        contract,
        encoded,
        release.Avatar,
        ethValues[i]
      ]);
      safeTransactionData.push({
        to: ctrl.address,
        value: "0",
        data: genericEncode
      });
    }
  }

  const safeTransaction = await safeSdk.createTransaction({
    transactions: safeTransactionData
  });

  const safeTxHash = await safeSdk.getTransactionHash(safeTransaction);
  const signedHash = await safeSdk.signHash(safeTxHash);

  const senderAddress = await safeSigner.getAddress();
  console.log("propose safe transaction", {
    safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderSignature: signedHash,
    senderAddress
  });
  await safeService.proposeTransaction({
    safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderSignature: signedHash.data,
    senderAddress
  });
};

export const verifyContract = async (
  address,
  contractName,
  networkName = network.name,
  proxyName?: string,
  forcedConstructorArguments?: string
) => {
  let networkProvider = networkName.includes("-") ? networkName.split("-")[1] : "fuse";
  networkProvider = networkProvider === "mainnet" ? "ethereum" : networkProvider;
  console.log("truffle compile...");
  await exec("npx truffle compile");
  const cmd = `npx truffle run verify ${proxyName ? "--custom-proxy " + proxyName : ""} ${contractName}@${address} ${
    forcedConstructorArguments ? "--forceConstructorArgs string:" + forcedConstructorArguments.slice(2) : ""
  } --network ${networkProvider}`;
  console.log("running...:", cmd);
  await exec(cmd).then(({ stdout, stderr }) => {
    console.log("Result for:", cmd);
    console.log(stdout);
    console.log(stderr);
  });
};
