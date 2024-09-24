import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import DAOCreatorABI from "@gooddollar/goodcontracts/build/contracts/DaoCreatorGoodDollarWithTokens.json";
import FeeFormulaABI from "@gooddollar/goodcontracts/build/contracts/FeeFormula.json";
import ContributionCalculation from "@gooddollar/goodcontracts/stakingModel/build/contracts/ContributionCalculation.json";
import FirstClaimPool from "@gooddollar/goodcontracts/stakingModel/build/contracts/FirstClaimPool.json";
import SchemeRegistrar from "@gooddollar/goodcontracts/build/contracts/SchemeRegistrar.json";
import AbsoluteVote from "@gooddollar/goodcontracts/build/contracts/AbsoluteVote.json";
import UpgradeScheme from "@gooddollar/goodcontracts/build/contracts/UpgradeScheme.json";
import UBIScheme from "@gooddollar/goodcontracts/stakingModel/build/contracts/UBIScheme.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import { GoodMarketMaker, CompoundVotingMachine } from "../types";
import { Contract } from "ethers";
import testDeployer from "@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework";

export const getStakingFactory = async (
  factory:
    | "GoodCompoundStaking"
    | "GoodAaveStaking"
    | "GoodCompoundStakingTest"
    | "GoodAaveStakingV2"
    | "GoodCompoundStakingV2"
) => {
  let swapHelper = await ethers
    .getContractFactory("UniswapV2SwapHelper")
    .then(_ => _.deploy());

  const simpleStakingFactory = await ethers.getContractFactory(factory, {
    libraries: {
      UniswapV2SwapHelper: swapHelper.address
    }
  });
  return simpleStakingFactory;
};

export const deploySuperFluid = async () => {
  // This deploys the whole framework with various contracts
  const { frameworkDeployer } = await testDeployer.deployTestFramework();
  // returns contract addresses as a struct, see https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/utils/SuperfluidFrameworkDeployer.sol#L48
  const contractsFramework = await frameworkDeployer.getFramework();

  return contractsFramework;
};

