import { readFileSync } from "fs";
import { Contract, ContractFactory, Signer } from "ethers";
import { network, ethers } from "hardhat";
import { TransactionResponse, TransactionReceipt } from "@ethersproject/providers";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";

import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData } from "@safe-global/types-kit";

import util from "util";
import dao from "../../releases/deployment.json";
import { ProxyFactory1967 } from "../../types";

const exec = util.promisify(require("child_process").exec);

const networkName = network.name;
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
  const withNFTs = !!(superfluidInflowNFTLogic && superfluidOutflowNFTLogic);
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

  let OutFlowNFT = await ethers.getContractAt("ConstantOutflowNFT", ethers.constants.AddressZero);
  let InFlowNFT = await ethers.getContractAt("ConstantOutflowNFT", ethers.constants.AddressZero);

  if (withNFTs) {
    OutFlowNFT = (await deployDeterministic(
      {
        name: "SuperGoodDollar OutflowNFT",
        factory: uupsFactory
      },
      []
    ).then(printDeploy)) as Contract;

    InFlowNFT = (await deployDeterministic(
      {
        name: "SuperGoodDollar InflowNFT",
        factory: uupsFactory
      },
      []
    ).then(printDeploy)) as Contract;

    console.log("initializing superfluid nfts proxies");
    await OutFlowNFT.initializeProxy(superfluidOutflowNFTLogic);
    await InFlowNFT.initializeProxy(superfluidInflowNFTLogic);
  }
  console.log("initializing supergooddollar");
  await SuperGoodDollar.attach(GoodDollarProxy.address)[
    "initialize(string,string,uint256,address,address,address,address)"
  ](...tokenArgs);

  const GoodDollar = await ethers.getContractAt("ISuperGoodDollar", GoodDollarProxy.address);

  if (withNFTs) {
    const constantInflowNFT = await ethers.getContractAt("ConstantInflowNFT", InFlowNFT.address);

    const constantOutflowNFT = await ethers.getContractAt("ConstantOutflowNFT", OutFlowNFT.address);

    console.log("initializing inflow and outflow nfts");
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
  }
  return GoodDollar;
};

