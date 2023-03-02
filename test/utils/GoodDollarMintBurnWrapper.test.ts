import { ethers, waffle, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { GoodReserveCDai, GoodDollarMintBurnWrapper, ERC20, IGoodDollar, MultichainRouterMock } from "../../types";
import { createDAO, increaseTime } from "../helpers";
import { FormatTypes } from "@ethersproject/abi";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

const MINTER_CAP = 1000000;
const MINTER_TX_MAX = 100000;
const REWARD_BPS = 300;

describe("GoodDollarMintBurnWrapper", () => {
  let goodReserve: GoodReserveCDai;
  let goodDollar: IGoodDollar,
    genericCall,
    avatar,
    founder,
    minter,
    minterUncapped,
    rewarder,
    guardian,
    router,
    wrapperAdmin,
    signers,
    setDAOAddress,
    nameService,
    cDai,
    controller;

  before(async () => {
    [founder, wrapperAdmin, minter, rewarder, guardian, minterUncapped, router, ...signers] = await ethers.getSigners();

    let {
      controller: ctrl,
      avatar: av,
      gd,
      identity,
      setDAOAddress: sda,
      setSchemes: ss,
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
    controller = ctrl;

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

  const fixture = async (wallets, provider) => {
    wallets = provider.getWallets();

    const gf = await ethers.getContractFactory("GoodDollarMintBurnWrapper");
    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      wallets[wallets.length - 1] //has scheme permissions set by createDAO()
    );

    const wrapper = (await upgrades.deployProxy(
      await ethers.getContractFactory("GoodDollarMintBurnWrapper"),
      [wrapperAdmin.address, nameService.address],
      {
        kind: "uups"
      }
    )) as GoodDollarMintBurnWrapper;

    await wrapper.connect(wrapperAdmin).grantRole(await wrapper.GUARDIAN_ROLE(), guardian.address);

    await goodDollar.mint(controller, 10000000); //so bps limit is significant

    await wrapper
      .connect(wrapperAdmin)
      .addMinter(router.address, MINTER_CAP, MINTER_TX_MAX, REWARD_BPS, MINTER_CAP, MINTER_TX_MAX, REWARD_BPS, false);

    await wrapper
      .connect(wrapperAdmin)
      .addMinter(minter.address, MINTER_CAP, MINTER_TX_MAX, REWARD_BPS, MINTER_CAP, MINTER_TX_MAX, REWARD_BPS, false);
    await wrapper.connect(wrapperAdmin).addMinter(rewarder.address, 0, 0, REWARD_BPS, 0, 0, 0, true);

    await ictrl.registerScheme(wrapper.address, ethers.constants.HashZero, "0x00000001", avatar);
    return { wrapper };
  };

  const fixture_withMultichain = async (wallets, provider) => {
    wallets = provider.getWallets();

    const gf = await ethers.getContractFactory("GoodDollarMintBurnWrapper");
    const rf = await ethers.getContractFactory("MultichainRouterMock");

    const ictrl = await ethers.getContractAt(
      "Controller",
      controller,
      wallets[wallets.length - 1] //has scheme permissions set by createDAO()
    );

    const wrapper = (await upgrades.deployProxy(
      await ethers.getContractFactory("GoodDollarMintBurnWrapper"),
      [wrapperAdmin.address, nameService.address],
      {
        kind: "uups"
      }
    )) as GoodDollarMintBurnWrapper;

    const multiChainRouter = (await rf.deploy(wrapper.address)) as MultichainRouterMock;

    await wrapper
      .connect(wrapperAdmin)
      .addMinter(
        multiChainRouter.address,
        MINTER_CAP,
        MINTER_TX_MAX,
        REWARD_BPS,
        MINTER_CAP,
        MINTER_TX_MAX,
        REWARD_BPS,
        false
      );

    await setDAOAddress("MULTICHAIN_ROUTER", multiChainRouter.address);
    await goodDollar.mint(controller, 10000000); //so bps limit is significant

    return { wrapper, multiChainRouter };
  };

  it("should be safe for upgrades", async () => {
    const result = await upgrades
      .deployProxy(
        await ethers.getContractFactory("GoodDollarMintBurnWrapper"),
        [wrapperAdmin.address, nameService.address],
        {
          kind: "uups"
        }
      )
      .catch(e => false);
    expect(result).not.false;
  });

  it("should have avatar as default admin ", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    expect(await wrapper.owner()).to.equal(avatar);
    expect(await wrapper.hasRole(await wrapper.DEFAULT_ADMIN_ROLE(), avatar)).to.be.true;
  });

  it("should have admin from params as default admin ", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    expect(await wrapper.hasRole(await wrapper.DEFAULT_ADMIN_ROLE(), wrapperAdmin.address)).to.be.true;
  });

  it("should have erc20 token info", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    expect(await wrapper.decimals()).to.equal(await goodDollar.decimals());
    expect(await wrapper.name()).to.equal("GoodDollar");
    expect(await wrapper.symbol()).to.equal("G$");
  });

  it("should update updateFrequency only by admin or guardian role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    expect(await wrapper.updateFrequency()).to.equal(60 * 60 * 24 * 7); //default 90 days;

    await expect(wrapper.setUpdateFrequency(0)).to.be.revertedWith("role");
    await expect(wrapper.connect(wrapperAdmin).setUpdateFrequency(0)).to.not.reverted;
    expect(await wrapper.updateFrequency()).to.equal(0);
    await expect(wrapper.connect(guardian).setUpdateFrequency(1)).to.not.reverted;
    expect(await wrapper.updateFrequency()).to.equal(1);
  });

  it("should be able to pause roles only by admin or guardian role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.unpause(await wrapper.PAUSE_ALL_ROLE())).to.be.revertedWith("role");

    await expect(wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_BURN_ROLE())).to.not.reverted;
    await expect(wrapper.connect(guardian).pause(await wrapper.PAUSE_ALL_ROLE())).to.not.reverted;

    expect(await wrapper.paused(await wrapper.PAUSE_BURN_ROLE())).to.equal(true);
    expect(await wrapper.paused(await wrapper.PAUSE_ALL_ROLE())).to.equal(true);
  });

  it("should be able to unpause roles only by admin or guardian role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.unpause(await wrapper.PAUSE_ALL_ROLE())).to.be.revertedWith("role");

    await expect(wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_BURN_ROLE())).to.not.reverted;

    await expect(wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_ALL_ROLE())).to.not.reverted;

    await expect(wrapper.connect(guardian).unpause(await wrapper.PAUSE_ALL_ROLE())).to.not.reverted;

    await expect(wrapper.connect(wrapperAdmin).unpause(await wrapper.PAUSE_BURN_ROLE())).to.not.reverted;

    expect(await wrapper.paused(await wrapper.PAUSE_BURN_ROLE())).to.equal(false);
    expect(await wrapper.paused(await wrapper.PAUSE_ALL_ROLE())).to.equal(false);
  });

  it("should be able to mint only by minter role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.mint(founder.address, 1000)).to.revertedWith("role");
    await expect(wrapper.connect(minter).mint(signers[0].address, 1000)).to.not.reverted;
    expect(await goodDollar.balanceOf(signers[0].address)).to.equal(1000);
  });

  it("should not be able to mint when minter is paused", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.connect(guardian).pause(await wrapper.PAUSE_MINT_ROLE())).to.not.reverted;

    await expect(wrapper.connect(minter).mint(signers[0].address, 1000)).revertedWith("pause");
  });

  it("should not be able to mint when passed daily cap", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    try {
      while (true) {
        await wrapper.connect(minter).mint(signers[0].address, MINTER_TX_MAX);
      }
    } catch (e) {
      expect(e.message).to.contain("daily");
    }
  });

  it("should not be able to mint when passed tx cap", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.connect(minter).mint(signers[0].address, MINTER_TX_MAX + 1)).revertedWith("max");
  });

  it("should not be able to mint when passed minter cap", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    for (let i = 0; i < MINTER_CAP / MINTER_TX_MAX; i++) {
      if (i % 3 === 0) {
        await increaseTime(60 * 60 * 24); //pass daily cap
      }
      await wrapper.connect(minter).mint(signers[0].address, MINTER_TX_MAX);
    }

    await expect(wrapper.connect(minter).mint(signers[0].address, MINTER_TX_MAX)).revertedWith("minter cap");
  });

  xit("should not be able to mint when passed global cap", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await wrapper.connect(wrapperAdmin).addMinter(minterUncapped.address, 0, 10000000000, 0, 0, 0, 0, false);

    for (let i = 0; i < 100000000000 / 10000000000; i++)
      await wrapper.connect(minterUncapped).mint(signers[0].address, 10000000000);

    await expect(wrapper.connect(minterUncapped).mint(signers[0].address, 10000000000)).revertedWith("total mint");
  });

  it("should not be able to burn when passed daily cap", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);
    await goodDollar.mint(signers[0].address, 100000000);
    await goodDollar.connect(signers[0]).approve(wrapper.address, 100000000);
    try {
      while (true) {
        await wrapper.connect(router).burn(signers[0].address, MINTER_TX_MAX);
      }
    } catch (e) {
      expect(e.message).to.contain("daily");
    }
  });

  it("should not be able to burn when passed tx cap", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await goodDollar.mint(signers[0].address, 100000000);
    await goodDollar.connect(signers[0]).approve(wrapper.address, 100000000);
    await expect(wrapper.connect(router).burn(signers[0].address, MINTER_TX_MAX + 1)).revertedWith("max");
  });

  it("should not be able to burn when passed minter cap", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);
    await goodDollar.mint(signers[0].address, 100000000);
    await goodDollar.connect(signers[0]).approve(wrapper.address, 100000000);

    for (let i = 0; i < MINTER_CAP / MINTER_TX_MAX; i++) {
      if (i % 3 === 0) {
        await increaseTime(60 * 60 * 24); //pass daily cap
      }
      await wrapper.connect(router).burn(signers[0].address, MINTER_TX_MAX);
    }

    await expect(wrapper.connect(router).burn(signers[0].address, MINTER_TX_MAX)).revertedWith("minter cap");
  });

  it("should update stats after mint", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await wrapper.connect(minter).mint(signers[0].address, 1000);

    expect(await goodDollar.balanceOf(signers[0].address)).to.eq(1000);
    expect(await wrapper.totalMinted()).eq(1000);

    const minterInfo = await wrapper.minterSupply(minter.address);
    expect(minterInfo.totalIn).eq(1000);

    await wrapper.connect(minter).mint(signers[0].address, 500);
    const minterInfoAfter = await wrapper.minterSupply(minter.address);
    expect(await wrapper.totalMinted()).eq(1500);
    expect(minterInfoAfter.totalIn).eq(1500);
  });

  it("should be able to burn only by minter role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);
    await goodDollar.mint(founder.address, 1000);
    await goodDollar.connect(founder).approve(wrapper.address, 1000);
    await expect(wrapper.connect(guardian).burn(founder.address, 1000)).to.revertedWith("role");
    await expect(wrapper.connect(router).burn(founder.address, 1000)).to.not.reverted;

    expect(await goodDollar.balanceOf(founder.address)).to.equal(0);
  });

  it("should not be able to burn when router is paused", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.connect(guardian).pause(await wrapper.PAUSE_ROUTER_ROLE())).to.not.reverted;

    await goodDollar.mint(founder.address, 1000);
    await goodDollar.connect(founder).approve(wrapper.address, 1000);

    await expect(wrapper.connect(router).burn(founder.address, 1000)).revertedWith("pause");
  });

  it("should not update stats after burn when not minted yet", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await goodDollar.mint(founder.address, 1000);
    await goodDollar.connect(founder).approve(wrapper.address, 1000);
    await expect(wrapper.connect(router).burn(founder.address, 1000)).to.not.reverted;

    expect(await wrapper.totalMinted()).eq(0);

    const minterInfo = await wrapper.minterSupply(minter.address);
    expect(minterInfo.totalIn).eq(0);
  });

  it("should update global stats when minter!=burner after burn when already minted", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await wrapper.connect(minter).mint(signers[0].address, 1000);

    await goodDollar.mint(founder.address, 500);
    await goodDollar.connect(founder).approve(wrapper.address, 500);
    await expect(wrapper.connect(router).burn(founder.address, 500)).to.not.reverted;

    expect(await wrapper.totalMinted()).eq(500);

    const minterInfo = await wrapper.minterSupply(minter.address);
    expect(minterInfo.totalIn).eq(1000);
  });

  it("should update both global and minter stats when minter==burner after burn when already minted", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await wrapper.connect(wrapperAdmin).grantRole(await wrapper.ROUTER_ROLE(), minter.address);
    await wrapper.connect(minter).mint(signers[0].address, 1000);

    await goodDollar.mint(founder.address, 500);
    await goodDollar.connect(founder).approve(wrapper.address, 500);
    await expect(wrapper.connect(minter).burn(founder.address, 500)).to.not.reverted;

    expect(await wrapper.totalMinted()).eq(500);

    const minterInfo = await wrapper.minterSupply(minter.address);
    expect(minterInfo.totalIn).eq(500);
  });

  it("should reset minter total when burn amount > total", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await wrapper.connect(wrapperAdmin).grantRole(await wrapper.ROUTER_ROLE(), minter.address);
    await wrapper.connect(minter).mint(signers[0].address, 1000);

    await goodDollar.mint(founder.address, 2000);
    await goodDollar.connect(founder).approve(wrapper.address, 2000);
    await expect(wrapper.connect(minter).burn(founder.address, 2000)).to.not.reverted;

    expect(await wrapper.totalMinted()).eq(0);

    const minterInfo = await wrapper.minterSupply(minter.address);
    expect(minterInfo.totalIn).eq(0);
  });

  it("should update mint stats after sendOrMint", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await wrapper.connect(rewarder).sendOrMint(signers[0].address, 1000);
    const minterInfo = await wrapper.minterSupply(rewarder.address);

    expect(await goodDollar.balanceOf(signers[0].address)).to.eq(1000);
    expect(minterInfo.totalIn).eq(1000);
    expect(minterInfo.mintedToday).eq(1000);
    expect(minterInfo.totalRewards).eq(1000);
    expect(await wrapper.totalMinted()).eq(1000);
    expect(await wrapper.totalMintDebt()).eq(1000);
    expect(await wrapper.totalRewards()).eq(1000);
  });

  it("should not update mint stats after sendOrMint when wrapper has G$ balance", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await goodDollar.mint(wrapper.address, 1000);

    await wrapper.connect(rewarder).sendOrMint(signers[0].address, 1000);
    const minterInfo = await wrapper.minterSupply(rewarder.address);

    expect(await goodDollar.balanceOf(signers[0].address)).to.eq(1000);
    expect(minterInfo.totalIn).eq(0);
    expect(minterInfo.totalRewards).eq(1000);
    expect(minterInfo.mintedToday).eq(0);
    expect(await wrapper.totalMinted()).eq(0);
    expect(await wrapper.totalMintDebt()).eq(0);
    expect(await wrapper.totalRewards()).eq(1000);
  });

  it("should perform send and mint when having partial balance for sendOrMint", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await goodDollar.mint(wrapper.address, 500);

    await wrapper.connect(rewarder).sendOrMint(signers[0].address, 1000);
    const minterInfo = await wrapper.minterSupply(rewarder.address);

    expect(await goodDollar.balanceOf(signers[0].address)).to.eq(1000);
    expect(await goodDollar.balanceOf(wrapper.address)).to.eq(0);
    expect(minterInfo.totalIn).eq(500);
    expect(minterInfo.totalRewards).eq(1000);
    expect(minterInfo.mintedToday).eq(500);
    expect(await wrapper.totalMinted()).eq(500);
    expect(await wrapper.totalMintDebt()).eq(500);
    expect(await wrapper.totalRewards()).eq(1000);
  });

  it("should reduce debt in sendOrMint", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await wrapper.connect(rewarder).sendOrMint(signers[0].address, 200); //200 debt
    const minterInfo = await wrapper.minterSupply(rewarder.address);
    expect(await wrapper.totalMintDebt()).eq(200);
    expect(await wrapper.totalRewards()).eq(200);
    expect(minterInfo.totalRewards).eq(200);

    await goodDollar.mint(wrapper.address, 1200);

    await wrapper.connect(rewarder).sendOrMint(signers[0].address, 1000);
    const minterInfoAfter = await wrapper.minterSupply(rewarder.address);

    expect(await wrapper.totalMintDebt()).eq(0);
    expect(await wrapper.totalRewards()).eq(1200);

    expect(minterInfoAfter.totalRewards).eq(1200);
  });

  it("should mint just partial amount if daily limit passed in sendOrMint", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    let minterInfo = await wrapper.minterSupply(rewarder.address);

    await wrapper.connect(rewarder).sendOrMint(signers[0].address, minterInfo.dailyCapIn.add(1000));

    minterInfo = await wrapper.minterSupply(rewarder.address);

    expect(await goodDollar.balanceOf(signers[0].address)).to.eq(minterInfo.dailyCapIn);
    expect(minterInfo.totalIn).eq(minterInfo.dailyCapIn);
    expect(minterInfo.totalRewards).eq(minterInfo.dailyCapIn);
    expect(minterInfo.mintedToday).eq(minterInfo.dailyCapIn);
    expect(await wrapper.totalMinted()).eq(minterInfo.dailyCapIn);
    expect(await wrapper.totalMintDebt()).eq(minterInfo.dailyCapIn);
    expect(await wrapper.totalRewards()).eq(minterInfo.dailyCapIn);
  });

  it("should reset rewarder and minter mintedToday after day passed", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await wrapper.connect(rewarder).sendOrMint(signers[0].address, "1000");

    await wrapper.connect(minter).mint(signers[0].address, "1000");

    await increaseTime(60 * 60 * 24);

    await expect(wrapper.connect(rewarder).sendOrMint(signers[0].address, "1001")).to.not.reverted;

    await expect(wrapper.connect(minter).mint(signers[0].address, "1001")).to.not.reverted;

    expect(await goodDollar.balanceOf(signers[0].address)).to.eq("4002");
    const minterInfo = await wrapper.minterSupply(rewarder.address);
    const minterInfo2 = await wrapper.minterSupply(minter.address);
    expect(minterInfo.mintedToday).eq(minterInfo2.mintedToday).eq("1001");
  });

  it("should update rewarder daily limit after updateFrequency days passed", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await goodDollar.mint(controller, 100000000000);
    const totalSupplyBeforeMint = await goodDollar.totalSupply();
    let minterInfo = await wrapper.minterSupply(rewarder.address);

    const frequency = await wrapper.updateFrequency();
    await increaseTime(frequency.toNumber());

    await wrapper.connect(rewarder).sendOrMint(signers[0].address, minterInfo.dailyCapIn.add(1000));

    let minterInfoAfter = await wrapper.minterSupply(rewarder.address);

    expect(minterInfoAfter.dailyCapIn).gt(minterInfo.dailyCapIn);
    expect(minterInfoAfter.dailyCapIn).eq(totalSupplyBeforeMint.mul(REWARD_BPS).div(10000)); //we doubled the G$ supply so bps relative to supply should be double now
  });

  it("should not mint but not revert when rewarder passes daily limit", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    const minterInfo = await wrapper.minterSupply(rewarder.address);
    await wrapper.connect(rewarder).sendOrMint(signers[0].address, minterInfo.dailyCapIn);

    const tx = await (await wrapper.connect(rewarder).sendOrMint(signers[1].address, minterInfo.dailyCapIn)).wait();

    const sendOrMintEvent = tx.events.find(_ => _.event === "SendOrMint");

    expect(await goodDollar.balanceOf(signers[1].address)).to.eq(0);
    expect(sendOrMintEvent.args.minted).to.eq(0);
    expect(sendOrMintEvent.args.sent).to.eq(0);
  });

  it("should allow guardian to update minter limits and rewarder daily limit", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.setMinterCaps(minter.address, 0, 0, 0, 0, 0, 0)).to.be.revertedWith("role");

    await expect(wrapper.connect(guardian).setMinterCaps(minter.address, 0, 0, 50, 0, 0, 60)).to.not.reverted;

    const minterInfo = await wrapper.minterSupply(minter.address);
    const minterOutLimits = await wrapper.minterOutLimits(minter.address);

    expect(minterInfo.capIn).to.eq(0);
    expect(minterInfo.maxIn).to.eq(0);
    expect(minterInfo.bpsPerDayIn).to.eq(50);
    expect(minterOutLimits.capOut).to.eq(0);
    expect(minterOutLimits.maxOut).to.eq(0);
    expect(minterOutLimits.bpsPerDayOut).to.eq(60);
    expect(minterInfo.dailyCapIn).eq((await goodDollar.totalSupply()).mul(50).div(10000));
    expect(minterOutLimits.dailyCapOut).eq((await goodDollar.totalSupply()).mul(60).div(10000));
  });

  xit("should allow guardian to update totalMintCap", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.setTotalMintCap(0)).to.be.revertedWith("role");

    await expect(wrapper.connect(guardian).setTotalMintCap(0)).to.not.reverted;

    expect(await wrapper.totalMintCap()).to.eq(0);
  });

  it("should support transferAndCall for multichain bridge transfer", async () => {
    const { wrapper, multiChainRouter } = await waffle.loadFixture(fixture_withMultichain);

    await goodDollar.mint(founder.address, 100000);
    await goodDollar.transferAndCall(
      wrapper.address,
      100000,
      ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [minter.address, "4220"])
    );

    expect(await goodDollar.balanceOf(founder.address)).to.eq(0); //verify burn happened
    expect(await goodDollar.balanceOf(wrapper.address)).to.eq(0); //verify burn happened
    const events = await multiChainRouter.queryFilter(multiChainRouter.filters.AnySwap());
    expect(events[0].args.recipient).to.equal(minter.address);
    expect(events[0].args.chainId).to.equal(4220);
  });

  it("should default to sender as recipient on transferAndCall if recipient=0", async () => {
    const { wrapper, multiChainRouter } = await waffle.loadFixture(fixture_withMultichain);

    await goodDollar.mint(founder.address, 100000);
    await goodDollar.transferAndCall(
      wrapper.address,
      100000,
      ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [ethers.constants.AddressZero, "4220"])
    );

    expect(await goodDollar.balanceOf(founder.address)).to.eq(0); //verify burn happened
    expect(await goodDollar.balanceOf(wrapper.address)).to.eq(0); //verify burn happened
    const events = await multiChainRouter.queryFilter(multiChainRouter.filters.AnySwap());
    expect(events[0].args.recipient).to.equal(founder.address);
    expect(events[0].args.chainId).to.equal(4220);
  });

  it("should fail transferAndCall for multichain if no chainid", async () => {
    const { wrapper, multiChainRouter } = await waffle.loadFixture(fixture_withMultichain);

    await goodDollar.mint(founder.address, 100000);
    await expect(
      goodDollar.transferAndCall(
        wrapper.address,
        100000,
        ethers.utils.defaultAbiCoder.encode(["address", "uint"], [minter.address, 0])
      )
    ).revertedWith("chainId");
  });

  it("should not mint or sendOrMint to self", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.connect(minter).mint(wrapper.address, 1)).revertedWith("self");
    await expect(wrapper.connect(rewarder).sendOrMint(wrapper.address, 1)).revertedWith("self");
  });
});
