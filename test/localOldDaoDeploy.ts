/***
 * deploy complete DAO for testing purposes.
 * for example run:
 * npx hardhat run scripts/test/localDaoDeploy.ts  --network develop
 * then to test upgrade process locally run:
 * npx hardhat run scripts/upgradeToV2/upgradeToV2.ts  --network develop
 */
import { network, ethers, upgrades } from "hardhat";
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

import releaser from "../scripts/releaser";
import { increaseTime, deployUniswap } from "../test/helpers";

const deploy = async () => {
  console.log("dao deploying...");
  //TODO: modify to deploy old DAO contracts version ie Reserve to truly simulate old DAO
  const dao = await createOldDAO();
  console.log("dao deployed");
  const ubi = await deployUBI(dao);
  console.log("ubi deployed");
  const gov = await deployOldVoting(dao);
  console.log("old vote deployed");
  const { uniswap, daiUsdOracle } = await deploy3rdParty(dao);

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
    UBIScheme: ubi.ubiScheme.address,
    FirstClaimPool: ubi.firstClaim.address,
    Bridge: dao.bridge,
    BancorFormula: dao.bancorFormula,
    DonationsStaking: dao.donationsStaking,
    UniswapRouter: uniswap.router.address,
    DAIUsdOracle: daiUsdOracle.address,
    network: "develop",
    networkId: 4447
  };
  releaser(release, network.name, "olddao");
};

const deploy3rdParty = async dao => {
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
    (await ethers.getSigners())[0].address,
    ethers.constants.MaxUint256,
    {
      value: ETHAmount
    }
  );

  const tokenUsdOracleFactory = await ethers.getContractFactory(
    "BatUSDMockOracle"
  );
  const daiUsdOracle = await tokenUsdOracleFactory.deploy();
  return { uniswap, daiUsdOracle };
};
export const createOldDAO = async () => {
  let [root, ...signers] = await ethers.getSigners();

  const cdaiFactory = await ethers.getContractFactory("cDAIMock");
  const daiFactory = await ethers.getContractFactory("DAIMock");

  let dai = await daiFactory.deploy();

  let COMP = await daiFactory.deploy();

  let cDAI = await cdaiFactory.deploy(dai.address);

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

  const Bridge = await BridgeFactory.deploy();

  const AddFounders = await AddFoundersFactory.deploy();
  const Identity = await IdentityFactory.deploy();
  const daoCreator = await DAOCreatorFactory.deploy(AddFounders.address);
  const FeeFormula = await FeeFormulaFactory.deploy(0);

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
      "function nativeToken() view returns (address)"
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

  const contribution = await ccFactory.deploy(Avatar.address, 0, 1e15);

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
  ).deploy(
    Avatar.address,
    Identity.address,
    cDAI.address,
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    100
  );

  console.log("deploying marketmaker...");

  let marketMaker = await new ethers.ContractFactory(
    MarketMaker.abi,
    MarketMaker.bytecode,
    root
  ).deploy(Avatar.address, 9999999999, 10000000000);

  console.log("deploying reserve...");

  let goodReserve = await goodReserveF.deploy(
    dai.address,
    cDAI.address,
    fundManager.address,
    Avatar.address,
    Identity.address,
    marketMaker.address,
    contribution.address,
    100
  );

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
  );

  const DonationsStakingF = new ethers.ContractFactory(
    DonationsStaking.abi,
    DonationsStaking.bytecode,
    root
  );
  const donationsStaking = await DonationsStakingF.deploy();
  await donationsStaking.initialize(
    Avatar.address,
    simpleStaking.address,
    dai.address
  );
  //fake donation staking for testing upgrade
  await dai["mint(uint256)"](ethers.constants.WeiPerEther);
  await dai.transfer(donationsStaking.address, ethers.constants.WeiPerEther);
  await donationsStaking.stakeDonations(0);
  root.sendTransaction({
    to: donationsStaking.address,
    value: ethers.constants.WeiPerEther
  });
  console.log("rergular deploy");
  // const donationsStaking = await upgrades.deployProxy(DonationsStakingF, [
  //   Avatar.address,
  //   simpleStaking.address,
  //   dai.address
  // ]);

  console.log("Done deploying DAO, setting schemes permissions");
  //generic call permissions
  let schemeMock = signers[signers.length - 1];

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

  await daoCreator.setSchemes(
    Avatar.address,
    [
      schemeMock.address,
      Identity.address,
      goodReserve.address,
      fundManager.address,
      simpleStaking.address
    ],
    [
      ethers.constants.HashZero,
      ethers.constants.HashZero,
      ethers.constants.HashZero,
      ethers.constants.HashZero,
      ethers.constants.HashZero
    ],
    ["0x0000001F", "0x0000001F", "0x0000001F", "0x0000001F", "0x0000001F"],
    ""
  );

  const gd = await Avatar.nativeToken();
  //make GoodCap minter
  const encoded = (
    await ethers.getContractAt("IGoodDollar", gd)
  ).interface.encodeFunctionData("addMinter", [goodReserve.address]);

  await ictrl.genericCall(gd, encoded, Avatar.address, 0);

  await setReserveToken(
    cDAI.address,
    "100", //1gd
    "10000", //0.0001 cDai
    "1000000" //100% rr
  );

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
    donationsStaking: donationsStaking.address
  };
};

export const deployUBI = async deployedDAO => {
  let {
    nameService,
    setSchemes,
    genericCall,
    avatar,
    identity,
    gd
  } = deployedDAO;
  const fcFactory = new ethers.ContractFactory(
    FirstClaimPool.abi,
    FirstClaimPool.bytecode,
    (await ethers.getSigners())[0]
  );

  console.log("deploying first claim...", {
    avatar,
    identity
  });
  const firstClaim = await fcFactory.deploy(avatar, identity, 1000);

  console.log("deploying ubischeme and starting...");

  const now = await ethers.provider.getBlock("latest");
  let ubiScheme = await new ethers.ContractFactory(
    UBIScheme.abi,
    UBIScheme.bytecode,
    (await ethers.getSigners())[0]
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

export const deployOldVoting = async dao => {
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

    const [absoluteVote, upgradeScheme, schemeRegistrar] = await Promise.all([
      AbsoluteVoteF.deploy(),
      UpgradeSchemeF.deploy(),
      SchemeRegistrarF.deploy()
    ]);
    console.log("setting parameters");
    const voteParametersHash = await absoluteVote.getParametersHash(
      50,
      ethers.constants.AddressZero
    );

    console.log("setting params for voting machine and schemes");

    await Promise.all([
      schemeRegistrar.setParameters(
        voteParametersHash,
        voteParametersHash,
        absoluteVote.address
      ),
      absoluteVote.setParameters(50, ethers.constants.AddressZero),
      upgradeScheme.setParameters(voteParametersHash, absoluteVote.address)
    ]);
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
    schemesArray = [schemeRegistrar.address, upgradeScheme.address];
    paramsArray = [schemeRegisterParams, upgradeParametersHash];
    await dao.setSchemes(schemesArray, paramsArray);
    return {
      schemeRegistrar,
      upgradeScheme,
      absoluteVote
    };
  } catch (e) {
    console.log("deployVote failed", e);
  }
};

deploy().catch(console.log);
