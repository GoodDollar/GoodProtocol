import { ethers, waffle } from "hardhat";
import { expect } from "chai";
import { GoodReserveCDai, GoodDollarMintBurnWrapper, ERC20 } from "../../types";
import { createDAO, increaseTime } from "../helpers";
import { Contract } from "ethers";
import { FormatTypes } from "@ethersproject/abi";
import { recoverAddress } from "ethers/lib/utils";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GoodDollarMintBurnWrapper", () => {
  let goodReserve: GoodReserveCDai;
  let goodDollar: ERC20,
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

    goodDollar = (await ethers.getContractAt("IGoodDollar", gd)) as ERC20;

    console.log("deployed contribution, deploying reserve...", {
      founder: founder.address
    });

    goodReserve = reserve as GoodReserveCDai;
  });

  const fixture = async (wallets, provider) => {
    const gf = await ethers.getContractFactory("GoodDollarMintBurnWrapper");

    wallets = provider.getWallets();
    const wrapper = (await waffle.deployContract(wallets[0], {
      abi: JSON.parse(gf.interface.format(FormatTypes.json) as string) as any[],
      bytecode: gf.bytecode
    })) as GoodDollarMintBurnWrapper;

    await wrapper.initialize(nameService.address);

    return { wrapper };
  };

  it("should not allow to add recipient", async () => {
    const { distHelper } = await waffle.loadFixture(fixture);

    const recipient = signers[0];

    await expect(
      distHelper.addOrUpdateRecipient({
        bps: 3000,
        chainId: 1,
        addr: recipient.address,
        transferType: 0
      })
    ).to.be.revertedWith(
      "is missing role 0x0000000000000000000000000000000000000000000000000000000000000000"
    );
  });

  it("should allow to add recipient by avatar", async () => {
    const { distHelper } = await waffle.loadFixture(fixture);

    const recipient = signers[0];

    const encodedCall = distHelper.interface.encodeFunctionData(
      "addOrUpdateRecipient",
      [
        {
          bps: 3000,
          chainId: 1,
          addr: recipient.address,
          transferType: 0
        }
      ]
    );

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);
    const dr = await distHelper.distributionRecipients(0);
    expect(dr.addr).to.equal(recipient.address);
    expect(dr.chainId).to.equal(1);
    expect(dr.bps).to.equal(3000);
    expect(dr.transferType).to.equal(0);
  });

  it("should allow to update recipient by avatar", async () => {
    const { distHelper } = await waffle.loadFixture(fixture);

    const recipient = signers[0];

    let encodedCall = distHelper.interface.encodeFunctionData(
      "addOrUpdateRecipient",
      [
        {
          bps: 1000,
          chainId: 2,
          addr: recipient.address,
          transferType: 1
        }
      ]
    );

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    encodedCall = distHelper.interface.encodeFunctionData(
      "addOrUpdateRecipient",
      [
        {
          bps: 1500,
          chainId: 45,
          addr: recipient.address,
          transferType: 2
        }
      ]
    );

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    const updEvents = await distHelper.queryFilter(
      distHelper.filters.RecipientUpdated()
    );
    const addEvents = await distHelper.queryFilter(
      distHelper.filters.RecipientAdded()
    );

    const dr = await distHelper.distributionRecipients(0);
    expect(dr.addr).to.equal(recipient.address);
    expect(dr.chainId).to.equal(45);
    expect(dr.bps).to.equal(1500);
    expect(dr.transferType).to.equal(2);
  });

  it("should distribute via fuse bridge", async () => {
    const { distHelper, bridge } = await waffle.loadFixture(fixture);

    const recipient = signers[0];

    let encodedCall = distHelper.interface.encodeFunctionData(
      "addOrUpdateRecipient",
      [
        {
          bps: 2000,
          chainId: 1,
          addr: recipient.address,
          transferType: 0
        }
      ]
    );

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    await goodDollar.mint(distHelper.address, "100000000000");
    await distHelper.onDistribution("100000000000");
    expect(await goodDollar.balanceOf(bridge.address)).to.equal(
      (100000000000 * 2000) / 10000
    );

    const events = await bridge.queryFilter(bridge.filters.OnToken());
    expect(events[0].args.sender).to.equal(distHelper.address);
    expect(events[0].args.amount).to.equal((100000000000 * 2000) / 10000);
    expect(events[0].args.data).to.equal(recipient.address.toLowerCase());
  });

  it("should distribute via multichain bridge", async () => {
    const { distHelper, bridge } = await waffle.loadFixture(fixture);

    const recipient = signers[0];

    let encodedCall = distHelper.interface.encodeFunctionData(
      "addOrUpdateRecipient",
      [
        {
          bps: 2000,
          chainId: 4000,
          addr: recipient.address, //needs to be a contract for transferAndCall to work
          transferType: 1
        }
      ]
    );

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    await goodDollar.mint(distHelper.address, "100000000000");
    await distHelper.onDistribution("100000000000");
    expect(
      await goodDollar.allowance(distHelper.address, bridge.address)
    ).to.equal((100000000000 * 2000) / 10000);

    const events = await bridge.queryFilter(bridge.filters.AnySwap());
    expect(events[0].args.token).to.equal(goodDollar.address);
    expect(events[0].args.recipient).to.equal(recipient.address);
    expect(events[0].args.amount).to.equal((100000000000 * 2000) / 10000);
    expect(events[0].args.chainId).to.equal(4000);
  });

  it("should distribute via transferAndCall", async () => {
    const { distHelper, bridge } = await waffle.loadFixture(fixture);

    const recipient = signers[0];

    let encodedCall = distHelper.interface.encodeFunctionData(
      "addOrUpdateRecipient",
      [
        {
          bps: 2555,
          chainId: 1,
          addr: signers[0].address,
          transferType: 2
        }
      ]
    );

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    await goodDollar.mint(distHelper.address, "100000000000");
    await distHelper.onDistribution("100000000000");
    expect(await goodDollar.balanceOf(signers[0].address)).to.equal(
      (100000000000 * 2555) / 10000
    );
  });

  it("should distribute to multiple recipients", async () => {
    const { distHelper, bridge } = await waffle.loadFixture(fixture);

    const recipient = signers[0];

    let encodedCall = distHelper.interface.encodeFunctionData(
      "addOrUpdateRecipient",
      [
        {
          bps: 2555,
          chainId: 1,
          addr: signers[0].address,
          transferType: 2
        }
      ]
    );

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    encodedCall = distHelper.interface.encodeFunctionData(
      "addOrUpdateRecipient",
      [
        {
          bps: 1000,
          chainId: 1,
          addr: signers[1].address,
          transferType: 2
        }
      ]
    );

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    encodedCall = distHelper.interface.encodeFunctionData(
      "addOrUpdateRecipient",
      [
        {
          bps: 5,
          chainId: 1,
          addr: signers[2].address,
          transferType: 2
        }
      ]
    );

    await genericCall(distHelper.address, encodedCall, avatar.address, 0);

    await goodDollar.mint(distHelper.address, "100000000000");
    await distHelper.onDistribution("100000000000");
    expect(await goodDollar.balanceOf(signers[0].address)).to.equal(
      (100000000000 * 2555) / 10000
    );
    expect(await goodDollar.balanceOf(signers[1].address)).to.equal(
      (100000000000 * 1000) / 10000
    );
    expect(await goodDollar.balanceOf(signers[2].address)).to.equal(
      (100000000000 * 5) / 10000
    );
  });
});
