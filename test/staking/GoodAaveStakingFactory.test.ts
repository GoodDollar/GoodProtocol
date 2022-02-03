import { default as hre, ethers, upgrades } from "hardhat";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import { CERC20, GoodAaveStaking, AaveStakingFactory } from "../../types";
import { createDAO, deployUniswap } from "../helpers";
import { Contract } from "ethers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;

let cdai: CERC20;

describe("AaveStakingFactory", () => {
  let founder,
    signers,
    cdai,
    usdc,
    aave,
    incentiveController,
    aaveUsdOracle: Contract,
    dai,
    dao,
    stakingFactory: AaveStakingFactory,
    lendingPool: Contract;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();
    dao = await createDAO();
    const usdcFactory = await ethers.getContractFactory("USDCMock");
    const lendingPoolFactory = await ethers.getContractFactory(
      "LendingPoolMock"
    );
    aave = await (await ethers.getContractFactory("AaveMock")).deploy();
    incentiveController = await (
      await ethers.getContractFactory("IncentiveControllerMock")
    ).deploy(aave.address);
    usdc = await usdcFactory.deploy();
    lendingPool = await lendingPoolFactory.deploy(usdc.address);
    aaveUsdOracle = await (
      await ethers.getContractFactory("AaveUSDMockOracle")
    ).deploy();
    dai = dao.daiAddress;
    cdai = dao.cdaiAddress;
    const uniswap = await deployUniswap(
      dao.COMP,
      await ethers.getContractAt("DAIMock", dai)
    );
    const router = uniswap.router;
    await dao.setDAOAddress("UNISWAP_ROUTER", router.address);
    await dao.setDAOAddress("AAVE", aave.address);
    let swapHelper = await ethers
      .getContractFactory("UniswapV2SwapHelper")
      .then(_ => _.deploy());

    stakingFactory = (await ethers
      .getContractFactory("AaveStakingFactory", {
        libraries: { UniswapV2SwapHelper: swapHelper.address }
      })
      .then(_ => _.deploy())) as AaveStakingFactory;
  });

  // it("should create proxy clone", async () => {
  //   const res = await (
  //     await stakingFactory.clone(usdc.address, ethers.constants.HashZero)
  //   ).wait();
  //   const log = res.events.find((_) => _.event === "Deployed");
  //   const detAddress = await stakingFactory.predictAddress(
  //     usdc.address,
  //     ethers.constants.HashZero
  //   );

  //   expect(log).to.not.empty;
  //   expect(log.args.proxy).to.equal(detAddress);
  //   expect(log.args.token).to.equal(usdc.address);
  // });

  it("should create and initialize clone", async () => {
    const ns = await ethers
      .getContractFactory("NameService")
      .then(_ => _.deploy());
    const res = await (
      await stakingFactory[
        "cloneAndInit(address,address,address,uint64,address,address,address,address[])"
      ](
        usdc.address,
        lendingPool.address,
        dao.nameService.address,
        5760,
        stakingFactory.address,
        incentiveController.address,
        aaveUsdOracle.address,
        [usdc.address, dai]
      )
    ).wait();
    const log = res.events.find(_ => _.event === "Deployed");
    const detAddress = await stakingFactory.predictAddress(
      await stakingFactory.impl(),
      usdc.address,
      ethers.utils.solidityKeccak256(
        ["address", "address", "uint64", "address", "address", "address"],
        [
          lendingPool.address,
          dao.nameService.address,
          5760,
          stakingFactory.address,
          incentiveController.address,
          aaveUsdOracle.address
        ]
      )
    );
    expect(log).to.not.empty;
    expect(log.args.proxy).to.equal(detAddress);
    expect(log.args.token).to.equal(usdc.address);

    //check initialization
    const staking: GoodAaveStaking = (await ethers.getContractAt(
      "GoodAaveStakingV2",
      detAddress
    )) as GoodAaveStaking;
    expect(await staking.iToken()).to.equal(lendingPool.address);
    expect(await staking.token()).to.equal(usdc.address);
    expect(await staking.name()).to.equal("GoodAaveStakingV2 USDC");
    expect(await staking.symbol()).to.equal("gaUSDC");
  });
});
