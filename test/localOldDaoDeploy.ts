/***
 * deploy complete DAO for testing purposes.
 * for example run:
 * npx hardhat run scripts/test/localDaoDeploy.ts  --network develop
 * then to test upgrade process locally run:
 * npx hardhat run scripts/upgradeToV2/upgradeToV2.ts  --network develop
 */
import { network, ethers, upgrades } from "hardhat";
import { Contract } from "ethers";
import DAOCreatorABI from "@gooddollar/goodcontracts/build/contracts/DaoCreatorGoodDollar.json";
import IdentityABI from "@gooddollar/goodcontracts/build/contracts/Identity.json";
import FeeFormulaABI from "@gooddollar/goodcontracts/build/contracts/FeeFormula.json";
import AddFoundersABI from "@gooddollar/goodcontracts/build/contracts/AddFoundersGoodDollar.json";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import FirstClaimPool from "@gooddollar/goodcontracts/stakingModel/build/contracts/FirstClaimPool.json";
import UBIScheme from "@gooddollar/goodcontracts/stakingModel/build/contracts/UBIScheme.json";
import SchemeRegistrar from "@gooddollar/goodcontracts/build/contracts/SchemeRegistrar.json";
import AbsoluteVote from "@gooddollar/goodcontracts/build/contracts/AbsoluteVote.json";
import UpgradeScheme from "@gooddollar/goodcontracts/build/contracts/UpgradeScheme.json";
import GoodReserveCDai from "@gooddollar/goodcontracts/stakingModel/build/contracts/GoodReserveCDai.json";
import MarketMaker from "@gooddollar/goodcontracts/stakingModel/build/contracts/GoodMarketMaker.json";
import FundManager from "@gooddollar/goodcontracts/stakingModel/build/contracts/GoodFundManager.json";
import SimpleDAIStaking from "@gooddollar/goodcontracts/stakingModel/build/contracts/SimpleDAIStaking.json";
import BridgeMock from "@gooddollar/goodcontracts/stakingModel/build/contracts/BridgeMock.json";
import DonationsStaking from "@gooddollar/goodcontracts/upgradables/build/contracts/DonationsStaking.json";
import AdminWalletABI from "@gooddollar/goodcontracts/build/contracts/AdminWallet.json";

import releaser from "../scripts/releaser";
import { increaseTime, deployUniswap } from "../test/helpers";
import ProtocolSettings from "../releases/deploy-settings.json";

const { name } = network;

const printDeploy = (c: Contract): Contract => {
  console.log("deployed to: ", c.address);
  return c;
};
export const deploy = async (networkName = name, single = false) => {
  console.log("dao deploying...");
  //TODO: modify to deploy old DAO contracts version ie Reserve to truly simulate old DAO
  const dao = await createOldDAO(null, null, null);
  console.log("dao deployed");
  const ubi = await deployUBI(dao);
  console.log("ubi deployed");
  const gov = await deployOldVoting(dao);
  console.log("old vote deployed");
  const signers = await ethers.getSigners();
  const adminWallet = await new ethers.ContractFactory(
    AdminWalletABI.abi,
    AdminWalletABI.bytecode,
    signers[0]
  ).deploy(
    signers.slice(0, 10).map((_) => _.address),
    ethers.utils.parseUnits("1000000", "gwei"),
    4,
    dao.identity
  );

  const {
    uniswap,
    daiUsdOracle,
    compUsdOracle,
    usdcUsdOracle,
    aaveUsdOracle,
    daiethOracle,
    gasOracle,
    ethusdOracle,
    usdc,
    lendingPool,
    incentiveController,
  } = await deploy3rdParty(dao);

  const release = {
    Reserve: dao.reserve.address,
    GoodDollar: dao.gd,
    Identity: dao.identity,
    Avatar: dao.avatar,
    Controller: dao.controller,
    AbsoluteVote: gov.absoluteVote.address,
    SchemeRegistrar: gov.schemeRegistrar.address,
    UpgradeScheme: gov.upgradeScheme.address,
    DAI: dao.daiAddress,
    cDAI: dao.cdaiAddress,
    COMP: dao.COMP,
    USDC: usdc.address,
    Contribution: dao.contribution,
    DAIStaking: dao.simpleStaking,
    MarketMaker: dao.marketMaker.address,
    UBIScheme: ubi.ubiScheme.address,
    FirstClaimPool: ubi.firstClaim.address,
    HomeBridge: dao.bridge,
    ForeignBridge: dao.bridge,
    BancorFormula: dao.bancorFormula,
    DonationsStaking: dao.donationsStaking,
    UniswapRouter: uniswap.router.address,
    DAIUsdOracle: daiUsdOracle.address,
    COMPUsdOracle: compUsdOracle.address,
    USDCUsdOracle: usdcUsdOracle.address,
    AAVEUsdOracle: aaveUsdOracle.address,
    AaveLendingPool: lendingPool.address,
    GasPriceOracle: gasOracle.address,
    DAIEthOracle: daiethOracle.address,
    ETHUsdOracle: ethusdOracle.address,
    AaveIncentiveController: incentiveController.address,
    AdminWallet: adminWallet.address,
    network: networkName,
    networkId: 4447,
  };

  await releaser(release, networkName, "olddao");
  if (single) await releaser(release, `${networkName}-mainnet`, "olddao");
  return release;
};

