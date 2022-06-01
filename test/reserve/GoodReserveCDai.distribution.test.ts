import { ethers, waffle } from "hardhat";
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
  let goodDollar: Contract,
    genericCall,
    avatar,
    founder,
    signers,
    setDAOAddress,
    nameService,
    cDai;

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
    } = await createDAO();

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

    const encodedCall = goodReserve.interface.encodeFunctionData(
      "setDistributionHelper",
      [distHelper.address, 1000]
    );

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

    const encodedCall = goodReserve.interface.encodeFunctionData(
      "setDistributionHelper",
      [distHelper.address, 1000]
    );

    await genericCall(goodReserve.address, encodedCall, avatar.address, 0);

    return { distHelper };
  };

  it("should allow avatar to set distribution helper target", async () => {
    const { distHelper } = await waffle.loadFixture(fixture);
    const encodedCall = goodReserve.interface.encodeFunctionData(
      "setDistributionHelper",
      [distHelper.address, 1000]
    );

    await genericCall(goodReserve.address, encodedCall, avatar.address, 0);

    expect(await goodReserve.distributionHelper()).to.equal(distHelper.address);
    expect(await goodReserve.nonUbiBps()).to.equal(1000);
  });

  it("should not allow to call setDistributionHelper", async () => {
    const { distHelper } = await waffle.loadFixture(fixture);
    await expect(
      goodReserve.setDistributionHelper(distHelper.address, 1000)
    ).to.be.revertedWith("avatar");
  });

  //   it("should send UBI to distribution contract", async () => {
  //     await increaseTime(24 * 60 * 60); //required for reserve ratio advance
  //     let tx = await (await goodReserve.mintUBI(0, 0, cDai)).wait();
  //     console.log(tx);
  //   });

  it("should send UBI to distribution contract", async () => {
    const { distHelper } = await waffle.loadFixture(deployed_fixture);

    await increaseTime(60 * 60 * 24 * 365); //required for reserve ratio advance
    await setDAOAddress("FUND_MANAGER", founder.address); //required so we can call mintUBI

    let tx = await (
      await goodReserve.connect(founder).mintUBI(0, 0, cDai)
    ).wait();

    const nonUbiMintedEvent = tx.events.find(_ => _.event === "NonUBIMinted");
    const ubiMintedEvent = tx.events.find(_ => _.event === "UBIMinted");

    //verify amount transfered
    expect(nonUbiMintedEvent.args.amountMinted).gt(0);
    expect(nonUbiMintedEvent.args.amountMinted).to.equal(
      await goodDollar.balanceOf(distHelper.address)
    );

    expect(
      nonUbiMintedEvent.args.amountMinted.add(
        ubiMintedEvent.args.gdUbiTransferred
      )
    ).to.equal(ubiMintedEvent.args.gdExpansionMinted);
  });

  it("should distribute according to 10% nonUbiBps", async () => {
    let { distHelper } = await waffle.loadFixture(deployed_fixture);

    await increaseTime(60 * 60 * 24 * 365); //required for reserve ratio advance
    await setDAOAddress("FUND_MANAGER", founder.address); //required so we can call mintUBI

    let tx = await (
      await goodReserve.connect(founder).mintUBI(0, 0, cDai)
    ).wait();

    const nonUbiMintedEvent = tx.events.find(_ => _.event === "NonUBIMinted");
    const ubiMintedEvent = tx.events.find(_ => _.event === "UBIMinted");

    //verify 10%
    expect(nonUbiMintedEvent.args.amountMinted).gt(0);
    expect(nonUbiMintedEvent.args.amountMinted).to.equal(
      ubiMintedEvent.args.gdExpansionMinted.mul(1000).div(10000)
    );
  });

  it("should distribute according to 25% nonUbiBps", async () => {
    let { distHelper } = await waffle.loadFixture(deployed_fixture);

    const encodedCall = goodReserve.interface.encodeFunctionData(
      "setDistributionHelper",
      [distHelper.address, 2500]
    );

    await genericCall(goodReserve.address, encodedCall, avatar.address, 0);

    await increaseTime(60 * 60 * 24 * 365); //required for reserve ratio advance
    await setDAOAddress("FUND_MANAGER", founder.address); //required so we can call mintUBI

    let tx = await (
      await goodReserve.connect(founder).mintUBI(0, 0, cDai)
    ).wait();

    const nonUbiMintedEvent = tx.events.find(_ => _.event === "NonUBIMinted");
    const ubiMintedEvent = tx.events.find(_ => _.event === "UBIMinted");

    //verify 10%
    expect(nonUbiMintedEvent.args.amountMinted).gt(0);
    expect(nonUbiMintedEvent.args.amountMinted).to.equal(
      ubiMintedEvent.args.gdExpansionMinted.mul(2500).div(10000)
    );
  });

  it("should distribute even when DistributionHelper onDistribution reverts", async () => {
    let { distHelper } = await waffle.loadFixture(deployed_revert_fixture); //using DistributionHelperTest which reverts

    await increaseTime(60 * 60 * 24 * 365); //required for reserve ratio advance
    await setDAOAddress("FUND_MANAGER", founder.address); //required so we can call mintUBI

    let tx = await (
      await goodReserve.connect(founder).mintUBI(0, 0, cDai)
    ).wait();

    const nonUbiMintedEvent = tx.events.find(_ => _.event === "NonUBIMinted");
    const ubiMintedEvent = tx.events.find(_ => _.event === "UBIMinted");

    const topic = distHelper.filters.Distribution().topics[0];
    const distributionEvent = tx.events.find(_ =>
      _.topics.includes(topic as string)
    );

    //verify onDistribution didnt happen
    expect(distributionEvent).to.be.undefined;

    //verify 10%
    expect(nonUbiMintedEvent.args.amountMinted).gt(0);
    expect(nonUbiMintedEvent.args.amountMinted).to.equal(
      ubiMintedEvent.args.gdExpansionMinted.mul(1000).div(10000)
    );
  });

  it("should trigger onDistribution of DistributionHelper", async () => {
    let { distHelper } = await waffle.loadFixture(deployed_fixture); //using DistributionHelperTest which reverts

    await increaseTime(60 * 60 * 24 * 365); //required for reserve ratio advance
    await setDAOAddress("FUND_MANAGER", founder.address); //required so we can call mintUBI

    let tx = await (
      await goodReserve.connect(founder).mintUBI(0, 0, cDai)
    ).wait();

    const topic = distHelper.filters.Distribution().topics[0];
    const distributionEvent = tx.events.find(_ =>
      _.topics.includes(topic as string)
    );

    expect(distributionEvent).not.empty;
  });
});
