import { ethers, waffle } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { GoodReserveCDai, DistributionHelper } from "../../types";
import { createDAO, increaseTime } from "../helpers";
import { Contract } from "ethers";
import { FormatTypes } from "@ethersproject/abi";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GoodReserve - Distribution Helper", () => {
  let goodReserve: GoodReserveCDai;
  let goodDollar: Contract, genericCall, avatar, founder, signers, setDAOAddress, nameService, cDai;

  before(async () => {
    [founder, ...signers] = await ethers.getSigners();

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      setDAOAddress: sda,
      setSchemes,
      reserve,
      cdaiAddress,
      genericCall: gc,
      nameService: ns
    } = await loadFixture(createDAO);

    nameService = ns;
    genericCall = gc;
    cDai = cdaiAddress;
    avatar = av;
    setDAOAddress = sda;

    console.log("deployed dao", {
      founder: founder.address,
      gd,
      identity,
      avatar
    });

    goodDollar = await ethers.getContractAt("IGoodDollar", gd);

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });

    goodReserve = reserve as GoodReserveCDai;

    console.log("setting permissions...");
  });

  const fixture = async (wallets, provider) => {
    const df = await ethers.getContractFactory("DistributionHelper");
    wallets = provider.getWallets();
    const distHelper = (await waffle.deployContract(wallets[0], {
      abi: JSON.parse(df.interface.format(FormatTypes.json) as string) as any[],
      bytecode: df.bytecode
    })) as DistributionHelper;

    return { distHelper };
  };

  const deployed_fixture = async (wallets, provider) => {
    const df = await ethers.getContractFactory("DistributionHelper");
    wallets = provider.getWallets();
    const distHelper = (await waffle.deployContract(wallets[0], {
      abi: JSON.parse(df.interface.format(FormatTypes.json) as string) as any[],
      bytecode: df.bytecode
    })) as DistributionHelper;

    await distHelper.initialize(nameService.address);

    const encodedCall = goodReserve.interface.encodeFunctionData("setDistributionHelper", [distHelper.address]);

    await genericCall(goodReserve.address, encodedCall, avatar.address, 0);

    return { distHelper };
  };

  const deployed_revert_fixture = async (wallets, provider) => {
    const df = await ethers.getContractFactory("DistributionHelperTest");
    wallets = provider.getWallets();
    const distHelper = (await waffle.deployContract(wallets[0], {
      abi: JSON.parse(df.interface.format(FormatTypes.json) as string) as any[],
      bytecode: df.bytecode
    })) as DistributionHelper;

    await distHelper.initialize(nameService.address);

    const encodedCall = goodReserve.interface.encodeFunctionData("setDistributionHelper", [distHelper.address]);

    await genericCall(goodReserve.address, encodedCall, avatar.address, 0);

    return { distHelper };
  };

  it("should allow avatar to set distribution helper target", async () => {
    const { distHelper } = await waffle.loadFixture(fixture);
    const encodedCall = goodReserve.interface.encodeFunctionData("setDistributionHelper", [distHelper.address]);

    await genericCall(goodReserve.address, encodedCall, avatar.address, 0);

    expect(await goodReserve.distributionHelper()).to.equal(distHelper.address);
  });

  it("should not allow to call setDistributionHelper", async () => {
    const { distHelper } = await waffle.loadFixture(fixture);
    await expect(goodReserve.setDistributionHelper(distHelper.address)).to.be.revertedWith("avatar");
  });

  it("should send UBI to distribution contract", async () => {
    const { distHelper } = await waffle.loadFixture(deployed_fixture);

    await increaseTime(60 * 60 * 24 * 365); //required for reserve ratio advance
    await setDAOAddress("FUND_MANAGER", founder.address); //required so we can call mintUBI

    let tx = await (await goodReserve.connect(founder).mintUBI(0, 0, cDai)).wait();

    const ubiMintedEvent = tx.events.find(_ => _.event === "UBIMinted");

    const topic = distHelper.filters.Distribution().topics[0];
    const distributionEvent = tx.events.find(_ => _.topics.includes(topic as string));

    //verify onDistribution didnt happen
    expect(distributionEvent).not.empty;

    //verify amount transfered

    expect(ubiMintedEvent.args.gdUbiTransferred).to.equal(await goodDollar.balanceOf(distHelper.address));
  });

  it("should revert when DistributionHelper onDistribution reverts", async () => {
    let { distHelper } = await waffle.loadFixture(deployed_revert_fixture); //using DistributionHelperTest which reverts

    await increaseTime(60 * 60 * 24 * 365); //required for reserve ratio advance
    await setDAOAddress("FUND_MANAGER", founder.address); //required so we can call mintUBI

    await expect(goodReserve.connect(founder).mintUBI(0, 0, cDai)).reverted;
  });

  it("should trigger onDistribution of DistributionHelper", async () => {
    let { distHelper } = await waffle.loadFixture(deployed_fixture); //using DistributionHelperTest which reverts

    await increaseTime(60 * 60 * 24 * 365); //required for reserve ratio advance
    await setDAOAddress("FUND_MANAGER", founder.address); //required so we can call mintUBI

    let tx = await (await goodReserve.connect(founder).mintUBI(0, 0, cDai)).wait();

    const topic = distHelper.filters.Distribution().topics[0];
    const distributionEvent = tx.events.find(_ => _.topics.includes(topic as string));

    expect(distributionEvent).not.empty;
  });

  it("should revert if distributionhelper is null", async () => {
    let { distHelper } = await waffle.loadFixture(deployed_fixture); //using DistributionHelperTest which reverts

    await increaseTime(60 * 60 * 24 * 365); //required for reserve ratio advance
    await setDAOAddress("FUND_MANAGER", founder.address); //required so we can call mintUBI

    const encodedCall = goodReserve.interface.encodeFunctionData("setDistributionHelper", [
      ethers.constants.AddressZero
    ]);

    await genericCall(goodReserve.address, encodedCall, avatar.address, 0);

    await expect(goodReserve.connect(founder).mintUBI(0, 0, cDai)).revertedWith("helper not set");
  });
});
