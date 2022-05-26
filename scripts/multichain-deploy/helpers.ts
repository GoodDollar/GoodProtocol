import { ContractFactory } from "ethers";
import { network, ethers, upgrades, run } from "hardhat";

let totalGas = 0;
const gasUsage = {};
const GAS_SETTINGS = {};
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
    if (!network.name.startsWith("production")) {
      proxyFactory = await (
        await ethers.getContractFactory("ProxyFactory1967")
      ).deploy();
    } else
      proxyFactory = await ethers.getContractAt(
        "ProxyFactory1967",
        "0x99C22e78A579e2176311c736C4c9F0b0D5A47806"
      );
    const Contract =
      (contract.factory as ContractFactory) ||
      (await ethers.getContractFactory(contract.name, factoryOpts));

    const salt = ethers.BigNumber.from(
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes(contract.name))
    );

    if (contract.isUpgradable === true) {
      console.log("Deploying:", contract.name, "using proxyfactory");
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
      console.log("Deploying:", contract.name, "using proxyfactory code");
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