const deploy3rdParty = async (dao) => {
  const uniswap = await deployUniswap();
  //create et/dai pair
  let mintAmount = ethers.utils.parseEther("1000");
  const ETHAmount = ethers.utils.parseEther("50");
  const dai = await ethers.getContractAt("cERC20", dao.daiAddress);
  await dai["mint(uint256)"](mintAmount);

  await dai.approve(uniswap.router.address, mintAmount);
  await uniswap.router.addLiquidityETH(
    dao.daiAddress,
    mintAmount,
    mintAmount,
    ETHAmount,
    (
      await ethers.getSigners()
    )[0].address,
    ethers.constants.MaxUint256,
    {
      value: ETHAmount,
    }
  );

  const tokenUsdOracleFactory = await ethers.getContractFactory(
    "BatUSDMockOracle"
  );
  const daiUsdOracle = await tokenUsdOracleFactory.deploy();
  const usdcUsdOracle = await tokenUsdOracleFactory.deploy();

  const compUsdOracle = await (
    await ethers.getContractFactory("CompUSDMockOracle")
  ).deploy();
  const aaveUsdOracle = await (
    await ethers.getContractFactory("AaveUSDMockOracle")
  ).deploy();
  const aave = await (await ethers.getContractFactory("AaveMock")).deploy();
  const usdc = await (await ethers.getContractFactory("USDCMock")).deploy();
  const lendingPool = await (
    await ethers.getContractFactory("LendingPoolMock")
  ).deploy(usdc.address);

  const incentiveController = await (
    await ethers.getContractFactory("IncentiveControllerMock")
  ).deploy(aave.address);

  const gasOracle = await (
    await ethers.getContractFactory("GasPriceMockOracle")
  ).deploy();
  const daiethOracle = await (
    await ethers.getContractFactory("DaiEthPriceMockOracle")
  ).deploy();
  const ethusdOracle = await (
    await ethers.getContractFactory("EthUSDMockOracle")
  ).deploy();
  return {
    uniswap,
    daiUsdOracle,
    compUsdOracle,
    aaveUsdOracle,
    usdcUsdOracle,
    gasOracle,
    daiethOracle,
    ethusdOracle,
    usdc,
    lendingPool,
    incentiveController,
  };
};

