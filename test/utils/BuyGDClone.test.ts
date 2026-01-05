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

import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BuyGDCloneV2, BuyGDCloneFactory } from "../../types";
import deployments from "../../releases/deployment.json";

// Celo mainnet addresses
const CELO_MAINNET_RPC = "https://forno.celo.org";
const CELO_CHAIN_ID = 42220;

// Production Celo addresses from deployment.json (used for existing contracts on fork)
const PRODUCTION_CELO = deployments["production-celo"];
const GOODDOLLAR = PRODUCTION_CELO.GoodDollar;
const CUSD = PRODUCTION_CELO.CUSD;
const UNISWAP_V3_ROUTER = PRODUCTION_CELO.UniswapV3Router;
const STATIC_ORACLE = PRODUCTION_CELO.StaticOracle;

// GLOUSD address on Celo mainnet
// Note: The actual stable token address will be read from the factory contract
// This is just a reference - the test will use the factory's stable token address
const GLOUSD_REFERENCE = "0x4F604735c1cF31399C6E711D5962b2B3E0225AD3"; // Common GLOUSD address

// Account with cUSD balance on Celo (for impersonation)
const CUSD_WHALE = "0xCA31c88C2061243D70eb3a754E5D99817a311270"; // Example whale address

describe("BuyGDClone - Celo Fork E2E", function () {
  // Increase timeout for fork tests
  this.timeout(600000);

  // Set up fork once before all tests
  before(async function () {
    const network = await ethers.provider.getNetwork();
    if (network.chainId !== CELO_CHAIN_ID) {
      // Fork Celo mainnet - don't specify blockNumber to use latest
      await ethers.provider.send("hardhat_reset", [
        {
          forking: {
            jsonRpcUrl: CELO_MAINNET_RPC,
            // Omit blockNumber to use latest block
          },
        },
      ]);
      // Verify the fork was successful by checking chain ID
      const newNetwork = await ethers.provider.getNetwork();
      if (newNetwork.chainId !== CELO_CHAIN_ID) {
        this.skip();      
      }
    }
  });

  async function forkCelo() {
    // Verify we're on the correct chain
    const network = await ethers.provider.getNetwork();
    if (network.chainId !== CELO_CHAIN_ID) {
      throw new Error(`Expected chain ID ${CELO_CHAIN_ID}, got ${network.chainId}`);
    }

    const [deployer, user] = await ethers.getSigners();

    // Get existing contracts from Celo (for router, oracle, tokens)
    // Note: We use the deployed addresses but will deploy our own factory
    const router = await ethers.getContractAt("contracts/Interfaces.sol:ISwapRouter", UNISWAP_V3_ROUTER);
    // IStaticOracle is from @mean-finance package, we'll use the address directly
    const oracleAddress = STATIC_ORACLE;
    const gdToken = await ethers.getContractAt("contracts/Interfaces.sol:ERC20", GOODDOLLAR);
    const cusdToken = await ethers.getContractAt("contracts/Interfaces.sol:ERC20", CUSD);

    // Use GLOUSD as the stable token (update this address if needed)
    // For now, we'll use a known GLOUSD address or you can set it via environment variable
    const stableAddress = process.env.GLOUSD_ADDRESS || GLOUSD_REFERENCE;
    console.log("Using stable token (GLOUSD):", stableAddress);

    const [signer] = await ethers.getSigners();
    // Deploy BuyGDCloneFactory
    const BuyGDCloneFactoryFactory = await ethers.getContractFactory("BuyGDCloneFactory");
    const factory = (await BuyGDCloneFactoryFactory.deploy(
      router.address,
      stableAddress,
      GOODDOLLAR,
      oracleAddress
    )) as BuyGDCloneFactory;

    await factory.deployed();
    console.log("✓ BuyGDCloneFactory deployed at:", factory.address);

    // Verify the stable token in the factory
    const factoryStable = await factory.stable();
    expect(factoryStable.toLowerCase()).to.equal(stableAddress.toLowerCase());
    console.log("✓ Factory stable token verified:", factoryStable);

    // Impersonate a whale account to get cUSD
    await ethers.provider.send("hardhat_impersonateAccount", [CUSD_WHALE]);
    const whale = await ethers.getSigner(CUSD_WHALE);
    await ethers.provider.send("hardhat_setBalance", [
      CUSD_WHALE,
      "0x1000000000000000000", // 1 CELO for gas
    ]);

    return {
      deployer,
      user,
      factory,
      gdToken,
      cusdToken,
      stableAddress,
      whale,
      router,
      oracleAddress,
    };
  }

  it("Should create a clone for a user", async function () {
    const { factory, user } = await loadFixture(forkCelo);    

    const predictedAddress = await factory.predict(user.address);
    console.log("Predicted clone address:", predictedAddress);

    const tx = await factory.create(user.address);
    const receipt = await tx.wait();

    const cloneAddress = await factory.predict(user.address);
    expect(cloneAddress).to.equal(predictedAddress);

    const clone = (await ethers.getContractAt(
      "BuyGDCloneV2",
      cloneAddress
    )) as BuyGDCloneV2;

    const owner = await clone.owner();
    expect(owner).to.equal(user.address);

    console.log("✓ Clone created successfully at:", cloneAddress);
  });

  it("Should swap cUSD -> GLOUSD -> G$ via clone", async function () {
    const { factory, user, gdToken, cusdToken, stableAddress, whale } =
      await loadFixture(forkCelo);

    // Create clone
    const cloneAddress = await factory.callStatic.create(user.address);
    await factory.create(user.address);
    const clone = (await ethers.getContractAt(
      "BuyGDCloneV2",
      cloneAddress
    )) as BuyGDCloneV2;

    // Check stable token
    const stable = await clone.stable();
    console.log("Stable token in clone:", stable);
    expect(stable).to.equal(stableAddress);

    // Transfer cUSD to clone (simulating onramp service)
    const swapAmount = ethers.utils.parseEther("10");
    const whaleBalance = await cusdToken.balanceOf(whale.address);

    if (whaleBalance.lt(swapAmount)) {
      console.log("⚠ Whale doesn't have enough cUSD, skipping test");
      this.skip();
      return;
    }

    // Transfer cUSD from whale to clone
    await cusdToken.connect(whale).transfer(cloneAddress, swapAmount);

    const cloneCusdBalance = await cusdToken.balanceOf(cloneAddress);
    expect(cloneCusdBalance).to.equal(swapAmount);
    console.log("✓ cUSD transferred to clone:", ethers.utils.formatEther(swapAmount));

    // Get initial G$ balance
    const initialGdBalance = await gdToken.balanceOf(user.address);
    console.log("Initial G$ balance:", ethers.utils.formatEther(initialGdBalance));

    // Calculate min amount using TWAP
    const [minByTwap] = await clone.minAmountByTWAP(
      swapAmount,
      CUSD,
      300 // 5 minutes
    );
    console.log("Min amount by TWAP:", ethers.utils.formatEther(minByTwap));

    // Perform swap
    const minAmount = minByTwap.mul(95).div(100); // 95% of TWAP for safety
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

  it("Should verify swap path: cUSD -> stable -> G$", async function () {
    const { factory, user, stableAddress } = await loadFixture(forkCelo);

    // Create clone
    await factory.create(user.address);
    const cloneAddress = await factory.predict(user.address);
    const clone = (await ethers.getContractAt(
      "BuyGDCloneV2",
      cloneAddress
    )) as BuyGDCloneV2;

    const stable = await clone.stable();
    const gd = await clone.gd();
    const cusd = await clone.CUSD();

    console.log("Swap path verification:");
    console.log("  Input: cUSD", cusd);
    console.log("  Intermediate: stable", stable);
    console.log("  Output: G$", gd);

    // Verify the path
    expect(stable).to.equal(stableAddress);
    expect(gd).to.equal(GOODDOLLAR);
    expect(cusd).to.equal(CUSD);

    // If stable is not CUSD, verify it's a two-hop path
    if (stable.toLowerCase() !== CUSD.toLowerCase()) {
      console.log("✓ Two-hop path confirmed: cUSD -> stable -> G$");
    } else {
      console.log("✓ Direct path: cUSD -> G$");
    }
  });

  it("Should calculate TWAP correctly for cUSD -> stable -> G$", async function () {
    const { factory, user, stableAddress } = await loadFixture(forkCelo);

    // Create clone
    await factory.create(user.address);
    const cloneAddress = await factory.predict(user.address);
    const clone = (await ethers.getContractAt(
      "BuyGDCloneV2",
      cloneAddress
    )) as BuyGDCloneV2;

    const testAmount = ethers.utils.parseEther("1"); // 1 cUSD

    // Calculate TWAP
    const [minTwap, quote] = await clone.minAmountByTWAP(
      testAmount,
      CUSD,
      300 // 5 minutes
    );

    console.log("TWAP calculation:");
    console.log("  Input amount:", ethers.utils.formatEther(testAmount), "cUSD");
    console.log("  Min TWAP:", ethers.utils.formatEther(minTwap), "G$");
    console.log("  Quote:", ethers.utils.formatEther(quote), "G$");

    expect(minTwap).to.be.gt(0);
    expect(quote).to.be.gt(0);
    expect(minTwap).to.be.lte(quote); // minTwap should be <= quote (with 2% buffer)

    // Verify minTwap is 98% of quote (as per contract logic)
    const expectedMin = quote.mul(98).div(100);
    expect(minTwap).to.equal(expectedMin);
    console.log("✓ TWAP calculation is correct");
  });

  it("Should handle createAndSwap in one transaction", async function () {
    const { factory, user, deployer, gdToken, cusdToken, whale } = await loadFixture(
      forkCelo
    );

    const swapAmount = ethers.utils.parseEther("10");
    const whaleBalance = await cusdToken.balanceOf(whale.address);

    if (whaleBalance.lt(swapAmount)) {
      console.log("⚠ Whale doesn't have enough cUSD, skipping test");
      this.skip();
      return;
    }
    cusdToken.connect(whale).transfer(user.address, swapAmount);

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
    const minAmount = minByTwap.mul(95).div(100);

    // Use createAndSwap
    await cusdToken.connect(user).approve(factory.address, swapAmount);
    const tx = await factory.connect(user).createAndSwap(user.address, minAmount, swapAmount);
    const receipt = await tx.wait();

    // Check final balance
    const finalGdBalance = await gdToken.balanceOf(user.address);
    const gdReceived = finalGdBalance.sub(initialGdBalance);

    expect(gdReceived).to.be.gt(0);
    console.log("✓ createAndSwap successful, G$ received:", ethers.utils.formatEther(gdReceived));
  });
});

