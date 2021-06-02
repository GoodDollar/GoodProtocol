import { default as hre, ethers, upgrades } from "hardhat";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import { CompoundStakingFactory, CERC20 } from "../../types";
import { createDAO } from "../helpers";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;

let cdai: CERC20;

describe("CompoundStakingFactory", () => {
  let founder, signers, cdai, dai, dao, stakingFactory: CompoundStakingFactory;

  const deployDAIMock = async () => {
    let [signer] = await ethers.getSigners();
    let cdai = await hre.artifacts.readArtifact("cERC20");
    let dai = ((await deployMockContract(
      signer,
      cdai.abi
    )) as unknown) as CERC20;
    dai.mock.decimals.returns(18);

    return dai.address;
  };

  const deploycDAIMock = async () => {
    let [signer] = await ethers.getSigners();
    let cdai = await hre.artifacts.readArtifact("cERC20");
    let dai = await deployMockContract(signer, cdai.abi);
    dai.mock.decimals.returns(8);
    dai.mock.underlying.returns(dai.address);
    dai.mock.name.returns("Compound DAI");
    dai.mock.symbol.returns("cDAI");
    return dai.address;
  };

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();

    dao = await createDAO();
    dai = await deployDAIMock();
    cdai = await deploycDAIMock();

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
    expect(log.args.cToken).to.equal(cdai.address);
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
        160000
      )
    ).wait();
    const log = res.events.find(_ => _.event === "Deployed");
    const detAddress = await stakingFactory.predictAddress(
      cdai,
      ethers.utils.solidityKeccak256(
        ["address", "uint64", "address", "uint32"],
        [dao.nameService.address, 5760, stakingFactory.address, 160000]
      )
    );
    expect(log).to.not.empty;
    expect(log.args.proxy).to.equal(detAddress);
    expect(log.args.cToken).to.equal(cdai.address);
  });
});