export const deployKovanOldDAO = async () => {
  let { dai, cdai, comp } = ProtocolSettings[network.name].compound || {};
  console.log("dao deploying...");
  const dao = await createOldDAO(dai, cdai, comp);
  console.log("dao deployed");

  const gov = await deployOldVoting(dao);
  console.log("old vote deployed");

  const release = {
    Reserve: dao.reserve.address,
    GoodDollar: dao.gd,
    Identity: dao.identity,
    Avatar: dao.avatar,
    Controller: dao.controller,
    AbsoluteVote: gov.absoluteVote.address,
    SchemeRegistrar: gov.schemeRegistrar.address,
    UpgradeScheme: gov.upgradeScheme.address,
    DAI: dao.daiAddress,
    cDAI: dao.cdaiAddress,
    COMP: dao.COMP,
    Contribution: dao.contribution,
    DAIStaking: dao.simpleStaking,
    MarketMaker: dao.marketMaker.address,
    Bridge: dao.bridge,
    BancorFormula: dao.bancorFormula,
    DonationsStaking: dao.donationsStaking,
    network: "kovan-mainnet",
    networkId: 42,
  };
  releaser(release, network.name, "olddao");
};
export const createOldDAO = async (daiAddr, cdaiAddr, COMPAddr) => {
  let [root, ...signers] = await ethers.getSigners();
  //generic call permissions
  let schemeMock = signers[signers.length - 1];

  console.log("got signers:", {
    daiAddr,
    cdaiAddr,
    COMPAddr,
    root: root.address,
    schemeMock: schemeMock.address,
    balance: await ethers.provider
      .getBalance(root.address)
      .then((_) => _.toString()),
  });
  const cdaiFactory = await ethers.getContractFactory("cDAIMock");
  const daiFactory = await ethers.getContractFactory("DAIMock");

  let dai = daiAddr
    ? await ethers.getContractAt("DAIMock", daiAddr)
    : await daiFactory.deploy();

  let COMP = COMPAddr
    ? await ethers.getContractAt("DAIMock", COMPAddr)
    : await daiFactory.deploy();

  let cDAI = cdaiAddr
    ? await ethers.getContractAt("DAIMock", cdaiAddr)
    : await cdaiFactory.deploy(dai.address);

  console.log("deployed erc20 tokens");
  const DAOCreatorFactory = new ethers.ContractFactory(
    DAOCreatorABI.abi,
    DAOCreatorABI.bytecode,
    root
  );

  const IdentityFactory = new ethers.ContractFactory(
    IdentityABI.abi,
    IdentityABI.bytecode,
    root
  );
  const FeeFormulaFactory = new ethers.ContractFactory(
    FeeFormulaABI.abi,
    FeeFormulaABI.bytecode,
    root
  );
  const AddFoundersFactory = new ethers.ContractFactory(
    AddFoundersABI.abi,
    AddFoundersABI.bytecode,
    root
  );

  const BridgeFactory = new ethers.ContractFactory(
    BridgeMock.abi,
    BridgeMock.bytecode,
    root
  );

  const BancorFormula = await (
    await ethers.getContractFactory("BancorFormula")
  ).deploy();

  // const BancorFormula = await ethers.getContractAt(
  //   "BancorFormula",
  //   "0x56ca74cd7b31609a8ba666308f089e0d5e2d0584"
  // );

  const Bridge = await BridgeFactory.deploy().then(printDeploy);
  // const Bridge = await ethers.getContractAt(
  //   BridgeMock.abi,
  //   "0x8122241517e81b64F0fe56D6311981dF67965D87"
  // );

  const AddFounders = await AddFoundersFactory.deploy().then(printDeploy);
  // const AddFounders = await ethers.getContractAt(
  //   AddFoundersABI.abi,
  //   "0x6F1BAbfF5E119d61F0c6d8653d84E8B284B87091"
  // );

  const Identity = await IdentityFactory.deploy().then(printDeploy);
  // const Identity = await ethers.getContractAt(
  //   IdentityABI.abi,
  //   "0x77Bd4D825F4df162BDdda73a7E295c27e09E289f"
  // );

  const daoCreator = await DAOCreatorFactory.deploy(AddFounders.address).then(
    printDeploy
  );
  // const daoCreator = await ethers.getContractAt(
  //   DAOCreatorABI.abi,
  //   "0xfD1eFFDed0EE8739dF61B580F24bCd6585d0c6B4"
  // );

  const FeeFormula = await FeeFormulaFactory.deploy(0).then(printDeploy);
  // const FeeFormula = await ethers.getContractAt(
  //   FeeFormulaABI.abi,
  //   "0x85b146AAa910aF4ab1D64cD81ab6f804aDf3053c"
  // );

  await Identity.setAuthenticationPeriod(365);
  await daoCreator.forgeOrg(
    "G$",
    "G$",
    0,
    FeeFormula.address,
    Identity.address,
    [root.address, signers[0].address, signers[1].address],
    1000,
    [100000, 100000, 100000]
  );

  const Avatar = new ethers.Contract(
    await daoCreator.avatar(),
    [
      "function owner() view returns (address)",
      "function nativeToken() view returns (address)",
    ],
    root
  );

  await Identity.setAvatar(Avatar.address);
  const controller = await Avatar.owner();

  const ccFactory = new ethers.ContractFactory(
    ContributionCalculation.abi,
    ContributionCalculation.bytecode,
    root
  );

  const contribution = await ccFactory
    .deploy(Avatar.address, 0, 1e15)
    .then(printDeploy);
  // const contribution = await ethers.getContractAt(
  //   ContributionCalculation.abi,
  //   "0xc3171409dB6827A68294B3A0D40a31310E83eD6B"
  // );

  let goodReserveF = new ethers.ContractFactory(
    GoodReserveCDai.abi,
    GoodReserveCDai.bytecode,
    root
  );
  console.log("deploying fundmanager...");

  let fundManager = await new ethers.ContractFactory(
    FundManager.abi,
    FundManager.bytecode,
    root
  )
    .deploy(
      Avatar.address,
      Identity.address,
      cDAI.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      100
    )
    .then(printDeploy);
  // const fundManager = await ethers.getContractAt(
  //   FundManager.abi,
  //   "0x3D09770f01a3EdD0D910eC12d191Ac87C187aaD0"
  // );
  console.log("deploying marketmaker...");

  let marketMaker = await new ethers.ContractFactory(
    MarketMaker.abi,
    MarketMaker.bytecode,
    root
  )
    .deploy(Avatar.address, 9999999999, 10000000000)
    .then(printDeploy);

  await marketMaker.initializeToken(
    cDAI.address,
    "100", //1gd
    "10000", //0.0001 cDai
    "1000000" //100% rr
  );
  console.log("deploying reserve...");

  let goodReserve = await goodReserveF
    .deploy(
      dai.address,
      cDAI.address,
      fundManager.address,
      Avatar.address,
      Identity.address,
      marketMaker.address,
      contribution.address,
      100
    )
    .then(printDeploy);
  // const goodReserve = await ethers.getContractAt(
  //   GoodReserveCDai.abi,
  //   "0xA4F5687F95943F7D339829A165c9EA3962a8538b"
  // );

  await marketMaker.transferOwnership(goodReserve.address);

  console.log("deploying simple staking");
  const SimpleDAIStakingF = new ethers.ContractFactory(
    SimpleDAIStaking.abi,
    SimpleDAIStaking.bytecode,
    root
  );
  const simpleStaking = await SimpleDAIStakingF.deploy(
    dai.address,
    cDAI.address,
    fundManager.address,
    100,
    Avatar.address,
    Identity.address
  ).then(printDeploy);
  // const simpleStaking = await ethers.getContractAt(
  //   SimpleDAIStaking.abi,
  //   "0x6E20B9fadeA7432c0565aEbdA1aD28D7f082eAF2"
  // );
  const DonationsStakingF = new ethers.ContractFactory(
    DonationsStaking.abi,
    DonationsStaking.bytecode,
    root
  );

  console.log("deploy donationstaking");
  const donationsStaking = await DonationsStakingF.deploy().then(printDeploy);
  // const donationsStaking = await ethers.getContractAt(
  //   DonationsStaking.abi,
  //   "0x912C6056BC5818E7Bc681e34dEfBBd2bC32080AB"
  // );

  await donationsStaking.initialize(
    Avatar.address,
    simpleStaking.address,
    dai.address
  );
  //fake donation staking for testing upgrade
  console.log("fake donations...");
  await dai["mint(uint256)"](ethers.constants.WeiPerEther).catch((e) =>
    console.log("failed minting fake dai")
  );
  await dai
    .transfer(donationsStaking.address, ethers.constants.WeiPerEther)
    .catch((e) => console.log("failed fake dai transfer"));
  await donationsStaking
    .stakeDonations(0)
    .catch((e) => console.log("failed staking fake dai"));
  await root
    .sendTransaction({
      to: donationsStaking.address,
      value: ethers.constants.WeiPerEther.div(1000),
    })
    .catch((e) => console.log("failed transfering eth to donations"));

  console.log("done donations...");

  console.log("Done deploying DAO, setting schemes permissions");

  const ictrl = await ethers.getContractAt(
    "Controller",
    controller,
    schemeMock
  );

  const setSchemes = async (addrs, params = []) => {
    for (let i in addrs) {
      await ictrl.registerScheme(
        addrs[i],
        params[i] || ethers.constants.HashZero,
        "0x0000001F",
        Avatar.address
      );
    }
  };

  const setReserveToken = async (token, gdReserve, tokenReserve, RR) => {
    const encoded = marketMaker.interface.encodeFunctionData(
      "initializeToken",
      [token, gdReserve, tokenReserve, RR]
    );

    await ictrl.genericCall(marketMaker.address, encoded, Avatar.address, 0);
  };

  const genericCall = (target, encodedFunc) => {
    return ictrl.genericCall(target, encodedFunc, Avatar.address, 0);
  };

  const addWhitelisted = (addr, did, isContract = false) => {
    if (isContract) return Identity.addContract(addr);
    return Identity.addWhitelistedWithDID(addr, did);
  };

  console.log("setting schemes");
  await daoCreator.setSchemes(
    Avatar.address,
    [
      schemeMock.address,
      Identity.address,
      goodReserve.address,
      fundManager.address,
      simpleStaking.address,
    ],
    [
      ethers.constants.HashZero,
      ethers.constants.HashZero,
      ethers.constants.HashZero,
      ethers.constants.HashZero,
      ethers.constants.HashZero,
    ],
    ["0x0000001F", "0x0000001F", "0x0000001F", "0x0000001F", "0x0000001F"],
    ""
  );

  const gd = await Avatar.nativeToken();
  //make GoodCap minter
  const encoded = (
    await ethers.getContractAt("IGoodDollar", gd)
  ).interface.encodeFunctionData("addMinter", [goodReserve.address]);

  console.log("adding minter");
  await ictrl.genericCall(gd, encoded, Avatar.address, 0);

  console.log("setting reserve token");
  // await setReserveToken(
  //   cDAI.address,
  //   "100", //1gd
  //   "10000", //0.0001 cDai
  //   "1000000" //100% rr
  // );

  console.log("starting...");
  await goodReserve.start();
  await fundManager.start();
  await simpleStaking.start();

  return {
    daoCreator,
    controller,
    reserve: goodReserve,
    avatar: await daoCreator.avatar(),
    gd: await Avatar.nativeToken(),
    identity: Identity.address,
    setSchemes,
    setReserveToken,
    genericCall,
    addWhitelisted,
    marketMaker,
    feeFormula: FeeFormula,
    daiAddress: dai.address,
    cdaiAddress: cDAI.address,
    COMP: COMP.address,
    contribution: contribution.address,
    simpleStaking: simpleStaking.address,
    bancorFormula: BancorFormula.address,
    bridge: Bridge.address,
    donationsStaking: donationsStaking.address,
  };
};

