import { default as hre, ethers, upgrades, waffle } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { expect } from "chai";
import {
  GoodMarketMaker,
  GoodReserveCDai,
  GReputation,
  GoodDollarStaking
} from "../../types";
import { createDAO, advanceBlocks } from "../helpers";
import { FormatTypes } from "ethers/lib/utils";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 30;

describe("GoodDollarStaking - check fixed APY G$ rewards", () => {
  let dai: Contract;
  let cDAI: Contract;
  let goodReserve: GoodReserveCDai;
  let governanceStaking: GoodDollarStaking;
  let goodFundManager: Contract;
  let grep: GReputation;
  let avatar,
    goodDollar,
    marketMaker: GoodMarketMaker,
    controller,
    founder,
    staker,
    staker2,
    staker3,
    schemeMock,
    signers,
    nameService,
    setDAOAddress,
    setSchemes;

  before(async () => {
    [founder, staker, staker2, staker3, ...signers] = await ethers.getSigners();
    schemeMock = signers.pop();
    const cdaiFactory = await ethers.getContractFactory("cDAIMock");
    const goodFundManagerFactory = await ethers.getContractFactory(
      "GoodFundManager"
    );
    const governanceStakingFactory = await ethers.getContractFactory(
      "GoodDollarStaking"
    );

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      daoCreator,
      nameService: ns,
      setDAOAddress: sda,
      setSchemes: ss,
      marketMaker: mm,
      daiAddress,
      cdaiAddress,
      reserve,
      reputation,
      setReserveToken
    } = await createDAO();

    dai = await ethers.getContractAt("DAIMock", daiAddress);
    cDAI = await ethers.getContractAt("cDAIMock", cdaiAddress);

    setSchemes = ss;
    avatar = av;
    controller = ctrl;
    setDAOAddress = sda;
    nameService = ns;
    goodReserve = reserve as GoodReserveCDai;
    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      controller,
      avatar
    });
    goodFundManager = await upgrades.deployProxy(
      goodFundManagerFactory,
      [nameService.address],
      { kind: "uups" }
    );
    grep = (await ethers.getContractAt(
      "GReputation",
      reputation
    )) as GReputation;
    console.log("Deployed goodfund manager", {
      manager: goodFundManager.address
    });
    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

    marketMaker = mm;

    console.log("setting permissions...");
    governanceStaking = (await governanceStakingFactory.deploy(
      nameService.address,
      BN.from("1000000007735630000"),
      518400 * 12,
      30
    )) as GoodDollarStaking;

    setDAOAddress("CDAI", cDAI.address);
    setDAOAddress("DAI", dai.address);

    //This set addresses should be another function because when we put this initialization of addresses in initializer then nameservice is not ready yet so no proper addresses
    await goodReserve.setAddresses();

    await setDAOAddress("MARKET_MAKER", marketMaker.address);
    await setDAOAddress("FUND_MANAGER", goodFundManager.address);
  });

  const fixture = async (wallets, provider) => {
    const f = await ethers.getContractFactory("GoodDollarStakingMock");

    wallets = provider.getWallets();
    const staking = (await waffle.deployContract(
      wallets[0],
      {
        abi: JSON.parse(
          f.interface.format(FormatTypes.json) as string
        ) as any[],
        bytecode: f.bytecode
      },
      [nameService.address, BN.from("1000000007735630000"), 518400 * 12, 30]
    )) as GoodDollarStaking;

    await staking.upgrade();

    return { staking };
  };

  const fixture_ready = async (wallets, provider) => {
    const f = await ethers.getContractFactory("GoodDollarStakingMock");

    wallets = provider.getWallets();
    const staking = (await waffle.deployContract(
      wallets[0],
      {
        abi: JSON.parse(
          f.interface.format(FormatTypes.json) as string
        ) as any[],
        bytecode: f.bytecode
      },
      [nameService.address, BN.from("1000000007735630000"), 518400 * 12, 30]
    )) as GoodDollarStaking;

    await staking.upgrade();

    await setDAOAddress("GDAO_STAKING", staking.address);

    return { staking };
  };

  const fixture_upgradeTest = async (wallets, provider) => {
    const f = await ethers.getContractFactory("GoodDollarStaking");

    wallets = provider.getWallets();
    const staking = (await waffle.deployContract(
      wallets[0],
      {
        abi: JSON.parse(
          f.interface.format(FormatTypes.json) as string
        ) as any[],
        bytecode: f.bytecode
      },
      [nameService.address, BN.from("1000000007735630000"), 518400 * 12, 30]
    )) as GoodDollarStaking;

    await setSchemes([staking.address]);

    return { staking };
  };

  it("should update stakingrewardsfixedapy staker info and global stats when staking", async () => {});

  it("should withdraw from deposit and undo rewards if unable to mint rewards", async () => {
    //test that withdraw is success for deposit part even if call to GoodDollarMintBurnWrapper fails
  });

  it("should withdraw rewards after mint rewards is enabled again", async () => {});

  it("should get G$ rewards when withdrawing", async () => {
    //need to make sure GoodDollarMintBurnWrapper is deployed or some mock, so it can mint rewards
    //test that G$ balance is equal to principle after some interest was earned
  });

  it("should perform upgrade", async () => {
    const { staking } = await waffle.loadFixture(fixture_upgradeTest);
    await expect(staking.upgrade()).to.not.reverted;
  });

  it("should change GD apy only by avatar", async () => {});

  it("should withdraw only rewards when calling withdrawRewards", async () => {});

  it("should handle stakingrewardsfixed apy correctly when transfering staking tokens", async () => {
    //test that logic of _transfer is as expected
  });

  function rdiv(x: BigNumber, y: BigNumber) {
    return x.mul(BN.from("10").pow(27)).add(y.div(2)).div(y);
  }
});
