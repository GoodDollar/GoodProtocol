import { network, ethers, upgrades, run } from "hardhat";
import ProtocolSettings from "../../releases/deploy-settings.json";
import dao from "../../releases/deployment.json";
import { defaultsDeep } from "lodash";

import { IUniswapV3Factory, IUniswapV3Pool, INonfungiblePositionManager, IERC20 } from "../../types";
const V3Factory = "0x30f317a9ec0f0d06d5de0f8d248ec3506b7e4a8a";
const NFPM = "0x6d22833398772d7da9a7cbcfdee98342cce154d4";
const STABLE_DECIMALS = 6; //USDC
const GASPRICE_STABLE = 0.08;
const POOL_FEE = 100; // 0.01%
const main = async () => {
  let protocolSettings = defaultsDeep({}, ProtocolSettings[network.name], ProtocolSettings["default"]);
  let release: { [key: string]: any } = dao[network.name];
  let [root] = await ethers.getSigners();
  console.log("got signers:", {
    root: root.address,
    balance: await ethers.provider.getBalance(root.address).then(_ => _.toString())
  });

  const v3Factory = (await ethers.getContractAt("IUniswapV3Factory", V3Factory)) as IUniswapV3Factory;
  const nfpm = (await ethers.getContractAt("INonfungiblePositionManager", NFPM)) as INonfungiblePositionManager;

  // create G$<>Stable pool
  console.log("creating G$<>Stable pool", {
    gd: release.GoodDollar,
    stable: protocolSettings.reserve.reserveToken,
    fee: POOL_FEE
  });
  const poolExists = await v3Factory.getPool(protocolSettings.reserve.reserveToken, release.GoodDollar, POOL_FEE);
  if (poolExists !== ethers.constants.AddressZero) {
    console.log("pool already exists at:", poolExists);
  } else {
    await (
      await v3Factory.createPool(protocolSettings.reserve.reserveToken, release.GoodDollar, POOL_FEE, {
        gasLimit: 5000000
      })
    ).wait();
  }
  const gdstablePool = (await ethers.getContractAt(
    "IUniswapV3Pool",
    await v3Factory.getPool(release.GoodDollar, protocolSettings.reserve.reserveToken, POOL_FEE)
  )) as IUniswapV3Pool;

  //get pool price
  const { sqrtPriceX96 } = await gdstablePool.slot0();

  const existingPrice = (Number(sqrtPriceX96.toString()) / 2 ** 96) ** 2;
  console.log("created pool at:", gdstablePool.address, { existingPrice });
  let price = BigInt(Math.sqrt(10000 * (10 ** (18 - STABLE_DECIMALS))) * 2 ** 96); //1 G$ = 0.0001 Stable
  let amount1 = ethers.utils.parseUnits("50000", 18);
  let amount0 = ethers.utils.parseUnits("5", STABLE_DECIMALS);

  if ((await gdstablePool.token0()).toLowerCase() === release.GoodDollar.toLowerCase()) {
    price = BigInt(Math.sqrt(0.0001 * (10 ** (STABLE_DECIMALS - 18))) * 2 ** 96);
    amount0 = ethers.utils.parseUnits("50000", 18);
    amount1 = ethers.utils.parseUnits("5", STABLE_DECIMALS);
  }

  if (existingPrice > 0) {
    console.log("pool already initialized");
    price = BigInt(Math.sqrt(existingPrice) * 2 ** 96); //1 G$ = 0.0001 Stable
  } else {
    await (await gdstablePool.initialize(price)).wait();
    console.log("initialized pool with price:", price.toString(), { amount0, amount1 });
  }

  // print allowance for nfpm
  const stable = (await ethers.getContractAt("IERC20", protocolSettings.reserve.reserveToken)) as IERC20;
  const gd = (await ethers.getContractAt("IERC20", release.GoodDollar)) as IERC20;
  let stableAllowance = await stable.allowance(root.address, NFPM);
  const gdAllowance = await gd.allowance(root.address, NFPM);
  console.log("stable allowance for NFPM:", ethers.utils.formatUnits(stableAllowance, STABLE_DECIMALS));
  console.log("G$ allowance for NFPM:", ethers.utils.formatUnits(gdAllowance, 18));

  await (
    await nfpm.mint({
      token0: await gdstablePool.token0(),
      token1: await gdstablePool.token1(),
      fee: POOL_FEE,
      tickLower: -887220,
      tickUpper: 887220,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: amount0.mul(8).div(10),
      amount1Min: amount1.mul(8).div(10),
      recipient: root.address,
      deadline: Math.floor(Date.now() / 1000) + 60 * 10
    })
  ).wait();

  console.log("creating gastoken<>Stable pool", {
    gasToken: protocolSettings.reserve.gasToken,
    stable: protocolSettings.reserve.reserveToken,
    fee: POOL_FEE
  });
  const gaspoolExists = await v3Factory.getPool(
    protocolSettings.reserve.gasToken,
    protocolSettings.reserve.reserveToken,
    POOL_FEE
  );
  if (gaspoolExists !== ethers.constants.AddressZero) {
    console.log("pool already exists at:", gaspoolExists);
  } else {
    await (
      await v3Factory.createPool(protocolSettings.reserve.gasToken, protocolSettings.reserve.reserveToken, POOL_FEE, {
        gasLimit: 5000000
      })
    ).wait();
  }
  const gasstablePool = (await ethers.getContractAt(
    "IUniswapV3Pool",
    await v3Factory.getPool(protocolSettings.reserve.gasToken, protocolSettings.reserve.reserveToken, POOL_FEE)
  )) as IUniswapV3Pool;

  //get pool price
  const { sqrtPriceX96: gasSqrtPriceX96 } = await gasstablePool.slot0();

  const gasexistingPrice = (Number(gasSqrtPriceX96.toString()) / 2 ** 96) ** 2;
  console.log("created pool at:", gasstablePool.address, { gasexistingPrice });
  price = BigInt(Math.sqrt(GASPRICE_STABLE * (10 ** (18 - STABLE_DECIMALS))) * 2 ** 96); //1 G$ = 0.0001 Stable
  amount1 = ethers.utils.parseUnits((5 / GASPRICE_STABLE).toString(), 18);
  amount0 = ethers.utils.parseUnits("5", STABLE_DECIMALS);

  if ((await gasstablePool.token0()).toLowerCase() === protocolSettings.reserve.gasToken.toLowerCase()) {
    price = BigInt(Math.sqrt(1 / GASPRICE_STABLE / (10 ** (18 - STABLE_DECIMALS))) * 2 ** 96);
    let temp = amount0;
    amount0 = amount1;
    amount1 = temp;
  }

  if (gasexistingPrice > 0) {
    console.log("pool already initialized");
    price = BigInt(Math.sqrt(gasexistingPrice) * 2 ** 96); //1 G$ = 0.0001 Stable
  } else {
    await (await gasstablePool.initialize(price)).wait();
    console.log("initialized pool with price:", price.toString(), { amount0, amount1 });
  }

  // print allowance for nfpm
  const gasToken = (await ethers.getContractAt("IERC20", protocolSettings.reserve.gasToken)) as IERC20;
  stableAllowance = await stable.allowance(root.address, NFPM);
  const gasAllowance = await gasToken.allowance(root.address, NFPM);
  console.log("stable allowance for NFPM:", ethers.utils.formatUnits(stableAllowance, STABLE_DECIMALS));
  console.log("weth allowance for NFPM:", ethers.utils.formatUnits(gasAllowance, 18));

  await (
    await nfpm.mint({
      token0: await gasstablePool.token0(),
      token1: await gasstablePool.token1(),
      fee: POOL_FEE,
      tickLower: -887220,
      tickUpper: 887220,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: amount0.mul(8).div(10),
      amount1Min: amount1.mul(8).div(10),
      recipient: root.address,
      deadline: Math.floor(Date.now() / 1000) + 60 * 10
    })
  ).wait();
};
main();