export const deployDeterministic = async (contract, args: any[], factoryOpts = {}, redeployProxyFactory = false) => {
  try {
    let proxyFactory: ProxyFactory1967;
    if (networkName.startsWith("develop") && redeployProxyFactory) {
      proxyFactory = (await (await ethers.getContractFactory("ProxyFactory1967")).deploy()) as ProxyFactory1967;
    } else proxyFactory = (await ethers.getContractAt("ProxyFactory1967", release.ProxyFactory)) as ProxyFactory1967;
    const Contract =
      (contract.factory as ContractFactory) || (await ethers.getContractFactory(contract.name, factoryOpts));

    const salt = ethers.BigNumber.from(
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes(contract.salt || contract.name))
    );

    if (contract.isUpgradeable === true) {
      const proxyAddr = await proxyFactory["getDeploymentAddress(uint256,address)"](
        salt,
        await proxyFactory.signer.getAddress()
      );
      const code = await ethers.provider.getCode(proxyAddr);
      if (code && code !== "0x") {
        const implAddr = await getImplementationAddress(ethers.provider, proxyAddr).catch(e => "0x");
        if (implAddr && implAddr !== "0x") {
          console.log("proxy exists and impl set already:", contract.name, proxyAddr, implAddr);
          return Contract.attach(proxyAddr);
        }
      }

      console.log("Deploying:", contract.name, "using proxyfactory", {
        args,
        proxyAddr,
        proxyFactory: proxyFactory.address
      });

      const encoded = Contract.interface.encodeFunctionData(contract.initializer || "initialize", args);
      const tx = await Contract.deploy(GAS_SETTINGS);
      const impl = await tx.deployed();
      console.log("implementation deployed:", contract.name, impl.address);
      await countTotalGas(tx, contract.name);
      let tx2;
      try {
        if (contract.withProxyFactory === false) {
          console.log("deploying proxy without proxy factory", { salt, impl: impl.address, encoded });
          const proxy = await ethers.getContractFactory("contracts/utils/ProxyFactory1967.sol:ERC1967Proxy");
          tx2 = await proxyFactory.deployCode(salt, proxy.bytecode, GAS_SETTINGS);
          await tx2.wait();
          console.log("proxy deployed initializing...", contract.name, proxyAddr, tx2.hash);
          tx2 = await proxy.attach(proxyAddr).initialize(impl.address, encoded);
          console.log("proxy initialized:", contract.name, proxyAddr, tx2.hash);
        } else {
          console.log("deploying proxy with proxyfactory", { salt, impl: impl.address, encoded });
          tx2 = await proxyFactory.deployProxy(salt, impl.address, encoded, GAS_SETTINGS);
        }
        await countTotalGas(tx2, contract.name);
        const deployTx = await tx2.wait();
      } catch (e) {
        console.error("failed to deploy proxy, assuming it exists...", e);
      }

      console.log("proxy deployed:", contract.name, proxyAddr);
      return Contract.attach(proxyAddr);
    } else {
      const constructor = Contract.interface.encodeDeploy(args);
      const bytecode = ethers.utils.solidityPack(["bytes", "bytes"], [Contract.bytecode, constructor]);
      const proxyAddr = await proxyFactory["getDeploymentAddress(uint256,address,bytes32)"](
        salt,
        await proxyFactory.signer.getAddress(),
        ethers.utils.keccak256(bytecode)
      );
      const code = await ethers.provider.getCode(proxyAddr);
      if (code && code !== "0x") {
        console.log("contract already exists:", contract.name, proxyAddr);
        return Contract.attach(proxyAddr);
      }

      console.log("Deploying:", contract.name, "using proxyfactory code", {
        proxyFactory: proxyFactory.address,
        args
      });

      const deployTx = await (await proxyFactory.deployCode(salt, bytecode, GAS_SETTINGS)).wait();

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

  // let safeSigner = new ethers.Wallet(
  //   process.env.SAFEOWNER_PRIVATE_KEY,
  //   new ethers.providers.JsonRpcProvider("https://rpc.flashbots.net")
  // );
  let chainId = 1;
  let provider = "https://mainnet.infura.io";
  if (typeof safeSignerOrNetwork === "string") {
    switch (safeSignerOrNetwork) {
      case "mainnet":
        break;
      case "celo":
        chainId = 42220;
        provider = "https://forno.celo.org";
        // safeSigner = new ethers.Wallet(process.env.SAFEOWNER_PRIVATE_KEY).connect(
        //   new ethers.providers.JsonRpcProvider("https://forno.celo.org")
        // );
        break;
      case "fuse":
        chainId = 122;
        provider = "https://rpc.fuse.io";
        // safeSigner = new ethers.Wallet(process.env.SAFEOWNER_PRIVATE_KEY).connect(
        //   new ethers.providers.JsonRpcProvider("https://rpc.fuse.io")
        // );
        break;
    }
  } else if (safeSignerOrNetwork) {
    // safeSigner = safeSignerOrNetwork as any;
  }

  console.log("safeSigner:", { chainId, safeAddress });
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
    provider,
    signer: process.env.SAFEOWNER_PRIVATE_KEY,
    safeAddress
  });

  const senderAddress = await safeSdk.getSafeProvider().getSignerAddress();

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

  // const senderAddress = await safeSigner.getAddress();
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
  contractPath,
  networkName = network.name,
  maybeProxy: boolean = true,
  forcedConstructorArguments?: string
) => {
  const impl = await getImplementationAddress(ethers.provider, address).catch(e => "");
  const contractAddress = maybeProxy ? impl || address : address;
  console.log("verifying contract:", { contractPath, address, impl, networkName, forcedConstructorArguments });
  const cmd = `yarn hardhat verify --contract ${contractPath} ${contractAddress} ${
    forcedConstructorArguments ?? ""
  } --network ${networkName}`;
  console.log("running...:", cmd);
  await exec(cmd)
    .then(({ stdout, stderr }) => {
      console.log("Result for:", cmd);
      console.log(stdout);
      console.log(stderr);
    })
    .catch(e => {
      console.error("Error verifying contract:", e);
    });
  if (maybeProxy && impl) {
    const chainid = network.config.chainId.toString();
    console.log("linking proxy to impl", { impl, address });
    const body = new URLSearchParams({
      chaini: network.config.chainId.toString(),
      apikey: process.env.ETHERSCAN_KEY,
      module: "contract",
      action: "verifyproxycontract",
      address
    });

    const response = await fetch(`https://api.etherscan.io/v2/api?chainid=${chainid}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const data = await response.json();
    if (data.status !== "1") {
      return console.log(`Proxy Verification submission failed: ${data.result}`);
    }

    const guid = data.result;
    console.log(`Proxy Verification submitted. GUID: ${guid}`);
  }
};

/**
 * Verify a flattened contract on Etherscan
 * @param {string} contractPath - Path to the contract (e.g., contracts/MyContract.sol)
 * @param {string} contractName - Contract name (e.g., MyContract)
 * @param {string} contractAddress - Deployed contract address
 * @param {string} compilerVersion - Compiler version (e.g., v0.8.24+commit.e11b9ed9)
 * @param {Array} constructorArgs - Object with {types:[], values:[]} for encoding
 */
export async function verifyOnEtherscan(
  chainid,
  contractPath,
  contractName,
  contractAddress,
  compilerVersion,
  constructorArgs = { types: [], values: [] }
) {
  const apiKey = process.env.ETHERSCAN_KEY;
  if (!apiKey) {
    throw new Error("ETHERSCAN_API_KEY not set in .env");
  }

  const sourceCode = readFileSync(contractPath, "utf8");

  let constructorEncoded = "";
  if (constructorArgs.types && constructorArgs.values) {
    constructorEncoded = ethers.utils.defaultAbiCoder.encode(constructorArgs.types, constructorArgs.values).slice(2); // Remove '0x'
  }

  console.log("Submitting verification request to Etherscan...", { chainid, contractAddress, contractName });

  const body = new URLSearchParams({
    chainid,
    apikey: apiKey,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: contractAddress,
    sourceCode: sourceCode,
    codeformat: "solidity-single-file",
    contractname: contractName,
    compilerversion: compilerVersion,
    optimizationUsed: "1",
    runs: "200",
    constructorArguements: constructorEncoded
  });

  const response = await fetch(`https://api.etherscan.io/v2/api?chainid=${chainid}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await response.json();
  if (data.status !== "1") {
    return console.log(`Verification submission failed: ${data.result}`);
  }

  const guid = data.result;
  console.log(`Verification submitted. GUID: ${guid}`);
}