export const deployUBI = async (deployedDAO) => {
  let { nameService, setSchemes, genericCall, avatar, identity, gd } =
    deployedDAO;
  const fcFactory = new ethers.ContractFactory(
    FirstClaimPool.abi,
    FirstClaimPool.bytecode,
    (await ethers.getSigners())[0]
  );

  console.log("deploying first claim...", {
    avatar,
    identity,
  });
  const firstClaim = await fcFactory.deploy(avatar, identity, 1000);

  console.log("deploying ubischeme and starting...");

  const now = await ethers.provider.getBlock("latest");
  let ubiScheme = await new ethers.ContractFactory(
    UBIScheme.abi,
    UBIScheme.bytecode,
    (
      await ethers.getSigners()
    )[0]
  ).deploy(
    avatar,
    identity,
    firstClaim.address,
    now.timestamp,
    now.timestamp + 1000,
    14,
    7
  );

  let encoded = (
    await ethers.getContractAt("IGoodDollar", gd)
  ).interface.encodeFunctionData("mint", [firstClaim.address, 1000000]);

  await genericCall(gd, encoded);

  encoded = (
    await ethers.getContractAt("IGoodDollar", gd)
  ).interface.encodeFunctionData("mint", [ubiScheme.address, 1000000]);

  await genericCall(gd, encoded);

  console.log("set firstclaim,ubischeme as scheme and starting...");
  await setSchemes([firstClaim.address, ubiScheme.address]);
  const tx = await firstClaim.start();
  await ubiScheme.start();

  await increaseTime(1000); //make sure period end of ubischeme has reached
  return { firstClaim, ubiScheme };
};

