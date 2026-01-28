/**
 * @file E2E test for BuyGDClone contract on Celo fork
 * 
 * This test suite verifies the BuyGDClone contract functionality on a Celo mainnet fork.
 * It tests the cUSD -> GLOUSD -> G$ swap path as specified in the GitHub issue.
 * 
 * To run this test:
 * 1. Make sure you have a Celo RPC endpoint available (or use public forno.celo.org)
 * 2. Run: npx hardhat test test/utils/BuyGDClone.celo-fork.test.ts
 * 
 * Note: This test forks Celo mainnet, so it requires network access and may take longer to run.
 */

import { ethers, network } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BuyGDCloneV2, BuyGDCloneFactory } from "../../types";
import deployments from "../../releases/deployment.json";
import * as networkHelpers from "@nomicfoundation/hardhat-network-helpers";

// Celo mainnet addresses
const CELO_MAINNET_RPC = "https://forno.celo.org";
const CELO_CHAIN_ID = 42220;

// Production Celo addresses from deployment.json (used for existing contracts on fork)
const PRODUCTION_CELO = deployments["production-celo"];
const GOODDOLLAR = PRODUCTION_CELO.GoodDollar;
const CUSD = PRODUCTION_CELO.CUSD;
const UNISWAP_V3_ROUTER = PRODUCTION_CELO.UniswapV3Router;
const STATIC_ORACLE = PRODUCTION_CELO.StaticOracle;
const MENTO_BROKER = PRODUCTION_CELO.MentoBroker;
const MENTO_EXCHANGE_PROVIDER = PRODUCTION_CELO.MentoExchangeProvider;
const MENTO_EXCHANGE_ID = PRODUCTION_CELO.CUSDExchangeId;
const CELO = "0x471EcE3750Da237f93B8E339c536989b8978a438";
const QUOTE = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8";

// GLOUSD address on Celo mainnet
const GLOUSD_REFERENCE = "0x4F604735c1cF31399C6E711D5962b2B3E0225AD3"; // Common GLOUSD address

// Account with cUSD balance on Celo (for impersonation)
const CUSD_WHALE = "0xAC19B8Ab514623144CBc92C9C4ACb3583E594bE3"; // Example whale address