export const deploySuperGoodDollar = async (sfContracts, tokenArgs) => {
  const SuperGoodDollarFactory = await ethers.getContractFactory(
    "SuperGoodDollar"
  );

  console.log("deploying supergooddollar logic");
  const SuperGoodDollar = await SuperGoodDollarFactory.deploy(sfContracts.host);

  console.log("deploying supergooddollar proxy");
  const GoodDollarProxyFactory = await ethers.getContractFactory(
    "contracts/token/superfluid/UUPSProxy.sol:UUPSProxy"
  );
  const GoodDollarProxy = await GoodDollarProxyFactory.deploy();

  console.log("deploying flow nfts...");

  const outNftProxy = await GoodDollarProxyFactory.deploy();
  const inNftProxy = await GoodDollarProxyFactory.deploy();

  const constantInflowNFT = await ethers.deployContract("ConstantInflowNFT", [
    sfContracts.host,
    outNftProxy.address
  ]);

  const constantOutflowNFT = await ethers.deployContract("ConstantOutflowNFT", [
    sfContracts.host,
    inNftProxy.address
  ]);
  await outNftProxy.initializeProxy(constantOutflowNFT.address);
  await inNftProxy.initializeProxy(constantInflowNFT.address);

  console.log("deployed supergooddollar proxy, initializing proxy...");
  await GoodDollarProxy.initializeProxy(SuperGoodDollar.address);

  console.log("initializing supergooddollar....");
  await SuperGoodDollar.attach(GoodDollarProxy.address)[
    "initialize(string,string,uint256,address,address,address,address,address,address)"
  ](...tokenArgs, outNftProxy.address, inNftProxy.address);
  const GoodDollar = await ethers.getContractAt(
    "SuperGoodDollar",
    GoodDollarProxy.address
  );
  console.log("supergooddollar created successfully");

  await constantOutflowNFT
    .attach(outNftProxy.address)
    .initialize(
      (await GoodDollar.symbol()) + " Outflow NFT",
      (await GoodDollar.symbol()) + " COF"
    );
  await constantInflowNFT
    .attach(inNftProxy.address)
    .initialize(
      (await GoodDollar.symbol()) + " Inflow NFT",
      (await GoodDollar.symbol()) + " CIF"
    );

  return GoodDollar;
};
export const createDAO = async (tokenType: "super" | "regular" = "super") => {
  let [root, ...signers] = await ethers.getSigners();

  const sfContracts = await deploySuperFluid();
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

  const IdentityFactory = await ethers.getContractFactory("IdentityV2");

  const FeeFormulaFactory = new ethers.ContractFactory(
    FeeFormulaABI.abi,
    FeeFormulaABI.bytecode,
    root
  );

  const BancorFormula = await (
    await ethers.getContractFactory("BancorFormula")
  ).deploy();

  console.log("deploy upgradeable identity...");

  const Identity = await upgrades.deployProxy(
    IdentityFactory,
    [root.address, ethers.constants.AddressZero],
    {
      kind: "uups"
    }
  );

  const daoCreator = await DAOCreatorFactory.deploy();
  const FeeFormula = await FeeFormulaFactory.deploy(0);
  const GReputation = await ethers.getContractFactory("GReputation");

  console.log("deploy upgradeable rep...");
  let reputation = await upgrades.deployProxy(
    GReputation,
    [ethers.constants.AddressZero, "", ethers.constants.HashZero, 0],
    {
      kind: "uups",
      initializer: "initialize(address, string, bytes32, uint256)"
    }
  );

  let GoodDollar;
  if (tokenType === "regular") {
    console.log("deploy regular G$...");
    const GoodDollarFactory = await ethers.getContractFactory("GoodDollar");

    GoodDollar = await upgrades.deployProxy(
      GoodDollarFactory,
      [
        "GoodDollar",
        "G$",
        0,
        FeeFormula.address,
        Identity.address,
        ethers.constants.AddressZero,
        daoCreator.address
      ],
      {
        kind: "uups",
        initializer:
          "initialize(string, string, uint256, address, address, address,address)"
      }
    );
  } else {
    console.log("deploy super G$...");
    GoodDollar = await deploySuperGoodDollar(sfContracts, [
      "GoodDollar",
      "G$",
      0, // cap
      FeeFormula.address,
      Identity.address,
      ethers.constants.AddressZero,
      daoCreator.address
    ]);
  }

  console.log("creating DAO...", {
    gdOwner: await GoodDollar.owner(),
    gd: GoodDollar.address,
    GOOD: reputation.address,
    daoCreator: daoCreator.address
  });
  // await Identity.setAuthenticationPeriod(365);
  await daoCreator.forgeOrg(
    GoodDollar.address,
    reputation.address,
    [],
    1000,
    []
  );

  const Avatar = new ethers.Contract(
    await daoCreator.avatar(),
    [
      "function owner() view returns (address)",
      "function nativeToken() view returns (address)"
    ],
    root
  );

  // await Identity.setAvatar(Avatar.address);
  const controller = await Avatar.owner();

  console.log(
    "is controller/avatar minters and pauser",
    await GoodDollar.isMinter(controller),
    await GoodDollar.isMinter(Avatar.address),
    await GoodDollar.isPauser(Avatar.address)
  );

  const ccFactory = new ethers.ContractFactory(
    ContributionCalculation.abi,
    ContributionCalculation.bytecode,
    root
  );

  const contribution = await ccFactory.deploy(Avatar.address, 0, 1e15);

  console.log("deploying nameService", [
    controller,
    Avatar.address,
    Identity.address,
    await Avatar.nativeToken(),
    contribution.address,
    BancorFormula.address,
    dai.address,
    cDAI.address
  ]);
  const nameService = await upgrades.deployProxy(
    await ethers.getContractFactory("NameService"),
    [
      controller,
      [
        "CONTROLLER",
        "AVATAR",
        "IDENTITY",
        "GOODDOLLAR",
        "CONTRIBUTION_CALCULATION",
        "BANCOR_FORMULA",
        "DAI",
        "CDAI",
        "COMP",
        "UBISCHEME",
        "BRIDGE_CONTRACT",
        "UBI_RECIPIENT"
      ].map(_ => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(_))),
      [
        controller,
        Avatar.address,
        Identity.address,
        await Avatar.nativeToken(),
        contribution.address,
        BancorFormula.address,
        dai.address,
        cDAI.address,
        COMP.address,
        root.address,
        root.address,
        root.address
      ]
    ],
    {
      kind: "uups"
    }
  );

  await Identity.initDAO(nameService.address);

  console.log("deploying reserve...");
  let goodReserve = await upgrades.deployProxy(
    await ethers.getContractFactory("GoodReserveCDai"),

    [
      nameService.address,
      //check sample merkle tree generated by gdxAirdropCalculation.ts script
      "0x26ef809f3f845395c0bc66ce1eea85146516cb99afd030e2085b13e79514e94c"
    ],
    {
      initializer: "initialize(address, bytes32)",
      kind: "uups"
    }
  );

  console.log("deploying disthelper...");

  let distHelper = await upgrades.deployProxy(
    await ethers.getContractFactory("DistributionHelper"),
    [nameService.address],
    {
      initializer: "initialize(address)",
      kind: "uups"
    }
  );
  console.log("deploying marketMaker...");

  const MM = await ethers.getContractFactory("GoodMarketMaker");

  let marketMaker = (await upgrades.deployProxy(
    MM,
    [nameService.address, 999388834642296, 1e15],
    {
      kind: "uups"
    }
  )) as unknown as GoodMarketMaker;

  await (await reputation.updateDAO(nameService.address)).wait();

  console.log("Done deploying DAO, setting up nameService...");
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

  const setDAOAddress = async (name, addr) => {
    const encoded = nameService.interface.encodeFunctionData("setAddress", [
      name,
      addr
    ]);

    await ictrl.genericCall(nameService.address, encoded, Avatar.address, 0);
  };

  const runAsAvatarOnly = async (contract, functionAbi, ...parameters) => {
    const funcNameEnd = functionAbi.indexOf("(");
    expect(funcNameEnd).to.be.gt(-1);
    const functionName = functionAbi.substring(0, funcNameEnd);

    await expect(contract[functionAbi](...parameters)).to.revertedWith(
      /avatar/
    );
    const encoded = contract.interface.encodeFunctionData(functionName, [
      ...parameters
    ]);

    await ictrl.genericCall(contract.address, encoded, Avatar.address, 0);
  };

  const setReserveToken = async (token, gdReserve, tokenReserve, RR) => {
    const encoded = marketMaker.interface.encodeFunctionData(
      "initializeToken",
      [token, gdReserve, tokenReserve, RR, 0]
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

  console.log("Setting schemes...");
  await daoCreator.setSchemes(
    Avatar.address,
    [schemeMock.address, Identity.address],
    [ethers.constants.HashZero, ethers.constants.HashZero],
    ["0x0000001F", "0x0000001F"],
    ""
  );

  const gd = await Avatar.nativeToken();
  //make GoodCap minter
  console.log("Setting reserve as minter...");
  const encoded = (
    await ethers.getContractAt("IGoodDollar", gd)
  ).interface.encodeFunctionData("addMinter", [goodReserve.address]);

  await ictrl.genericCall(gd, encoded, Avatar.address, 0);

  console.log("Setting reserve distribution helper...");

  await ictrl.genericCall(
    goodReserve.address,
    goodReserve.interface.encodeFunctionData("setDistributionHelper", [
      distHelper.address
    ]),
    Avatar.address,
    0
  );

  const gasFeeMockFactory = await ethers.getContractFactory(
    "GasPriceMockOracle"
  );
  const gasFeeOracle = await gasFeeMockFactory.deploy();
  const daiEthPriceMockFactory = await ethers.getContractFactory(
    "DaiEthPriceMockOracle"
  );
  const daiEthOracle = await daiEthPriceMockFactory.deploy();

  const ethUsdOracleFactory = await ethers.getContractFactory(
    "EthUSDMockOracle"
  );
  const ethUsdOracle = await ethUsdOracleFactory.deploy();

  console.log("setting nameservice addrresses...");
  await setDAOAddress("ETH_USD_ORACLE", ethUsdOracle.address);
  await setDAOAddress("GAS_PRICE_ORACLE", gasFeeOracle.address);
  await setDAOAddress("DAI_ETH_ORACLE", daiEthOracle.address);
  await setDAOAddress("RESERVE", goodReserve.address);
  await setDAOAddress("MARKET_MAKER", marketMaker.address);
  await setDAOAddress("REPUTATION", reputation.address);

  console.log("setting reserve token...");
  await cDAI["mint(address,uint256)"](
    goodReserve.address,
    10000
  );
  await setReserveToken(
    cDAI.address,
    "100", //1gd
    "10000", //0.0001 cDai
    "1000000" //100% rr
  );

  console.log("deploying compound voting...");

  const votingMachine = (await upgrades.deployProxy(
    await ethers.getContractFactory("CompoundVotingMachine"),
    [nameService.address, 5760, root.address, reputation.address],
    { kind: "uups" }
  )) as unknown as CompoundVotingMachine;

  return {
    daoCreator,
    controller,
    reserve: goodReserve,
    avatar: await Avatar.address,
    gd: await Avatar.nativeToken(),
    identity: Identity.address,
    identityDeployed: Identity,
    nameService,
    setDAOAddress,
    runAsAvatarOnly,
    setSchemes,
    setReserveToken,
    genericCall,
    addWhitelisted,
    marketMaker,
    feeFormula: FeeFormula,
    daiAddress: dai.address,
    cdaiAddress: cDAI.address,
    COMP,
    reputation: reputation.address,
    votingMachine,
    sfContracts
  };
};
export const deployUBI = async (deployedDAO, withFirstClaim = true) => {
  let { nameService, setSchemes, genericCall, setDAOAddress } = deployedDAO;
  const fcFactory = new ethers.ContractFactory(
    FirstClaimPool.abi,
    FirstClaimPool.bytecode,
    (await ethers.getSigners())[0]
  );

  console.log("deploying first claim...", {
    avatar: await nameService.getAddress("AVATAR"),
    identity: await nameService.getAddress("IDENTITY")
  });
  let firstClaim = fcFactory.attach(ethers.constants.AddressZero);
  if (withFirstClaim) {
    firstClaim = await fcFactory.deploy(
      await nameService.getAddress("AVATAR"),
      await nameService.getAddress("IDENTITY"),
      1000
    );
  }

  console.log("deploying ubischeme and starting...", {
    input: [nameService.address, firstClaim.address, 14]
  });

  let ubiScheme = await upgrades.deployProxy(
    await ethers.getContractFactory("UBIScheme"),
    [nameService.address, firstClaim.address, 14],
    { kind: "uups" }
  );

  const gd = await nameService.getAddress("GOODDOLLAR");

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

  if (withFirstClaim) {
    encoded = firstClaim.interface.encodeFunctionData("setUBIScheme", [
      ubiScheme.address
    ]);

    await genericCall(firstClaim.address, encoded);
    await firstClaim.start();
  }

  await setDAOAddress("UBISCHEME", ubiScheme.address);
  return { firstClaim, ubiScheme };
};
export const deployOldUBI = async deployedDAO => {
  let { nameService, setSchemes, genericCall, setDAOAddress } = deployedDAO;
  const fcFactory = new ethers.ContractFactory(
    FirstClaimPool.abi,
    FirstClaimPool.bytecode,
    (await ethers.getSigners())[0]
  );
  const ubiSchemeFactory = new ethers.ContractFactory(
    UBIScheme.abi,
    UBIScheme.bytecode,
    (await ethers.getSigners())[0]
  );
  console.log("deploying first claim...", {
    avatar: await nameService.getAddress("AVATAR"),
    identity: await nameService.getAddress("IDENTITY")
  });
  const firstClaim = await fcFactory.deploy(
    await nameService.getAddress("AVATAR"),
    await nameService.getAddress("IDENTITY"),
    100
  );

  console.log("deploying ubischeme and starting...", {
    input: [nameService.address, firstClaim.address, 14]
  });
  const block = await ethers.provider.getBlock("latest");
  const startUBI = block.timestamp - 60 * 60 * 24 * 2;
  const endUBI = startUBI + 60 * 60 * 24 * 30;
  let ubiScheme = await ubiSchemeFactory.deploy(
    await nameService.getAddress("AVATAR"),
    await nameService.getAddress("IDENTITY"),
    firstClaim.address,
    startUBI,
    endUBI,
    3,
    1
  );

  const gd = await nameService.getAddress("GOODDOLLAR");

  let encoded = (
    await ethers.getContractAt("IGoodDollar", gd)
  ).interface.encodeFunctionData("mint", [firstClaim.address, 1000000]);

  await genericCall(gd, encoded);

  encoded = (
    await ethers.getContractAt("IGoodDollar", gd)
  ).interface.encodeFunctionData("mint", [ubiScheme.address, 1000000]);

  await genericCall(gd, encoded);

  console.log("set firstclaim,ubischeme as scheme and starting...");
  await setSchemes([firstClaim.address]);
  await firstClaim.start();
  await ubiScheme.start();
  return { firstClaim, ubiScheme };
};
export async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await advanceBlocks(1);
}

