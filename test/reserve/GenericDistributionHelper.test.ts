import { ethers, upgrades, artifacts } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { GoodReserveCDai, DistributionBridgeMock, IGoodDollar, GenericDistributionHelperTestHelper } from "../../types";
import { createDAO, increaseTime } from "../helpers";
import * as waffle from "ethereum-waffle";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GenericDistributionHelper", () => {
  let goodReserve: GoodReserveCDai;
  let goodDollar: IGoodDollar, genericCall, avatar, founder, signers, setDAOAddress, nameService, cDai;

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

    goodDollar = (await ethers.getContractAt("IGoodDollar", gd)) as IGoodDollar;

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });

    goodReserve = reserve as GoodReserveCDai;
  });

  const fixture = async () => {
    const mpbf = await artifacts.readArtifact("IStaticOracle");

    let oracle = await waffle.deployMockContract(founder, mpbf.abi);
    oracle.mock.quoteAllAvailablePoolsWithTimePeriod.returns(1e13, []);
    oracle.mock.prepareAllAvailablePoolsWithTimePeriod.returns([]);

    const distHelper = (await upgrades.deployProxy(
      await ethers.getContractFactory("GenericDistributionHelperTestHelper"),
      [
        nameService.address,
        oracle.address,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        {
          maxFee: "5000000000000000",
          minBalanceForFees: "10000000000000000",
          percentageToSellForFee: "5",
          maxSlippage: "5"
        }
      ],
      { kind: "uups" }
    )) as GenericDistributionHelperTestHelper;

    //make sure disthelper has enough native token so it doesnt try to swap G$s
    await founder.sendTransaction({
      to: distHelper.address,
      value: ethers.constants.WeiPerEther
    });
    const bridge = (await ethers.deployContract("DistributionBridgeMock")) as DistributionBridgeMock;

    const encodedCall = distHelper.interface.encodeFunctionData("setFeeSettings", [
      {
        maxFee: "5000000000000000",
        minBalanceForFees: "10000000000000000",
        percentageToSellForFee: "5",
        maxSlippage: "5"
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);
    await distHelper.setBridges(bridge.address);

    return { distHelper, bridge, oracle };
  };

  it("should not allow to add recipient", async () => {
    const { distHelper } = await loadFixture(fixture);

    const recipient = signers[0];

    await expect(
      distHelper.addOrUpdateRecipient({
        bps: 3000,
        chainId: 42220,
        addr: recipient.address,
        transferType: 0
      })
    ).to.be.revertedWith(/is missing role 0x0000000000000000000000000000000000000000000000000000000000000000/);
  });

  it("should allow to add recipient by avatar", async () => {
    const { distHelper } = await loadFixture(fixture);

    const recipient = signers[0];

    const encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 3000,
        chainId: 42220,
        addr: recipient.address,
        transferType: 0
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);
    const dr = await distHelper.distributionRecipients(0);
    expect(dr.addr).to.equal(recipient.address);
    expect(dr.chainId).to.equal(42220);
    expect(dr.bps).to.equal(3000);
    expect(dr.transferType).to.equal(0);
  });

  it("should allow to update recipient by avatar", async () => {
    const { distHelper } = await loadFixture(fixture);

    const recipient = signers[0];

    let encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 1000,
        chainId: 4447,
        addr: recipient.address,
        transferType: 1
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 1500,
        chainId: 45,
        addr: recipient.address,
        transferType: 0
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    const updEvents = await distHelper.queryFilter(distHelper.filters.RecipientUpdated());
    const addEvents = await distHelper.queryFilter(distHelper.filters.RecipientAdded());

    const dr = await distHelper.distributionRecipients(0);
    expect(dr.addr).to.equal(recipient.address);
    expect(dr.chainId).to.equal(45);
    expect(dr.bps).to.equal(1500);
    expect(dr.transferType).to.equal(0);
  });

  it("should distribute via layerzero bridge", async () => {
    const { distHelper, bridge } = await loadFixture(fixture);

    const recipient = signers[0];

    let encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 2000,
        chainId: 42220,
        addr: recipient.address,
        transferType: 0
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    await goodDollar.mint(distHelper.address, "100000000000");
    await founder.sendTransaction({
      to: distHelper.address,
      value: ethers.constants.WeiPerEther
    });
    await distHelper.onDistribution("100000000000");
    expect(await goodDollar.allowance(distHelper.address, bridge.address)).to.equal((100000000000 * 2000) / 10000);

    const events = await bridge.queryFilter(bridge.filters.BridgeLz());
    expect(events[0].args.recipient).to.equal(recipient.address);
    expect(events[0].args.amount).to.equal((100000000000 * 2000) / 10000);
    expect(events[0].args.chainId).to.equal(42220);
    expect(events[0].args.fee).to.equal(5e14);
  });

  it("should distribute via transferAndCall", async () => {
    const { distHelper, bridge } = await loadFixture(fixture);

    const recipient = signers[0];

    let encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 2555,
        chainId: 4447,
        addr: signers[0].address,
        transferType: 2
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    await goodDollar.mint(distHelper.address, "100000000000");
    await distHelper.onDistribution("100000000000");
    expect(await goodDollar.balanceOf(signers[0].address)).to.equal((100000000000 * 2555) / 10000);
  });

  it("should distribute to multiple recipients", async () => {
    const { distHelper, bridge } = await loadFixture(fixture);

    const recipient = signers[0];

    let encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 2555,
        chainId: 4447,
        addr: signers[0].address,
        transferType: 1
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 1000,
        chainId: 4447,
        addr: signers[1].address,
        transferType: 1
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 5,
        chainId: 4447,
        addr: signers[2].address,
        transferType: 2
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    await goodDollar.mint(distHelper.address, "100000000000");
    await distHelper.onDistribution("100000000000");
    expect(await goodDollar.balanceOf(signers[0].address)).to.equal((100000000000 * 2555) / 10000);
    expect(await goodDollar.balanceOf(signers[1].address)).to.equal((100000000000 * 1000) / 10000);
    expect(await goodDollar.balanceOf(signers[2].address)).to.equal((100000000000 * 5) / 10000);
  });

  it("should emit distribution event for multiple recipients", async () => {
    const { distHelper, bridge } = await loadFixture(fixture);

    let encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 2555,
        chainId: 122,
        addr: signers[0].address,
        transferType: 0
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 1000,
        chainId: 4447,
        addr: signers[1].address,
        transferType: 1
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    encodedCall = distHelper.interface.encodeFunctionData("addOrUpdateRecipient", [
      {
        bps: 5,
        chainId: 4447,
        addr: signers[2].address,
        transferType: 2
      }
    ]);

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    await goodDollar.mint(distHelper.address, "100000000000");
    await distHelper.onDistribution("100000000000");

    const DistributionEvents = await distHelper.queryFilter(distHelper.filters.Distribution());
    expect(DistributionEvents[0].args.distributionRecipients[0].addr).eq(signers[0].address);
    expect(DistributionEvents[0].args.distributionRecipients[1].addr).eq(signers[1].address);
    expect(DistributionEvents[0].args.distributionRecipients[2].addr).eq(signers[2].address);
  });
});
