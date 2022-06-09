import { ethers, waffle, upgrades } from "hardhat";
import { expect } from "chai";
import { GoodReserveCDai, GoodDollarMintBurnWrapper, ERC20 } from "../../types";
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
  let goodDollar: ERC20,
    genericCall,
    avatar,
    founder,
    minter,
    rewarder,
    guardian,
    wrapperAdmin,
    signers,
    setDAOAddress,
    nameService,
    cDai,
    controller;

  before(async () => {
    [founder, wrapperAdmin, minter, rewarder, guardian, ...signers] =
      await ethers.getSigners();

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
    } = await createDAO();

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

    goodDollar = (await ethers.getContractAt("IGoodDollar", gd)) as ERC20;

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
    // const wrapper = (await waffle.deployContract(wallets[0], {
    //   abi: JSON.parse(gf.interface.format(FormatTypes.json) as string) as any[],
    //   bytecode: gf.bytecode
    // })) as GoodDollarMintBurnWrapper;

    // await wrapper.initialize(
    //   "100000000000", //1B G$
    //   wrapperAdmin.address,
    //   nameService.address
    // );

    const wrapper = (await upgrades.deployProxy(
      await ethers.getContractFactory("GoodDollarMintBurnWrapper"),
      [
        "100000000000", //1B G$
        wrapperAdmin.address,
        nameService.address
      ],
      {
        kind: "uups"
      }
    )) as GoodDollarMintBurnWrapper;

    await wrapper
      .connect(wrapperAdmin)
      .grantRole(await wrapper.GUARDIAN_ROLE(), guardian.address);
    await wrapper
      .connect(wrapperAdmin)
      .addMinter(minter.address, MINTER_CAP, MINTER_TX_MAX, 0, false);
    await wrapper
      .connect(wrapperAdmin)
      .addMinter(rewarder.address, MINTER_CAP, MINTER_TX_MAX, REWARD_BPS, true);

    await ictrl.registerScheme(
      wrapper.address,
      ethers.constants.HashZero,
      "0x00000001",
      avatar
    );
    return { wrapper };
  };

  it("should be safe for upgrades", async () => {
    const result = await upgrades
      .deployProxy(
        await ethers.getContractFactory("GoodDollarMintBurnWrapper"),
        [
          "100000000000", //1B G$
          wrapperAdmin.address,
          nameService.address
        ],
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
    expect(await wrapper.hasRole(await wrapper.DEFAULT_ADMIN_ROLE(), avatar)).to
      .be.true;
  });

  it("should have admin from params as default admin ", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    expect(
      await wrapper.hasRole(
        await wrapper.DEFAULT_ADMIN_ROLE(),
        wrapperAdmin.address
      )
    ).to.be.true;
  });

  it("should have erc20 token info", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    expect(await wrapper.decimals()).to.equal(2);
    expect(await wrapper.name()).to.equal("GoodDollar");
    expect(await wrapper.symbol()).to.equal("G$");
  });

  it("should update updateFrequency only by admin or guardian role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    expect(await wrapper.updateFrequency()).to.equal(60 * 60 * 24 * 90); //default 90 days;

    await expect(wrapper.setUpdateFrequency(0)).to.be.revertedWith("role");
    await expect(wrapper.connect(wrapperAdmin).setUpdateFrequency(0)).to.not
      .reverted;
    expect(await wrapper.updateFrequency()).to.equal(0);
    await expect(wrapper.connect(guardian).setUpdateFrequency(1)).to.not
      .reverted;
    expect(await wrapper.updateFrequency()).to.equal(1);
  });

  it("should be able to pause roles only by admin or guardian role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(
      wrapper.unpause(await wrapper.PAUSE_ALL_ROLE())
    ).to.be.revertedWith("role");

    await expect(
      wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_BURN_ROLE())
    ).to.not.reverted;
    await expect(
      wrapper.connect(guardian).pause(await wrapper.PAUSE_ALL_ROLE())
    ).to.not.reverted;

    expect(await wrapper.paused(await wrapper.PAUSE_BURN_ROLE())).to.equal(
      true
    );
    expect(await wrapper.paused(await wrapper.PAUSE_ALL_ROLE())).to.equal(true);
  });

  it("should be able to unpause roles only by admin or guardian role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(
      wrapper.unpause(await wrapper.PAUSE_ALL_ROLE())
    ).to.be.revertedWith("role");

    await expect(
      wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_BURN_ROLE())
    ).to.not.reverted;

    await expect(
      wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_ALL_ROLE())
    ).to.not.reverted;

    await expect(
      wrapper.connect(guardian).unpause(await wrapper.PAUSE_ALL_ROLE())
    ).to.not.reverted;

    await expect(
      wrapper.connect(wrapperAdmin).unpause(await wrapper.PAUSE_BURN_ROLE())
    ).to.not.reverted;

    expect(await wrapper.paused(await wrapper.PAUSE_BURN_ROLE())).to.equal(
      false
    );
    expect(await wrapper.paused(await wrapper.PAUSE_ALL_ROLE())).to.equal(
      false
    );
  });

  it("should be able to mint only by minter role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(wrapper.mint(founder.address, 1000)).to.revertedWith("role");
    await expect(wrapper.connect(minter).mint(signers[0].address, 1000)).to.not
      .reverted;
    expect(await goodDollar.balanceOf(signers[0].address)).to.equal(1000);
  });

  it("should not be able to mint when minter is paused", async () => {});

  it("should not be able to mint when passed tx cap", async () => {});

  it("should not be able to mint when passed minter cap", async () => {});

  it("should not be able to mint when passed global cap", async () => {});

  it("should update stats after mint", async () => {});

  it("should be able to burn only by router role", async () => {});

  it("should not be able to burn when router is paused", async () => {});

  it("should update stats after burn", async () => {});
});
