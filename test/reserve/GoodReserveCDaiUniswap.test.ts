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


describe("GoodReserve - staking with cDAI mocks and UNISWAP router", () => {
  let dai: Contract,
    tokenA:Contract,
    pair:Contract,
    
    uniswapRouter:Contract;
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
    const routerFactory = new ethers.ContractFactory(
        UniswapV2Router02.abi,
        UniswapV2Router02.bytecode,
        founder
      );
    const uniswapFactory = new ethers.ContractFactory(
        UniswapV2Factory.abi,
        UniswapV2Factory.bytecode,
        founder
      );
    const wethFactory = new ethers.ContractFactory(
        WETH9.abi,
        WETH9.bytecode,
        founder
      );

    const weth = await wethFactory.deploy()
    const factory = await uniswapFactory.deploy(founder.address)
    uniswapRouter = await routerFactory.deploy(factory.address,weth.address);
    dai = await daiFactory.deploy();

    cDAI = await cdaiFactory.deploy(dai.address);

    cDAI2 = await cdaiFactory.deploy(dai.address); //test another ratio
    tokenA = await daiFactory.deploy() // Another erc20 token for uniswap router test

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
    
    const encodedTwo = nsFactory.interface.encodeFunctionData("setAddress",[
      "DAI",
      dai.address
    ])
    
    await ictrl.genericCall(nameService.address,encodedTwo,avatar,0);

    const encodedThree = nsFactory.interface.encodeFunctionData("setAddress",[
        "UNISWAP_ROUTER",
        uniswapRouter.address
      ])
    
    await ictrl.genericCall(nameService.address,encodedThree,avatar,0);
   
    await factory.createPair(tokenA.address, dai.address); // Create tokenA and dai pair
    const pairAddress = factory.getPair(tokenA.address, dai.address)
    pair = new Contract(pairAddress, JSON.stringify(IUniswapV2Pair.abi), staker).connect(founder)
  });

  it("should get g$ minting permissions", async () => {
    expect(await goodReserve.dao()).to.be.equal(controller);
    expect(await goodReserve.avatar()).to.be.equal(avatar);
    await goodReserve.start();
  });

  it("should set marketmaker in the reserve by avatar", async () => {
    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    // const rFactory = await ethers.getContractFactory("GoodReserveCDai");
    // const ctrl = await ethers.getContractAt(
    //   "Controller",
    //   controller,
    //   schemeMock
    // );
    // const encodedCall = rFactory.interface.encodeFunctionData(
    //   "setMarketMaker",
    //   [marketMaker.address]
    // );
    // await ctrl.genericCall(goodReserve.address, encodedCall, avatar, 0);
    // const newMM = await goodReserve.marketMaker();
    // expect(newMM.toString()).to.be.equal(marketMaker.address);
  });

  it("should set fundManager in the reserve by avatar", async () => {
    await setDAOAddress("FUND_MANAGER", founder.address);
    // const rFactory = await ethers.getContractFactory("GoodReserveCDai");
    // const ctrl = await ethers.getContractAt(
    //   "Controller",
    //   controller,
    //   schemeMock
    // );
    // const encodedCall = rFactory.interface.encodeFunctionData(
    //   "setFundManager",
    //   [founder.address]
    // );
    // await ctrl.genericCall(goodReserve.address, encodedCall, avatar, 0);
    // const newFM = await goodReserve.fundManager();
    // expect(newFM.toString()).to.be.equal(founder.address);
  });
  it("should be able to buy gd with tokenA through UNISWAP", async () => {
    let amount = 0.99e8;
    let mintAmount = ethers.utils.parseEther("100");
    let depositAmount = ethers.utils.parseEther("5");
    let buyAmount = ethers.utils.parseEther("1.253761283851554664") // Amount to get 1 DAI
    await dai["mint(uint256)"](mintAmount);
    
    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address)
    
    await tokenA["mint(uint256)"](mintAmount);
   
   
    addLiquidity(depositAmount,depositAmount)
    
    let reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceBefore = reserveToken.reserveSupply;
    let supplyBefore = reserveToken.gdSupply;
    let rrBefore = reserveToken.reserveRatio;
    const gdBalanceBefore = await goodDollar.balanceOf(founder.address);
    
    const cDAIBalanceReserveBefore = await cDAI.balanceOf(goodReserve.address);
    const priceBefore = await goodReserve["currentPrice()"]();
    tokenA.approve(goodReserve.address,buyAmount)
    let transaction = await (
      await goodReserve.buyWithAnyToken(tokenA.address, buyAmount, 0 , 0)
    ).wait();
    reserveToken = await marketMaker.reserveTokens(cDAI.address);
    let reserveBalanceAfter = reserveToken.reserveSupply;
    let supplyAfter = reserveToken.gdSupply;
    let rrAfter = reserveToken.reserveRatio;
    const gdBalanceAfter = await goodDollar.balanceOf(founder.address);
    
    const cDAIBalanceReserveAfter = await cDAI.balanceOf(goodReserve.address);
    const priceAfter = await goodReserve["currentPrice()"]();
    expect(
      (cDAIBalanceReserveAfter - cDAIBalanceReserveBefore).toString()
    ).to.be.equal(amount.toString());
    expect(
      reserveBalanceAfter.sub(reserveBalanceBefore).toString()
    ).to.be.equal(amount.toString());
    expect(supplyAfter.sub(supplyBefore).toString()).to.be.equal(
      gdBalanceAfter.sub(gdBalanceBefore).toString()
    );
    expect(rrAfter.toString()).to.be.equal(rrBefore.toString());
    expect(gdBalanceAfter.gt(gdBalanceBefore)).to.be.true;
    
    expect(priceAfter.toString()).to.be.equal(priceBefore.toString());
    expect(transaction.events.find(_ => _.event === "TokenPurchased")).to.be.not
      .empty;
  });


  async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
    await tokenA.transfer(pair.address, token0Amount)
    await dai.transfer(pair.address, token1Amount)
    await pair.mint(founder.address)
  }
});