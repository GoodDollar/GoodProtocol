import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { bigNumberify,formatUnits,formatEther} from 'ethers/utils'
import { deployMockContract, MockContract} from "ethereum-waffle";
import { expect } from "chai";
import { GoodMarketMaker, CERC20, GoodReserveCDai, UniswapFactory } from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import { parseUnits } from "@ethersproject/units";
import { MaxUint256 } from 'ethers/constants'
import IUniswapV2Pair from '@uniswap/v2-core/build/IUniswapV2Pair.json'
import UniswapV2Factory from '@uniswap/v2-core/build/UniswapV2Factory.json'
import ERC20 from '@uniswap/v2-core/build/ERC20.json'
import WETH9 from '@uniswap/v2-periphery/build/WETH9.json'
import UniswapV2Router02 from '@uniswap/v2-periphery/build/UniswapV2Router02.json'

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;


describe("NameService - Setup and functionalities", () => {
    let dai: Contract;
    let cDAI, cDAI2;
    let goodReserve: GoodReserveCDai;
    let goodDollar,
      avatar,
      identity,
      marketMaker: GoodMarketMaker,
      contribution,
      controller,
      founder,
      staker,
      schemeMock,
      signers,
      setDAOAddress,
      nameService;
  
    before(async () => {
      [founder, staker, ...signers] = await ethers.getSigners();
      schemeMock = signers.pop();
      const cdaiFactory = await ethers.getContractFactory("cDAIMock");
      const daiFactory = await ethers.getContractFactory("DAIMock");
  
      dai = await daiFactory.deploy();
  
      cDAI = await cdaiFactory.deploy(dai.address);
  
      cDAI2 = await cdaiFactory.deploy(dai.address); //test another ratio
  
      let {
        controller: ctrl,
        avatar: av,
        gd,
        identity,
        daoCreator,
        nameService: ns,
        setDAOAddress: sda,
        setSchemes,
        marketMaker: mm
      } = await createDAO();
  
      avatar = av;
      controller = ctrl;
      setDAOAddress = sda;
      nameService = ns;
      console.log("deployed dao", {
        founder: founder.address,
        gd,
        identity,
        controller,
        avatar
      });
  
      goodDollar = await ethers.getContractAt("GoodDollar", gd);
      contribution = await ethers.getContractAt(
        ContributionCalculation.abi,
        await nameService.getAddress("CONTRIBUTION_CALCULATION")
      );
  
      marketMaker = mm;
  
      const reserveFactory = await ethers.getContractFactory("GoodReserveCDai");
      console.log("deployed contribution, deploying reserve...", {
        mmOwner: await marketMaker.owner(),
        founder: founder.address
      });
      goodReserve = (await upgrades.deployProxy(
        reserveFactory,
        [controller, nameService.address, ethers.constants.HashZero],
        {
          initializer: "initialize(address,address,bytes32)"
        }
      )) as GoodReserveCDai;
  
      console.log("setting permissions...");
  
      //give reserve generic call permission
      await setSchemes([goodReserve.address, schemeMock.address]);
  
      console.log("initializing marketmaker...");
      await marketMaker.initializeToken(
        cDAI.address,
        "100", //1gd
        "10000", //0.0001 cDai
        "1000000" //100% rr
      );
  
      await marketMaker.initializeToken(
        cDAI2.address,
        "100", //1gd
        "500000", //0.005 cDai
        "1000000" //100% rr
      );
  
      await marketMaker.transferOwnership(goodReserve.address);
  
      const nsFactory = await ethers.getContractFactory("NameService");
      const encoded = nsFactory.interface.encodeFunctionData("setAddress", [
        "CDAI",
        cDAI.address
      ]);
  
      const ictrl = await ethers.getContractAt(
        "Controller",
        controller,
        schemeMock
      );
  
      await ictrl.genericCall(nameService.address, encoded, avatar, 0);

    
      
     
    });

    it(" address should not be set  ",async() => {
        
        await expect(nameService.setAddress("DAI", dai.address)).to.be.revertedWith("only avatar can call this method");
    })
    
    it(" address should be equal CDAI address ",async() => {
        
         expect(await nameService.getAddress("CDAI")).to.be.equal(cDAI.address);
    })
})