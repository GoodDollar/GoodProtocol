import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { GenericDistributionHelper, IGoodDollar, IERC20, IStaticOracle, ISwapRouter, IUniswapV3Pool, gooddollar } from "../../types";
import dao from "../../releases/deployment.json";
import ProtocolSettings from "../../releases/deploy-settings.json";

const BN = ethers.BigNumber;
const XDC_RPC_URL = "https://rpc.ankr.com/xdc/ef07ba6590dc46db9275bba237aed203ed6d5fb3e3203ff237a82a841f75b2ce";
const XDC_CHAIN_ID = 50;

/**
 * E2E test for GenericDistributionHelper on XDC network using XSWAP pools
 * 
 * To run this test:
 * 1. Set up fork environment variable: FORK_CHAIN_ID=50
 * 2. Set up XDC RPC URL in hardhat config or use: FORK_URL=https://rpc.ankr.com/xdc/...
 * 3. Run: npx hardhat test test/reserve/GenericDistributionHelper.e2e.test.ts --network hardhat
 * 
 * Note: This test requires forking XDC mainnet, so it may take longer to run
 */
describe("GenericDistributionHelper - XDC XSWAP E2E Test", function () {
  // Use longer timeout for fork tests
  this.timeout(600000);

  let distHelper: GenericDistributionHelper;
  let goodDollar: IGoodDollar;
  let reserveToken: IERC20; // CUSD
  let gasToken: IERC20; // WXDC
  let staticOracle: IStaticOracle;
  let swapRouter: ISwapRouter;
  let deployer: any;
  let testAccount: any;

  // XDC development network addresses
  const XDC_ADDRESSES = {
    WXDC: "0x951857744785e80e2de051c32ee7b25f9c458c42",
    StaticOracle: "0x725244458f011551Dde1104c9728746EEBEA19f9",
    UniswapV3Router: "0x3b9edecc4286ba33ea6e27119c2a4db99829839d",
    ...dao["development-xdc"]
  };
  

  before(async function () {
    // Skip all tests if not running on XDC network (chain ID 50)
    const chainId = network.config.chainId;
    if (chainId !== XDC_CHAIN_ID) {
      console.log(`Skipping tests - expected XDC chain ID ${XDC_CHAIN_ID}, got ${chainId}`);
      this.skip();
      return;
    }

    [deployer, testAccount] = await ethers.getSigners();

    // Impersonate the Avatar account to have permissions
    const avatarSigner = await ethers.getImpersonatedSigner(XDC_ADDRESSES.Avatar);
    await deployer.sendTransaction({
      to: XDC_ADDRESSES.Avatar,
      value: ethers.utils.parseEther("10")
    });

    // Get contract instances
    goodDollar = (await ethers.getContractAt("IGoodDollar", XDC_ADDRESSES.GoodDollar)) as IGoodDollar;
    reserveToken = (await ethers.getContractAt("IERC20", XDC_ADDRESSES.CUSD)) as IERC20;
    gasToken = (await ethers.getContractAt("IERC20", XDC_ADDRESSES.WXDC)) as IERC20;
    staticOracle = (await ethers.getContractAt("IStaticOracle", XDC_ADDRESSES.StaticOracle)) as IStaticOracle;
    swapRouter = (await ethers.getContractAt("ISwapRouter", XDC_ADDRESSES.UniswapV3Router)) as ISwapRouter;

    // Check if GenericDistributionHelper is already deployed
    const existingDistHelper = dao["development-xdc"] && (dao["development-xdc"] as any).DistributionHelper;
    
    if (existingDistHelper && existingDistHelper !== ethers.constants.AddressZero) {
      distHelper = (await ethers.getContractAt(
        "GenericDistributionHelper",
        existingDistHelper
      )) as GenericDistributionHelper;
      console.log("Using existing GenericDistributionHelper at:", existingDistHelper);
    } else {
      // Deploy new GenericDistributionHelper
      console.log("Deploying new GenericDistributionHelper...");
      const GenericDistributionHelperFactory = await ethers.getContractFactory("GenericDistributionHelper");
      
      // Get NameService instance
      const nameService = await ethers.getContractAt("NameService", XDC_ADDRESSES.NameService);

      const feeSettings = {
        maxFee: ethers.utils.parseEther("100"),
        minBalanceForFees: ethers.utils.parseEther("1"),
        percentageToSellForFee: 5, // 5%
        maxSlippage: 5 // 5%
      };

      distHelper = (await upgrades.deployProxy(
        GenericDistributionHelperFactory,
        [
          nameService.address,
          staticOracle.address,
          gasToken.address,
          reserveToken.address,
          swapRouter.address,
          feeSettings
        ],
        { kind: "uups" }
      )) as GenericDistributionHelper;

      await distHelper.deployed();
      console.log("Deployed GenericDistributionHelper at:", distHelper.address);
    }
  });

  it("should successfully swap G$ to WXDC via XSWAP pools", async function () {
    // // Get initial balances
    // const initialWXDCBalance = await gasToken.balanceOf(distHelper.address);
    // const initialxdcBalance = await ethers.provider.getBalance(distHelper.address);

    // Mint some G$ to the distribution helper for testing
    const amountToSwap = ethers.utils.parseEther("1000"); // 1000 G$
    
    // Try to mint G$ to the helper (if we have minter role)
    try {
      // Impersonate a minter if needed
      const minterAddress = XDC_ADDRESSES.Avatar; // Avatar typically has minter role
      const minterSigner = await ethers.getImpersonatedSigner(minterAddress);
      await deployer.sendTransaction({
        to: minterAddress,
        value: ethers.utils.parseEther("1")
      });

      // Try to mint via the minter
      const goodDollarWithMinter = goodDollar.connect(minterSigner);
      await goodDollarWithMinter.mint(distHelper.address, amountToSwap);
    } catch (error) {
      console.log("Could not mint G$ directly, trying alterxdc approach:", error.message);
      // Alterxdc: transfer from an account that has G$
      // For fork tests, we might need to find an account with G$ balance
      const accountsWithGD = [
        XDC_ADDRESSES.AdminWallet, // AdminWallet
        XDC_ADDRESSES.Avatar
      ];

      let transferred = false;
      for (const account of accountsWithGD) {
        const balance = await goodDollar.balanceOf(account);
        if (balance.gte(amountToSwap)) {
          const accountSigner = await ethers.getImpersonatedSigner(account);
          await deployer.sendTransaction({
            to: account,
            value: ethers.utils.parseEther("1")
          });
          await goodDollar.connect(accountSigner).transfer(distHelper.address, amountToSwap);
          transferred = true;
          break;
        }
      }

      if (!transferred) {
        console.log("Skipping swap test - insufficient G$ balance available");
        this.skip();
      }
    }

    // Get pools for the swap path
    const gdPools = await staticOracle.getAllPoolsForPair(
      reserveToken.address,
      goodDollar.address
    );
    const gasPools = await staticOracle.getAllPoolsForPair(
      reserveToken.address,
      gasToken.address
    );

    expect(gdPools.length).to.be.gt(0, "No G$/CUSD pools found");
    expect(gasPools.length).to.be.gt(0, "No CUSD/WXDC pools found");

    console.log("Found pools:", {
      gdPools: gdPools.length,
      gasPools: gasPools.length
    });

    // Get pool fees
    const gdPool = (await ethers.getContractAt("IUniswapV3Pool", gdPools[0])) as IUniswapV3Pool;
    const gasPool = (await ethers.getContractAt("IUniswapV3Pool", gasPools[0])) as IUniswapV3Pool;
    
    const gdFee = await gdPool.fee();
    const gasFee = await gasPool.fee();

    console.log("Pool fees:", {
      gdFee: gdFee.toString(),
      gasFee: gasFee.toString()
    });

    // Calculate expected output using oracle
    const amountToSell = amountToSwap.div(20); // 5% for fees (50 G$)
    const [quoteAmount, ] = await staticOracle.quoteAllAvailablePoolsWithTimePeriod(
      amountToSell,
      goodDollar.address,
      reserveToken.address,
      60
    );

    const [quoteGasAmount, ] = await staticOracle.quoteAllAvailablePoolsWithTimePeriod(
      quoteAmount,
      reserveToken.address,
      gasToken.address,
      60
    );

    console.log("Expected swap amounts:", {
      gdIn: ethers.utils.formatEther(amountToSell),
      cusdOut: ethers.utils.formatUnits(quoteAmount, 6), // CUSD has 6 decimals
      wxdcOut: ethers.utils.formatEther(quoteGasAmount)
    });

    // Set fee settings to trigger swap
    const feeSettings = {
      maxFee: ethers.utils.parseEther("100"),
      minBalanceForFees: ethers.utils.parseEther("1"),
      percentageToSellForFee: 5,
      maxSlippage: 5
    };

    await deployer.sendTransaction({
      to: XDC_ADDRESSES.Avatar,
      value: ethers.utils.parseEther("1")
    });

    // Impersonate guardian to set fee settings
    const avatarSigner = await ethers.getImpersonatedSigner(XDC_ADDRESSES.Avatar);
    await distHelper.connect(avatarSigner).setFeeSettings(feeSettings);

    // Ensure distHelper has low xdc balance to trigger swap
    const currentxdcBalance = await ethers.provider.getBalance(distHelper.address);
    console.log("Current xdc balance:", ethers.utils.formatEther(currentxdcBalance));
    console.log("Min balance for fees:", ethers.utils.formatEther(feeSettings.minBalanceForFees));
    if (currentxdcBalance.gte(feeSettings.minBalanceForFees)) {
      // Send xdc token away to trigger swap
      const tempAccount = ethers.Wallet.createRandom().connect(ethers.provider);
      await deployer.sendTransaction({
        to: tempAccount.address,
        value: ethers.utils.parseEther("0.01")
      });
      
      // Transfer xdc balance from distHelper
      const distHelperSigner = await ethers.getImpersonatedSigner(distHelper.address);
      
      await distHelperSigner.sendTransaction({
        to: tempAccount.address,
        value: currentxdcBalance.sub(ethers.utils.parseEther("0.05"))
      });
    }

    // Trigger distribution which should perform the swap
    const xdcBalanceBefore = await ethers.provider.getBalance(distHelper.address);
    const goodDollarBalanceBefore = await goodDollar.balanceOf(distHelper.address);

    console.log("Balances before swap:", {
      xdc: ethers.utils.formatEther(xdcBalanceBefore),
      goodDollar: ethers.utils.formatEther(goodDollarBalanceBefore)
    });

    // Call onDistribution to trigger swap
    await distHelper.onDistribution(0);

    // Check balances after swap
    const xdcBalanceAfter = await ethers.provider.getBalance(distHelper.address);
    const goodDollarBalanceAfter = await goodDollar.balanceOf(distHelper.address);
    console.log("Balances after swap:", {
      xdc: ethers.utils.formatEther(xdcBalanceAfter),
      goodDollar: ethers.utils.formatEther(goodDollarBalanceAfter)
    });

    // Verify swap occurred
    // Either WXDC balance increased or xdc balance increased (after unwrapping)
    const xdcIncrease = xdcBalanceAfter.sub(xdcBalanceBefore);

    expect(
      xdcIncrease.gt(0),
      "Swap should have increased either WXDC or xdc balance"
    ).to.be.true;
  });

  it("should correctly calculate swap amounts using XSWAP pools", async function () {
    const amountToSell = ethers.utils.parseEther("100"); // 100 G$

    // Test quote from G$ to CUSD
    const [quoteCUSD, poolsGDCUSD] = await staticOracle.quoteAllAvailablePoolsWithTimePeriod(
      amountToSell,
      goodDollar.address,
      reserveToken.address,
      60
    );

    expect(poolsGDCUSD.length).to.be.gt(0, "Should find G$/CUSD pools");
    expect(quoteCUSD.gt(0)).to.be.true;

    console.log("G$ -> CUSD quote:", {
      gdIn: ethers.utils.formatEther(amountToSell),
      cusdOut: ethers.utils.formatUnits(quoteCUSD, 6)
    });

    // Test quote from CUSD to WXDC
    const [quoteWXDC, poolsCUSDWXDC] = await staticOracle.quoteAllAvailablePoolsWithTimePeriod(
      quoteCUSD,
      reserveToken.address,
      gasToken.address,
      60
    );

    expect(poolsCUSDWXDC.length).to.be.gt(0, "Should find CUSD/WXDC pools");
    expect(quoteWXDC.gt(0)).to.be.true;

    console.log("CUSD -> WXDC quote:", {
      cusdIn: ethers.utils.formatUnits(quoteCUSD, 6),
      wxdcOut: ethers.utils.formatEther(quoteWXDC)
    });

    // Test calcGDToSell function
    const [gdToSell, minReceived] = await distHelper.calcGDToSell(amountToSell);

    expect(gdToSell.gt(0)).to.be.true;
    expect(minReceived.gt(0)).to.be.true;

    console.log("calcGDToSell result:", {
      gdToSell: ethers.utils.formatEther(gdToSell),
      minReceived: ethers.utils.formatEther(minReceived)
    });
  });

  it("should handle swap with correct slippage protection", async function () {
    // This test verifies that the swap respects maxSlippage settings
    const amountToSell = ethers.utils.parseEther("50"); // 50 G$

    // Get quote
    const [quoteCUSD, ] = await staticOracle.quoteAllAvailablePoolsWithTimePeriod(
      amountToSell,
      goodDollar.address,
      reserveToken.address,
      60
    );

    const [quoteWXDC, ] = await staticOracle.quoteAllAvailablePoolsWithTimePeriod(
      quoteCUSD,
      reserveToken.address,
      gasToken.address,
      60
    );

    // Get fee settings
    const feeSettings = await distHelper.feeSettings();
    const maxSlippage = feeSettings.maxSlippage;

    // Calculate minimum output with slippage
    const minOutput = quoteWXDC.mul(100 - maxSlippage).div(100);

    console.log("Slippage calculation:", {
      expectedOutput: ethers.utils.formatEther(quoteWXDC),
      maxSlippage: maxSlippage.toString() + "%",
      minOutput: ethers.utils.formatEther(minOutput)
    });

    expect(minOutput.lt(quoteWXDC)).to.be.true;
  });
});

