import { default as hre, ethers, upgrades } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  CERC20,
  GoodReserveCDai,
  UniswapFactory
} from "../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { createDAO, increaseTime, advanceBlocks } from "../helpers";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import { parseUnits } from "@ethersproject/units";
import ERC20 from "@uniswap/v2-core/build/ERC20.json";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("NameService - Setup and functionalities", () => {
  let nameService, dai, avatar, controller, schemeMock;

  before(async () => {
    const signers = await ethers.getSigners();
    schemeMock = signers.pop();
    const daiFactory = await ethers.getContractFactory("DAIMock");

    dai = await daiFactory.deploy();

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

    controller = ctrl;
    avatar = av;
    nameService = ns;
    console.log("deployed dao", {
      gd,
      identity,
      controller,
      avatar
    });

    await setSchemes([schemeMock.address]);
  });

  it(" address should not be set  ", async () => {
    await expect(nameService.setAddress("DAI", dai.address)).to.be.revertedWith(
      "only avatar can call this method"
    );
  });

  it("should set address by avatar", async () => {
    const nsFactory = await ethers.getContractFactory("NameService");
    const encoded = nsFactory.interface.encodeFunctionData("setAddress", [
      "DAI",
      dai.address
    ]);

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      schemeMock
    );

    await ictrl.genericCall(nameService.address, encoded, avatar, 0);
    expect(await nameService.getAddress("DAI")).to.be.equal(dai.address);
  });
});
