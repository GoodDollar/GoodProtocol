import "@openzeppelin/hardhat-upgrades"
import { ethers, upgrades } from "hardhat"

import SuperGoodDollarArtifact from "../artifacts/contracts/token/superfluid/SuperGoodDollar.sol/SuperGoodDollar.json"
import UUPSAritfact from "../artifacts/contracts/token/superfluid/UUPSProxy.sol/UUPSProxy.json"

import IdentityArtifact from "../artifacts/contracts/identity/IdentityV2.sol/IdentityV2.json";
import FeeFormulaABI from "@gooddollar/goodcontracts/build/contracts/FeeFormula.json";
import ERC1967Proxy from "../artifacts/contracts/utils/ProxyFactory1967.sol/ERC1967Proxy.json";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
type Signer = SignerWithAddress

export type TokenArgs = [string,string]

export const deploySuperGoodDollar = async (signer,sfContracts, tokenArgs = []) => {    
    const IdentityFactory = new ethers.ContractFactory(IdentityArtifact.abi,IdentityArtifact.bytecode, signer)

    
    const FeeFormulaFactory = new ethers.ContractFactory(
      FeeFormulaABI.abi,
      FeeFormulaABI.bytecode,
      signer
    );

    const FeeFormula = await FeeFormulaFactory.deploy(0);

    const proxyFactory = new ethers.ContractFactory(ERC1967Proxy.abi,ERC1967Proxy.bytecode, signer)
    const idProxy = await proxyFactory.deploy()
    const idLogic = await IdentityFactory.deploy()
    const encodedInit = idLogic.interface.encodeFunctionData("initialize",[await signer.getAddress(), ethers.constants.AddressZero])
    await idProxy.initialize(idLogic.address,encodedInit)
    
    // const Identity = await upgrades.deployProxy(
    //     IdentityFactory,
    //     [await signer.getAddress(), ethers.constants.AddressZero],
    //     { kind: "uups" }
    //   );

    const initializeArgs = [
        "GoodDollar",
        "G$",
        0, // cap
        FeeFormula.address,
        idProxy.address,
        ethers.constants.AddressZero,
        await signer.getAddress(), ...tokenArgs
      ]
    const SuperGoodDollarFactory = new ethers.ContractFactory(SuperGoodDollarArtifact.abi,SuperGoodDollarArtifact.bytecode, signer)
    const SuperGoodDollar = await SuperGoodDollarFactory.deploy(sfContracts.host);
  
    const GoodDollarProxyFactory = new ethers.ContractFactory(UUPSAritfact.abi,UUPSAritfact.bytecode, signer)
  
    const GoodDollarProxy = await GoodDollarProxyFactory.deploy();
    await GoodDollarProxy.initializeProxy(SuperGoodDollar.address);
  
    const GoodDollar = SuperGoodDollar.attach(GoodDollarProxy.address)
    await GoodDollar[
      "initialize(string,string,uint256,address,address,address,address)"
    ](...initializeArgs);
    
    return {GoodDollar, Identity: idLogic.attach(idProxy.address)};
  };