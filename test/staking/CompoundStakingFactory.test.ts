import { default as hre, ethers, upgrades } from "hardhat";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  CERC20,
  GoodCompoundStaking,
  CompoundStakingFactory
} from "../../types";
import { createDAO, deployUniswap } from "../helpers";

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
    compUsdOracle;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();
    dao = await createDAO();
    const uniswap = await deployUniswap();
    dao.setDAOAddress("UNISWAP_ROUTER", uniswap.router.address);

    const compUsdOracleFactory = await ethers.getContractFactory(
      "CompUSDMockOracle"
    );
    compUsdOracle = await compUsdOracleFactory.deploy();
    dai = dao.daiAddress;
    cdai = dao.cdaiAddress;
    stakingFactory = (await ethers
      .getContractFactory("CompoundStakingFactory")
      .then(_ => _.deploy())) as CompoundStakingFactory;
  });

  it("should create proxy clone", async () => {
    const res = await (
      await stakingFactory.clone(cdai, ethers.constants.HashZero)
    ).wait();
    const log = res.events.find(_ => _.event === "Deployed");
    const detAddress = await stakingFactory.predictAddress(
      cdai,
      ethers.constants.HashZero
    );
    expect(log).to.not.empty;
    expect(log.args.proxy).to.equal(detAddress);
    expect(log.args.cToken).to.equal(cdai);
  });

  it("should create and initialize clone", async () => {
    const ns = await ethers
      .getContractFactory("NameService")
      .then(_ => _.deploy());
    const res = await (
      await stakingFactory.cloneAndInit(
        cdai,
        dao.nameService.address,
        5760,
        stakingFactory.address,
        compUsdOracle.address
      )
    ).wait();
    const log = res.events.find(_ => _.event === "Deployed");
    const detAddress = await stakingFactory.predictAddress(
      cdai,
      ethers.utils.solidityKeccak256(
        ["address", "uint64", "address"],
        [dao.nameService.address, 5760, stakingFactory.address]
      )
    );
    expect(log).to.not.empty;
    expect(log.args.proxy).to.equal(detAddress);
    expect(log.args.cToken).to.equal(cdai);

    //check initialization
    const staking: GoodCompoundStaking = (await ethers.getContractAt(
      "GoodCompoundStaking",
      detAddress
    )) as GoodCompoundStaking;
    expect(await staking.iToken()).to.equal(cdai);
    expect(await staking.token()).to.equal(dai);
    expect(await staking.name()).to.equal("GoodCompoundStaking Compound DAI");
    expect(await staking.symbol()).to.equal("gcDAI");
  });
});
