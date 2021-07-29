import { ethers, upgrades } from "hardhat";
import { BigNumber, Contract, BigNumberish } from "ethers";
import bn from "bignumber.js";
import { expect } from "chai";
import { UniswapV3Deployer } from "uniswap-v3-deploy-plugin/dist/deployer/UniswapV3Deployer";
import UniswapRouter from "@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json";
import UniswapFactory from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import {
  IUniswapV3Factory,
  IPeripheryImmutableState,
  IUniswapV3Pool,
  ISwapRouter,
  SwapHelper,
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  createDAO,
  increaseTime,
  advanceBlocks,
  deployUniswap,
} from "../helpers";

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

const encodePriceSqrt = (
  reserve1: BigNumberish,
  reserve0: BigNumberish
): BigNumber => {
  return BN.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  );
};

let signers,
  uniswapContracts: { [name: string]: Contract },
  dao,
  swapHelper: SwapHelper,
  gddaiPool: IUniswapV3Pool,
  daicdaiPool: IUniswapV3Pool,
  ethdaiPool: IUniswapV3Pool;
describe("SwapHelper - Library for uniswap V3", () => {
  before(async () => {
    dao = await createDAO();
    signers = await ethers.getSigners();
    uniswapContracts = await UniswapV3Deployer.deploy(signers[0]);

    swapHelper = (await (
      await ethers.getContractFactory("SwapHelper")
    ).deploy()) as SwapHelper;

    const factory = uniswapContracts.factory as IUniswapV3Factory;
    await factory.createPool(dao.gd, dao.daiAddress, 1000);
    await factory.createPool(dao.daiAddress, dao.cdaiAddress, 1000);
    await factory.createPool(
      uniswapContracts.weth9.address,
      dao.daiAddress,
      1000
    );
    gddaiPool = (await ethers.getContractAt(
      "IUniswapV3Pool",
      await factory.getPool(dao.gd, dao.daiAddress, 1000)
    )) as IUniswapV3Pool;
    daicdaiPool = (await ethers.getContractAt(
      "IUniswapV3Pool",
      await factory.getPool(dao.daiAddress, dao.cdaiAddress, 1000)
    )) as IUniswapV3Pool;
    ethdaiPool = (await ethers.getContractAt(
      "IUniswapV3Pool",
      await factory.getPool(
        uniswapContracts.weth9.address,
        dao.daiAddress,
        1000
      )
    )) as IUniswapV3Pool;

    gddaiPool.initialize(encodePriceSqrt(1, 1));
    daicdaiPool.initialize(encodePriceSqrt(1, 1));
    ethdaiPool.initialize(encodePriceSqrt(1, 1));
  });

  it("should have uniswap deployed", async () => {
    const router = uniswapContracts.router as IPeripheryImmutableState;
    expect(await router.WETH9()).to.properAddress;
  });

  it("should work as a library", async () => {
    const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
    const WETH9 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const expected =
      "0x6b175474e89094c44da98b954eedeac495271d0f000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20003e8a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const swapuser = await (
      await ethers.getContractFactory("SwapMock")
    ).deploy(swapHelper.address);
    const encodedPath = await swapuser.callStatic.encodePath(
      [DAI, WETH9, USDC],
      [3000, 1000]
    );
    const encodedPathOrg = await swapHelper.encodePath(
      [DAI, WETH9, USDC],
      [3000, 1000]
    );
    expect(encodedPathOrg).to.equal(expected);
    expect(encodedPath).to.equal(expected);
  });
});