export const advanceBlocks = async (blocks: number) => {
  await ethers.provider.send("hardhat_mine", ["0x" + blocks.toString(16)]);
  // required for bug https://github.com/sc-forks/solidity-coverage/issues/707
  await ethers.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"]);
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
    let permissionArray;

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

export const deployUniswap = async (comp, dai) => {
  let founder, staker, signers;
  [founder, staker, ...signers] = await ethers.getSigners();
  const routerFactory = new ethers.ContractFactory(
    UniswapV2Router02.abi,
    UniswapV2Router02.bytecode,
    (await ethers.getSigners())[0]
  );
  const uniswapFactory = new ethers.ContractFactory(
    UniswapV2Factory.abi,
    UniswapV2Factory.bytecode,
    (await ethers.getSigners())[0]
  );
  const wethFactory = new ethers.ContractFactory(
    WETH9.abi,
    WETH9.bytecode,
    (await ethers.getSigners())[0]
  );

  const weth = await wethFactory.deploy();
  const factory = await uniswapFactory.deploy(
    (
      await ethers.getSigners()
    )[0].address
  );
  const router = await routerFactory.deploy(factory.address, weth.address);
  await factory.createPair(comp.address, weth.address); // Create comp and weth pair
  const compPairAddress = factory.getPair(comp.address, weth.address);

  await factory.createPair(dai.address, weth.address); // Create comp and dai pair
  const daiPairAddress = factory.getPair(dai.address, weth.address);

  const compPair = new Contract(
    compPairAddress,
    JSON.stringify(IUniswapV2Pair.abi),
    staker
  ).connect(founder);
  const daiPair = new Contract(
    daiPairAddress,
    JSON.stringify(IUniswapV2Pair.abi),
    staker
  ).connect(founder);
  await dai["mint(address,uint256)"](
    founder.address,
    ethers.utils.parseEther("2000000")
  );
  await dai["mint(address,uint256)"](
    daiPair.address,
    ethers.utils.parseEther("2000000")
  );
  await comp["mint(address,uint256)"](
    compPair.address,
    ethers.utils.parseEther("200000")
  );
  console.log("depositing eth to liquidity pools");
  await weth.deposit({ value: ethers.utils.parseEther("4000") });
  console.log(await weth.balanceOf(founder.address).then(_ => _.toString()));
  await weth.transfer(compPair.address, ethers.utils.parseEther("2000"));
  await weth.transfer(daiPair.address, ethers.utils.parseEther("2000"));
  console.log("minting liquidity pools");

  await compPair.mint(founder.address);
  await daiPair.mint(founder.address);
  console.log("LP tokens minted");
  return {
    router,
    factory,
    weth,
    compPairContract: compPair,
    daiPairContract: daiPair
  };
};
