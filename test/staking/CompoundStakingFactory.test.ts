import { default as hre, ethers, upgrades } from "hardhat";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  CERC20,
  GoodCompoundStaking,
  GoodCompoundStakingV2,
  CompoundStakingFactory
} from "../../types";
import { createDAO, deployUniswap } from "../helpers";
import { Contract } from "ethers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;

let cdai: CERC20;

describe("CompoundStakingFactory", () => {
  let founder,
    signers,
    cdai,
    dai,
    dao,
    stakingFactory: CompoundStakingFactory,
    comp: Contract,
    compUsdOracle;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();
    dao = await createDAO();

    const compUsdOracleFactory = await ethers.getContractFactory(
      "CompUSDMockOracle"
    );
    compUsdOracle = await compUsdOracleFactory.deploy();
    comp = dao.COMP;

    await dao.setDAOAddress("COMP", comp.address);
    dai = dao.daiAddress;
    cdai = dao.cdaiAddress;

    const uniswap = await deployUniswap(
      comp,
      await ethers.getContractAt("DAIMock", dai)
    );
    const router = uniswap.router;
    await dao.setDAOAddress("UNISWAP_ROUTER", router.address);
    let swapHelper = await ethers
      .getContractFactory("UniswapV2SwapHelper")
      .then(_ => _.deploy());

    stakingFactory = (await ethers
      .getContractFactory("CompoundStakingFactory", {
        libraries: { UniswapV2SwapHelper: swapHelper.address }
      })
      .then(_ => _.deploy())) as CompoundStakingFactory;
  });

  // it("should create proxy clone", async () => {
  //   const res = await (
  //     await stakingFactory.clone(cdai, ethers.constants.HashZero)
  //   ).wait();
  //   const log = res.events.find(_ => _.event === "Deployed");
  //   const detAddress = await stakingFactory.predictAddress(
  //     cdai,
  //     ethers.constants.HashZero
  //   );
  //   expect(log).to.not.empty;
  //   expect(log.args.proxy).to.equal(detAddress);
  //   expect(log.args.cToken).to.equal(cdai);
  // });

  it("should create and initialize clone", async () => {
    console.log(await dao.nameService.getAddress("UNISWAP_ROUTER"));
    const res = await (
      await stakingFactory[
        "cloneAndInit(address,address,uint64,address,address,address[])"
      ](
        cdai,
        dao.nameService.address,
        5760,
        stakingFactory.address,
        compUsdOracle.address,
        []
      )
    ).wait();
    const log = res.events.find(_ => _.event === "Deployed");
    const detAddress = await stakingFactory.predictAddress(
      await stakingFactory.impl(),
      cdai,
      ethers.utils.solidityKeccak256(
        ["address", "uint64", "address", "address[]"],
        [dao.nameService.address, 5760, stakingFactory.address, []]
      )
    );
    expect(log).to.not.empty;
    expect(log.args.proxy).to.equal(detAddress);
    expect(log.args.cToken).to.equal(cdai);

    //check initialization
    const staking: GoodCompoundStaking = (await ethers.getContractAt(
      "GoodCompoundStakingV2",
      detAddress
    )) as GoodCompoundStaking;
    expect(await staking.iToken()).to.equal(cdai);
    expect(await staking.token()).to.equal(dai);
    expect(await staking.name()).to.equal("GoodCompoundStakingV2 Compound DAI");
    expect(await staking.symbol()).to.equal("gcDAI");
  });
  it("should get exact gas cost for interest transfer", async () => {
    const goodCompoundStakingV2 = (await ethers.getContractAt(
      "GoodCompoundStakingV2",
      await stakingFactory.impl()
    )) as GoodCompoundStakingV2;

    await goodCompoundStakingV2.init(
      dai,
      cdai,
      dao.nameService.address,
      "DAI",
      "DAI",
      5760,
      stakingFactory.address,
      compUsdOracle.address,
      []
    );

    const INITIAL_GAS_COST = 250000;
    const gasCostForInterestTransfer = await goodCompoundStakingV2.getGasCostForInterestTransfer();
    expect(gasCostForInterestTransfer).to.equal(INITIAL_GAS_COST);
    });
});
