import { ethers, upgrades } from "hardhat";
import { BigNumber, Contract } from "ethers";
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

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

let signers,
  uniswapContracts: { [name: string]: Contract },
  dao,
  swapHelper: SwapHelper;
describe("SwapHelper - Library for uniswap V3", () => {
  before(async () => {
    dao = await createDAO();
    signers = await ethers.getSigners();
    uniswapContracts = await UniswapV3Deployer.deploy(signers[0]);
    swapHelper = (await (
      await ethers.getContractFactory("SwapHelper")
    ).deploy()) as SwapHelper;
  });

  it("should have uniswap deployed", async () => {
    const router = uniswapContracts.router as IPeripheryImmutableState;
    expect(await router.WETH9()).to.properAddress;
  });

  it("should work as a library", async () => {
    const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
    const WETH9 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const swapuser = await (
      await ethers.getContractFactory("SwapMock")
    ).deploy(swapHelper.address);
    const encodedPath = await swapuser.callStatic.encodePath(
      [DAI, WETH9, USDC],
      [3000, 1000]
    );
    // const txres = await encodedPath.wait();
    const encodedPathOrg = await swapHelper.encodePath(
      [DAI, WETH9, USDC],
      [3000, 1000]
    );
    console.log({ encodedPath, encodedPathOrg });
    expect(encodedPath).to.equal("");
    expect(encodedPathOrg).to.equal("");
  });
});
