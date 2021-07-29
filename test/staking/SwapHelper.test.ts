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
  UniswapV3SwapHelper,
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

const getMinTick = (tickSpacing: number) =>
  Math.ceil(-887272 / tickSpacing) * tickSpacing;
const getMaxTick = (tickSpacing: number) =>
  Math.floor(887272 / tickSpacing) * tickSpacing;

let signers,
  uniswapContracts: { [name: string]: Contract },
  dao,
  swapHelper: UniswapV3SwapHelper,
  gddaiPool: IUniswapV3Pool,
  daicdaiPool: IUniswapV3Pool,
  ethdaiPool: IUniswapV3Pool;
describe("SwapHelper - Library for uniswap V3", () => {
  before(async () => {
    dao = await createDAO();
    signers = await ethers.getSigners();
    uniswapContracts = await UniswapV3Deployer.deploy(signers[0]);

    let nfpm = uniswapContracts.positionManager;
    swapHelper = (await (
      await ethers.getContractFactory("UniswapV3SwapHelper")
    ).deploy()) as UniswapV3SwapHelper;

    const factory = uniswapContracts.factory as IUniswapV3Factory;
    await factory.enableFeeAmount(1000, 10);
    console.log("enabled fee");

    await nfpm.createAndInitializePoolIfNecessary(
      dao.gd,
      dao.daiAddress,
      1000,
      encodePriceSqrt(1, 1)
    );
    console.log("created gd pool");
    await nfpm.createAndInitializePoolIfNecessary(
      dao.daiAddress,
      dao.cdaiAddress,
      1000,
      encodePriceSqrt(1, 1)
    );
    console.log("created daicdai pool");
    await nfpm.createAndInitializePoolIfNecessary(
      uniswapContracts.weth9.address,
      dao.daiAddress,
      1000,
      encodePriceSqrt(1, 1)
    );
    console.log("created ethdai pool");
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

    const dai = await ethers.getContractAt("cERC20", dao.daiAddress);
    const cDAI = await ethers.getContractAt("cERC20", dao.cdaiAddress);
    const gooddollar = await ethers.getContractAt("IGoodDollar", dao.gd);

    await (await dai["mint(uint256)"](ethers.utils.parseEther("10000"))).wait();
    console.log("created minted dai");

    await (
      await dai.approve(cDAI.address, ethers.utils.parseEther("10000000000"))
    ).wait();
    await cDAI["mint(uint256)"](ethers.utils.parseEther("1000")).then((_) =>
      _.wait()
    );
    console.log("created minted cdai");
    await gooddollar
      .mint(signers[0].address, "100000000000")
      .then((_) => _.wait());
    console.log("created minted gooddollar");
    await uniswapContracts.weth9.deposit({
      value: ethers.utils.parseEther("100"),
    });
    console.log("created minted weth9");
    console.log(
      "balances:",
      await dai.balanceOf(signers[0].address).then((_) => _.toString()),
      await uniswapContracts.weth9
        .balanceOf(signers[0].address)
        .then((_) => _.toString()),
      await cDAI.balanceOf(signers[0].address).then((_) => _.toString()),
      await gooddollar.balanceOf(signers[0].address).then((_) => _.toString())
    );

    await Promise.all(
      [gooddollar, cDAI, uniswapContracts.weth9, dai].map((c) => {
        return c
          .approve(nfpm.address, ethers.utils.parseEther("10000000000"))
          .then((_) => _.wait());
      })
    );

    console.log("adding liquidity");
    let liquidityTX = await nfpm
      .mint({
        token0: gooddollar.address,
        token1: dai.address,
        tickLower: getMinTick(10),
        tickUpper: getMaxTick(10),
        amount0Desired: 100000,
        amount1Desired: 100000,
        amount0Min: 0,
        amount1Min: 0,
        recipient: signers[0].address,
        deadline: Date.now(),
        fee: 1000,
      })
      .then((_) => _.wait());

    console.log(
      { liquidityTX: liquidityTX.events },
      "poolbalance:",
      await gooddollar.balanceOf(gddaiPool.address).then((_) => _.toString()),
      await dai.balanceOf(gddaiPool.address).then((_) => _.toString())
    );
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