export const deployOldVoting = async (dao) => {
  try {
    const SchemeRegistrarF = new ethers.ContractFactory(
      SchemeRegistrar.abi,
      SchemeRegistrar.bytecode,
      (await ethers.getSigners())[0]
    );
    const UpgradeSchemeF = new ethers.ContractFactory(
      UpgradeScheme.abi,
      UpgradeScheme.bytecode,
      (await ethers.getSigners())[0]
    );
    const AbsoluteVoteF = new ethers.ContractFactory(
      AbsoluteVote.abi,
      AbsoluteVote.bytecode,
      (await ethers.getSigners())[0]
    );

    console.log("dpeloying voting schemes");
    const absoluteVote = await AbsoluteVoteF.deploy().then(printDeploy);
    const upgradeScheme = await UpgradeSchemeF.deploy().then(printDeploy);
    const schemeRegistrar = await SchemeRegistrarF.deploy().then(printDeploy);

    // const [absoluteVote, upgradeScheme, schemeRegistrar] = await Promise.all([
    //   AbsoluteVoteF.deploy(),
    //   UpgradeSchemeF.deploy(),
    //   SchemeRegistrarF.deploy()
    // ]);
    console.log("setting parameters");
    const voteParametersHash = await absoluteVote.getParametersHash(
      50,
      ethers.constants.AddressZero
    );

    console.log("setting params for voting machine and schemes");
    await schemeRegistrar.setParameters(
      voteParametersHash,
      voteParametersHash,
      absoluteVote.address
    );
    await absoluteVote.setParameters(50, ethers.constants.AddressZero);
    await upgradeScheme.setParameters(voteParametersHash, absoluteVote.address);

    const upgradeParametersHash = await upgradeScheme.getParametersHash(
      voteParametersHash,
      absoluteVote.address
    );

    // Deploy SchemeRegistrar
    const schemeRegisterParams = await schemeRegistrar.getParametersHash(
      voteParametersHash,
      voteParametersHash,
      absoluteVote.address
    );

    let schemesArray;
    let paramsArray;

    // Subscribe schemes
    console.log("setting voting schemes");
    schemesArray = [schemeRegistrar.address, upgradeScheme.address];
    paramsArray = [schemeRegisterParams, upgradeParametersHash];
    await dao.setSchemes(schemesArray, paramsArray);
    return {
      schemeRegistrar,
      upgradeScheme,
      absoluteVote,
    };
  } catch (e) {
    console.log("deployVote failed", e);
  }
};

if (process.env.TEST != "true") {
  if (network.name.includes("kovan")) {
    deployKovanOldDAO().catch(console.log);
  } else deploy(name).catch(console.log);
}