describe("BuyGDClone - Celo Fork E2E", function () {
  // Increase timeout for fork tests
  this.timeout(600000);

  this.afterAll(async function () {
    await networkHelpers.reset();
  });
  before(async function () {
    await networkHelpers.reset(CELO_MAINNET_RPC);
  });

  async function forkCelo() {
    const [deployer, user] = await ethers.getSigners();

    // Get existing contracts from Celo (for router, oracle, tokens)
    const router = await ethers.getContractAt("contracts/Interfaces.sol:ISwapRouter", UNISWAP_V3_ROUTER);
    const oracleAddress = STATIC_ORACLE;
    const gdToken = await ethers.getContractAt("contracts/Interfaces.sol:ERC20", GOODDOLLAR);
    const cusdToken = await ethers.getContractAt("contracts/Interfaces.sol:ERC20", CUSD);
    const celoToken = await ethers.getContractAt("contracts/Interfaces.sol:ERC20", CELO);

    const stableAddress = process.env.GLOUSD_ADDRESS || GLOUSD_REFERENCE;
    console.log("Using stable token (GLOUSD):", stableAddress);

    // Deploy BuyGDCloneFactory
    const BuyGDCloneFactoryFactory = await ethers.getContractFactory("BuyGDCloneFactory");
    const factory = (await BuyGDCloneFactoryFactory.deploy(
      router.address,
      stableAddress,
      GOODDOLLAR,
      oracleAddress,
      MENTO_BROKER,
      MENTO_EXCHANGE_PROVIDER,
      MENTO_EXCHANGE_ID,
      {gasLimit: 15000000}
    )) as BuyGDCloneFactory;

    await factory.deployed();
    console.log("✓ BuyGDCloneFactory deployed at:", factory.address);

    // Verify the stable token in the factory
    const factoryStable = await factory.stable();
    expect(factoryStable.toLowerCase()).to.equal(stableAddress.toLowerCase());
    console.log("✓ Factory stable token verified:", factoryStable);

    // Impersonate a whale account to get cUSD
    const whale = await ethers.getImpersonatedSigner(CUSD_WHALE);
    await ethers.provider.send("hardhat_setBalance", [
      CUSD_WHALE,
      "0x1000000000000000000",
    ]);

    return {
      deployer,
      user,
      factory,
      gdToken,
      cusdToken,
      celoToken,
      stableAddress,
      whale,
      router,
      oracleAddress,
      MENTO_BROKER,
      MENTO_EXCHANGE_PROVIDER,
      MENTO_EXCHANGE_ID
    };
  }

  describe("cUSD Swap Tests", function () {
    it("Should use Uniswap when Mento is not configured", async function () {
      const { deployer, user, gdToken, cusdToken, whale, router, oracleAddress } = await loadFixture(forkCelo);

      // Create factory without Mento configuration
      const BuyGDCloneFactoryFactory = await ethers.getContractFactory("BuyGDCloneFactory");
      const factoryWithoutMento = (await BuyGDCloneFactoryFactory.deploy(
        router.address,
        process.env.GLOUSD_ADDRESS || GLOUSD_REFERENCE,
        GOODDOLLAR,
        oracleAddress,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.HashZero
      )) as BuyGDCloneFactory;

      await factoryWithoutMento.create(user.address);
      const cloneAddress = await factoryWithoutMento.predict(user.address);
      const clone = (await ethers.getContractAt(
        "BuyGDCloneV2",
        cloneAddress
      )) as BuyGDCloneV2;

      const swapAmount = ethers.utils.parseEther("5");
      const whaleBalance = await cusdToken.balanceOf(whale.address);

      if (whaleBalance.lt(swapAmount)) {
        throw new Error(`Whale doesn't have enough cUSD. Balance: ${ethers.utils.formatEther(whaleBalance)}, Required: ${ethers.utils.formatEther(swapAmount)}`);
      }

      await cusdToken.connect(whale).transfer(cloneAddress, swapAmount);

      // Should be able to get Uniswap expected return
      const uniswapExpected = await clone.getExpectedReturnFromUniswap(swapAmount);
      expect(uniswapExpected).to.be.gt(0);

      // Should revert when trying to get Mento expected return
      await expect(clone.getExpectedReturnFromMento(swapAmount)).to.be.revertedWithCustomError(
        clone,
        "MENTO_NOT_CONFIGURED"
      );

      const initialGdBalance = await gdToken.balanceOf(user.address);
      const [minByTwap] = await clone.minAmountByTWAP(swapAmount, CUSD, 300);
      const minAmount = minByTwap;

      // swapCusd should use Uniswap (only option)
      const swapTx = await clone.swapCusd(minAmount, user.address);
      const swapReceipt = await swapTx.wait();

      // Should emit BoughtFromUniswap event
      const uniswapEvent = swapReceipt.events?.find(
        (e: any) => e.event === "BoughtFromUniswap"
      );
      expect(uniswapEvent).to.not.be.undefined;
      console.log("✓ BoughtFromUniswap event emitted:", {
        inToken: uniswapEvent?.args?.inToken,
        inAmount: ethers.utils.formatEther(uniswapEvent?.args?.inAmount),
        outAmount: ethers.utils.formatEther(uniswapEvent?.args?.outAmount),
      });

      // Should not emit BoughtFromMento event
      const mentoEvent = swapReceipt.events?.find(
        (e: any) => e.event === "BoughtFromMento"
      );
      expect(mentoEvent).to.be.undefined;

      const finalGdBalance = await gdToken.balanceOf(user.address);
      const gdReceived = finalGdBalance.sub(initialGdBalance);
      expect(gdReceived).to.be.gt(0);
      expect(gdReceived).to.be.gte(minAmount);
      console.log("✓ Used Uniswap when Mento not configured, received:", ethers.utils.formatEther(gdReceived), "G$");
    });
    it("Should compare Uniswap vs Mento and choose better route", async function () {
      const { factory, user, gdToken, cusdToken, whale } = await loadFixture(forkCelo);

      await factory.create(user.address);
      const cloneAddress = await factory.predict(user.address);
      const clone = (await ethers.getContractAt(
        "BuyGDCloneV2",
        cloneAddress
      )) as BuyGDCloneV2;

      const swapAmount = ethers.utils.parseEther("5");
      const whaleBalance = await cusdToken.balanceOf(whale.address);

      if (whaleBalance.lt(swapAmount)) {
        throw new Error(`Whale doesn't have enough cUSD. Balance: ${ethers.utils.formatEther(whaleBalance)}, Required: ${ethers.utils.formatEther(swapAmount)}`);
      }

      await cusdToken.connect(whale).transfer(cloneAddress, swapAmount);

      // Get expected returns
      const uniswapExpected = await clone.getExpectedReturnFromUniswap(swapAmount);
      const mentoExpected = await clone.getExpectedReturnFromMento(swapAmount);

      console.log("Route comparison:");
      console.log("  Uniswap expected:", ethers.utils.formatEther(uniswapExpected), "G$");
      console.log("  Mento expected:", ethers.utils.formatEther(mentoExpected), "G$");

      const initialGdBalance = await gdToken.balanceOf(user.address);
      const [minByTwap] = await clone.minAmountByTWAP(swapAmount, CUSD, 300);
      const minAmount = minByTwap;

      // Call swapCusd which should choose the better route
      const swapTx = await clone.swapCusd(minAmount, user.address);
      const swapReceipt = await swapTx.wait();

      const finalGdBalance = await gdToken.balanceOf(user.address);
      const gdReceived = finalGdBalance.sub(initialGdBalance);

      expect(gdReceived).to.be.gt(0);
      expect(gdReceived).to.be.gte(minAmount);

      // Check which route was used based on event
      const mentoEvent = swapReceipt.events?.find(
        (e: any) => e.event === "BoughtFromMento"
      );
      const uniswapEvent = swapReceipt.events?.find(
        (e: any) => e.event === "BoughtFromUniswap"
      );
      const usedMento = mentoEvent !== undefined;
      const usedUniswap = uniswapEvent !== undefined;

      if (mentoExpected.gt(uniswapExpected)) {
        expect(usedMento).to.be.true;
        expect(usedUniswap).to.be.false;
        console.log("✓ Correctly chose Mento (better return)");
        console.log("✓ BoughtFromMento event emitted");
      } else {
        expect(usedMento).to.be.false;
        expect(usedUniswap).to.be.true;
        console.log("✓ Correctly chose Uniswap (better return)");
        console.log("✓ BoughtFromUniswap event emitted");
      }

      console.log("✓ Received:", ethers.utils.formatEther(gdReceived), "G$");
    });
  });

  describe("CELO Swap Tests", function () {
    it("Should swap Celo -> GLOUSD -> G$ via clone", async function () {
    /// Skip test because forking does not fork the precompiled contracts from celo mainnet
    if(network.name === 'hardhat') {
      this.skip();
      return;      
    }
    const { factory, user, gdToken, celoToken, whale } = await loadFixture(forkCelo);

    // Create clone
    await factory.create(user.address);
    const cloneAddress = await factory.predict(user.address);
    const clone = (await ethers.getContractAt(
      "BuyGDCloneV2",
      cloneAddress
    )) as BuyGDCloneV2;

    // Transfer CELO to clone (simulating onramp service)
    const swapAmount = ethers.utils.parseEther("1000");
    const whaleCeloBalance = await celoToken.balanceOf(whale.address);

    if (whaleCeloBalance.lt(swapAmount)) {
      throw new Error(`Whale doesn't have enough CELO. Balance: ${ethers.utils.formatEther(whaleCeloBalance)}, Required: ${ethers.utils.formatEther(swapAmount)}`);
    }

    // Transfer CELO from whale to clone
    // await celoToken.connect(whale).transfer(cloneAddress, swapAmount);
    await whale.sendTransaction({
      to: cloneAddress,
      value: swapAmount,
    });

    const cloneCeloBalance = await celoToken.balanceOf(cloneAddress);
    expect(cloneCeloBalance).to.equal(swapAmount);
    console.log("✓ CELO transferred to clone:", ethers.utils.formatEther(swapAmount));

    // Get initial G$ balance
    const initialGdBalance = await gdToken.balanceOf(user.address);
    console.log("Initial G$ balance:", ethers.utils.formatEther(initialGdBalance));

    // Calculate min amount using TWAP
    const [minByTwap] = await clone.minAmountByTWAP(
      swapAmount,
      CELO,
      300 // 5 minutes
    );
    console.log("Min amount by TWAP:", ethers.utils.formatEther(minByTwap));

    // Perform swap - minTwap is already 98% of quote
    const minAmount = minByTwap;
    console.log("Using minAmount:", ethers.utils.formatEther(minAmount));

    const swapTx = await clone.swap(minAmount, user.address);
    const swapReceipt = await swapTx.wait();

    // Check for Bought event
    const boughtEvent = swapReceipt.events?.find(
      (e: any) => e.event === "Bought"
    );
    expect(boughtEvent).to.not.be.undefined;
    console.log("✓ Bought event emitted:", {
      inToken: boughtEvent?.args?.inToken,
      inAmount: ethers.utils.formatEther(boughtEvent?.args?.inAmount),
      outAmount: ethers.utils.formatEther(boughtEvent?.args?.outAmount),
    });

    // Check final G$ balance
    const finalGdBalance = await gdToken.balanceOf(user.address);
    const gdReceived = finalGdBalance.sub(initialGdBalance);
    expect(gdReceived).to.be.gt(0);
    console.log("✓ G$ received:", ethers.utils.formatEther(gdReceived));
    console.log("Final G$ balance:", ethers.utils.formatEther(finalGdBalance));

      // Verify minimum amount
      expect(gdReceived).to.be.gte(minAmount);
      console.log("✓ Received amount >= minAmount");
    });
  });

  describe("TWAP and Price Comparison Tests", function () {
    it("Should compare TWAP quote vs actual pool price", async function () {
      const { factory, user, router } = await loadFixture(forkCelo);

      // Create clone
      await factory.create(user.address);
      const cloneAddress = await factory.predict(user.address);
      const clone = (await ethers.getContractAt(
        "BuyGDCloneV2",
        cloneAddress
      )) as BuyGDCloneV2;

      const testAmount = ethers.utils.parseEther("10"); // 10 cUSD
      const stableAddress = await clone.stable();
      const gdAddress = await clone.gd();

      // Get TWAP quote from oracle
      const [minTwap, twapQuote] = await clone.minAmountByTWAP(
        testAmount,
        CUSD,
        300 // 5 minutes
      );

      console.log("TWAP Oracle Quote:");
      console.log("  Input:", ethers.utils.formatEther(testAmount), "cUSD");
      console.log("  Min TWAP (98%):", ethers.utils.formatEther(minTwap), "G$");
      console.log("  TWAP Quote:", ethers.utils.formatEther(twapQuote), "G$");

      // Get actual pool price using QuoterV2
      const quoter = await ethers.getContractAt("contracts/Interfaces.sol:IQuoterV2", QUOTE);

      // Build path: CUSD -> stable -> G$ (using same encoding as contract)
      let path: string;
      if (stableAddress.toLowerCase() === CUSD.toLowerCase()) {
        path = ethers.utils.solidityPack(
          ["address", "uint24", "address"],
          [CUSD, 500, gdAddress] // GD_FEE_TIER = 500
        );
      } else {
        path = ethers.utils.solidityPack(
          ["address", "uint24", "address", "uint24", "address"],
          [CUSD, 100, stableAddress, 500, gdAddress] // 100 for CUSD->stable, 500 for stable->G$
        );
      }

      // Get quote from actual pool
      const [actualAmountOut] = await quoter.callStatic.quoteExactInput(path, testAmount);
      const actualPrice = actualAmountOut;

      console.log("Actual Pool Price:");
      console.log("  Input:", ethers.utils.formatEther(testAmount), "cUSD");
      console.log("  Actual Output:", ethers.utils.formatEther(actualPrice), "G$");

      // Compare TWAP vs actual
      const twapVsActual = twapQuote.mul(100).div(actualPrice);
      const minTwapVsActual = minTwap.mul(100).div(actualPrice);

      console.log("Comparison:");
      console.log("  TWAP Quote vs Actual:", twapVsActual.toString(), "%");
      console.log("  Min TWAP vs Actual:", minTwapVsActual.toString(), "%");

      // Min TWAP should be less than or equal to actual
      // But allow some tolerance for price movement
      expect(minTwap).to.be.lte(actualPrice);
      expect(minTwap).to.be.gte(actualPrice.mul(98).div(100));

      console.log("✓ TWAP quote comparison completed");
    });

    it("Should revert when minAmount is more than quote", async function () {
      const { factory, user, cusdToken, whale } = await loadFixture(forkCelo);

      // Create clone
      await factory.create(user.address);
      const cloneAddress = await factory.predict(user.address);
      const clone = (await ethers.getContractAt(
        "BuyGDCloneV2",
        cloneAddress
      )) as BuyGDCloneV2;

      // Transfer cUSD to clone
      const swapAmount = ethers.utils.parseEther("5");
      const whaleBalance = await cusdToken.balanceOf(whale.address);

      if (whaleBalance.lt(swapAmount)) {
        throw new Error(`Whale doesn't have enough cUSD. Balance: ${ethers.utils.formatEther(whaleBalance)}, Required: ${ethers.utils.formatEther(swapAmount)}`);
      }

      await cusdToken.connect(whale).transfer(cloneAddress, swapAmount);

      // Get TWAP quote
      const [, twapQuote] = await clone.minAmountByTWAP(
        swapAmount,
        CUSD,
        300
      );

      console.log("TWAP values:");
      console.log("  TWAP Quote:", ethers.utils.formatEther(twapQuote), "G$");
      
      // Use minAmount = 102% of quote
      const excessiveMinAmount = twapQuote.mul(102).div(100);
      console.log("Using excessive minAmount (102% of quote):", ethers.utils.formatEther(excessiveMinAmount));

      // The swap should revert because excessiveMinAmount > actual pool output
      // The contract enforces: amountOutMinimum = excessiveMinAmount
      // But the pool likely can't provide that much due to slippage/price impact
      await expect(
        clone.swap(excessiveMinAmount, user.address)
      ).to.be.reverted; // Should revert with Uniswap "STF" (insufficient output amount) or similar

      console.log("✓ Swap correctly reverts when minAmount = 102% of TWAP quote");
    });
  });

  describe("Factory Helper Functions", function () {
    it("Should handle createAndSwap in one transaction", async function () {
      const { factory, user, deployer, gdToken, cusdToken, whale } = await loadFixture(
        forkCelo
      );

      const swapAmount = ethers.utils.parseEther("5");
      const whaleBalance = await cusdToken.balanceOf(whale.address);

      if (whaleBalance.lt(swapAmount)) {
        throw new Error(`Whale doesn't have enough cUSD. Balance: ${ethers.utils.formatEther(whaleBalance)}, Required: ${ethers.utils.formatEther(swapAmount)}`);
      }

      // Get initial G$ balance
      const initialGdBalance = await gdToken.balanceOf(user.address);

      // Create clone and get address
      await factory.create(deployer.address);
      const cloneAddress = await factory.predict(deployer.address);
      const clone = (await ethers.getContractAt(
        "BuyGDCloneV2",
        cloneAddress
      )) as BuyGDCloneV2;

      // Calculate min amount
      const [minByTwap] = await clone.minAmountByTWAP(
        swapAmount,
        CUSD,
        300
      );
      const minAmount = minByTwap;

      const predictedAddress = await factory.predict(user.address);
      cusdToken.connect(whale).transfer(predictedAddress, swapAmount);
      // Use createAndSwap
      await cusdToken.connect(user).approve(factory.address, swapAmount);
      const tx = await factory.connect(user).createAndSwap(user.address, minAmount);
      const receipt = await tx.wait();

      // Check final balance
      const finalGdBalance = await gdToken.balanceOf(user.address);
      const gdReceived = finalGdBalance.sub(initialGdBalance);

      expect(gdReceived).to.be.gte(minAmount);
      console.log("✓ createAndSwap successful, G$ received:", ethers.utils.formatEther(gdReceived));
    });
  });
});

