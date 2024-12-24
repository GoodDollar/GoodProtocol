import { network, ethers, upgrades, run } from "hardhat";
import { Contract } from "ethers";

import { verifyProductionSigner } from "./helpers";
import releaser from "../../scripts/releaser";
import dao from "../../releases/deployment.json";

const { name } = network;

export const deployUniversalProxyFactory = async () => {
  const f = await ethers.getContractFactory("ProxyFactory1967");
  const isProduction = name.includes("production");
  const deployTx = {
    nonce: 0,
    gasPrice: 50e9,
    gasLimit: 891002,
    data: f.bytecode
  };

  let signer = {
    v: 27,
    r: "0x2222222222222222222222222222222222222222222222222222222222222222",
    s: "0x2222222222222222222222222222222222222222222222222222222222222222"
  };
  //modify tx data a little so we get different contract address for different envs
  if (name.includes("development-base")) {
    deployTx.gasPrice = 7e7;
  }
  if (name.includes("staging")) {
    deployTx.gasLimit = 892000;
  } else if (name.includes("production")) {
    deployTx.gasLimit = 890000;
  }

  const rawTx = ethers.utils.serializeTransaction(deployTx);
  const txHash = ethers.utils.keccak256(rawTx);
  const deployer = ethers.utils.recoverAddress(txHash, signer);
  let [funder] = await ethers.getSigners();

  const curBalance = await ethers.provider.getBalance(deployer);
  const deployCost = ethers.BigNumber.from(deployTx.gasPrice).mul(deployTx.gasLimit);

  let tx = {};
  if (curBalance.lt(deployCost)) {
    tx = await (
      await funder.sendTransaction({
        to: deployer,
        value: deployCost.sub(curBalance)
      })
    ).wait();
  }

  if (isProduction) verifyProductionSigner(funder);

  console.log({
    fundingTx: tx.transactionHash,
    deployer,
    funder: funder.address,
    deployerBalance: ethers.utils.formatUnits(await ethers.provider.getBalance(deployer))
  });
  const signedTx = ethers.utils.serializeTransaction(deployTx, signer);
  const proxyTx = await ethers.provider.sendTransaction(signedTx);
  console.log({ proxyTx });
  const result = await proxyTx.wait();
  return ethers.getContractAt("ProxyFactory1967", result.contractAddress);
};

export const deployProxy = async (defaultAdmin = null) => {
  let release: { [key: string]: any } = dao[network.name] || {};

  if (network.name.match(/production|staging|fuse|development/) && release.ProxyFactory) {
    throw new Error("ProxyFactory already exists for env");
  }
  // let [root] = await ethers.getSigners();
  // //generic call permissions
  // let schemeMock = root;

  // console.log("got signers:", {
  //   network,
  //   root: root.address,
  //   schemeMock: schemeMock.address,
  //   balance: await ethers.provider
  //     .getBalance(root.address)
  //     .then(_ => _.toString())
  // });

  // const proxyFactory = await (
  //   await ethers.getContractFactory("ProxyFactory1967")
  // ).deploy();

  const proxyFactory = await deployUniversalProxyFactory();

  release = {
    ProxyFactory: proxyFactory.address
  };
  await releaser(release, network.name, "deployment", false);
};

export const main = async (networkName = name) => {
  await deployProxy();
};

if (process.argv[1].includes("proxyFactory-deploy")) {
  main();
}
