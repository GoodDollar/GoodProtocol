import { ethers, waffle } from "hardhat";
import { expect } from "chai";
import { GoodReserveCDai, GoodDollarMintBurnWrapper, ERC20 } from "../../types";
import { createDAO, increaseTime } from "../helpers";
import { Contract } from "ethers";
import { FormatTypes } from "@ethersproject/abi";

const BN = ethers.BigNumber;
export const NULL_ADDRESS = ethers.constants.AddressZero;
export const BLOCK_INTERVAL = 1;

describe("GoodDollarMintBurnWrapper", () => {
  let goodReserve: GoodReserveCDai;
  let goodDollar: ERC20,
    genericCall,
    avatar,
    founder,
    wrapperAdmin,
    signers,
    setDAOAddress,
    nameService,
    cDai;

  before(async () => {
    [founder, wrapperAdmin, ...signers] = await ethers.getSigners();

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

    await wrapper.initialize(
      "100000000000", //1B G$
      wrapperAdmin.address,
      nameService.address
    );

    return { wrapper };
  };

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

  it("should update updateFrequency only by admin role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    expect(await wrapper.updateFrequency()).to.equal(60 * 60 * 24 * 90); //default 90 days;

    await expect(wrapper.setUpdateFrequency(0)).to.be.revertedWith("role");
    await expect(wrapper.connect(wrapperAdmin).setUpdateFrequency(0)).to.not
      .reverted;
    expect(await wrapper.updateFrequency()).to.equal(0);
  });

  it("should be able to pause roles only by admin role", async () => {
    const { wrapper } = await waffle.loadFixture(fixture);

    await expect(
      wrapper.pause(await wrapper.PAUSE_ALL_ROLE())
    ).to.be.revertedWith("role");

    await expect(
      wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_BURN_ROLE())
    ).to.not.reverted;
    expect(await wrapper.paused(await wrapper.PAUSE_BURN_ROLE())).to.equal(
      true
    );

    await expect(
      wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_MINT_ROLE())
    ).to.not.reverted;
    expect(await wrapper.paused(await wrapper.PAUSE_MINT_ROLE())).to.equal(
      true
    );
    await expect(
      wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_REWARDS_ROLE())
    ).to.not.reverted;
    expect(await wrapper.paused(await wrapper.PAUSE_REWARDS_ROLE())).to.equal(
      true
    );

    await expect(
      wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_ROUTER_ROLE())
    ).to.not.reverted;
    expect(await wrapper.paused(await wrapper.PAUSE_ROUTER_ROLE())).to.equal(
      true
    );

    //this is test last because otherwise all other roles are considered paused
    await expect(
      wrapper.connect(wrapperAdmin).pause(await wrapper.PAUSE_ALL_ROLE())
    ).to.not.reverted;
    expect(await wrapper.paused(await wrapper.PAUSE_ALL_ROLE())).to.equal(true);
  });

  it("should be able to unpause roles only by admin role", async () => {});

  it("should be able to mint only by minter role", async () => {});

  it("should not be able to mint when minter is paused", async () => {});

  it("should not be able to mint when passed tx cap", async () => {});

  it("should not be able to mint when passed minter cap", async () => {});

  it("should not be able to mint when passed global cap", async () => {});

  it("should update stats after mint", async () => {});

  it("should be able to burn only by router role", async () => {});

  it("should not be able to burn when router is paused", async () => {});

  it("should update stats after burn", async () => {});
});
