import { run, network, ethers } from "hardhat";
import { omit, pick, defaultsDeep } from "lodash";
import dao from "../../releases/deployment.json";
import ProtocolSettings from "../../releases/deploy-settings.json";
import util from "util";

const exec = util.promisify(require("child_process").exec);

const getImplementationAddress = async addr => {
  console.log("finding impl for:", addr);
  let proxy = await ethers.provider.getStorageAt(
    addr,
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
  );
  let res = addr;
  if (proxy != ethers.constants.HashZero) res = "0x" + proxy.slice(-40);
  else {
    const code = await ethers.getDefaultProvider().getCode(addr);
    if (code.startsWith("0x363d3d373d3d3d363d73"))
      res = "0x" + code.slice(22, 62);
  }
  console.log("impl address for:", addr, res);
  return res;
};

const main = async () => {
  let withTruffle = true;
  const release = dao[network.name];
  let settings = defaultsDeep(
    {},
    ProtocolSettings[network.name],
    ProtocolSettings["default"]
  );

  const networkProvider = network.name.includes("-")
    ? network.name.split("-")[1]
    : network.name;

  //   const impl = await getImplementationAddress(release.AdminWallet);
  //   console.log({ impl, aw: release.AdminWallet });
  let toVerify = omit(release, [
    "GoodDollar",
    "Avatar",
    "Controller",
    "DAOCreator",
    "AddFounders",
    "FeeFormula",
    "network",
    "networkId"
  ]);

  if (withTruffle) {
    console.log("truffle compile....");
    const { stdout, stderr } = await exec("npx truffle compile");
  } else {
    //verify the first proxy
    const identityProxy = toVerify["Identity"];
    await run("verify:verify", {
      address: identityProxy,
      contract: "contracts/utils/ProxyFactory1967.sol:ERC1967Proxy"
    }).catch(e =>
      console.log("failed verifying proxy:", identityProxy, e.message)
    );

    const uupsProxy = toVerify["GoodDollar"];
    await run("verify:verify", {
      address: uupsProxy,
      contract: "contracts/token/superfluid/UUPSProxy.sol:UUPSProxy"
    }).catch(e =>
      console.log("failed verifying uups proxy:", uupsProxy, e.message)
    );
  }
  // toVerify = pick(release, ["GoodDollarStaking"]);
  for (let key in toVerify) {
    let constructorArguments = [];
    let forcedConstructorArguments = "";
    const address = toVerify[key];
    //   }
    //   const ps = Object.entries(toVerify).map(([key, address]) => {
    let contract;
    let contractName = key;
    let proxy = "--custom-proxy ERC1967Proxy";
    switch (key) {
      case "AdminWallet":
        contract = "contracts/utils/AdminWallet.sol:AdminWallet";
        break;
      case "Faucet":
        contract = "contracts/fuseFaucet/Faucet.sol:Faucet";
        break;
      case "Invites":
        contractName = "InvitesV2";
        contract = "contracts/invite/InvitesV2.sol:InvitesV2";
        break;
      case "ProxyFactory":
        proxy = "";
        contractName = "ProxyFactory1967";
        contract = "contracts/utils/ProxyFactory1967.sol:ProxyFactory1967";
        break;
      case "NameService":
        contract = "contracts/utils/NameService.sol:NameService";
        break;
      case "GReputation":
        contract = "contracts/governance/GReputation.sol:GReputation";
        break;
      case "Identity":
        contractName = "IdentityV2";
        contract = "contracts/identity/IdentityV2.sol:IdentityV2";
        break;
      case "GoodDollarStaking":
        proxy = "";
        contract =
          "contracts/governance/GoodDollarStaking.sol:GoodDollarStaking";
        constructorArguments = [
          release.NameService,
          ethers.BigNumber.from(settings.savings.blockAPY),
          ethers.BigNumber.from(settings.savings.blocksPerYear),
          settings.savings.daysUntilUpgrade
        ];
        forcedConstructorArguments = ethers.utils.defaultAbiCoder.encode(
          ["address", "uint128", "uint128", "uint32"],
          constructorArguments
        );
        break;
      case "GoodDollar":
        proxy = "--custom-proxy UUPSProxy";
        contractName = "SuperGoodDollar";
        contract =
          "contracts/token/superfluid/SuperGoodDollar.sol:SuperGoodDollar";
        constructorArguments = [settings.superfluidHost];
        forcedConstructorArguments = ethers.utils.defaultAbiCoder.encode(
          ["address"],
          constructorArguments
        );
        break;
      default:
        contract = undefined;
    }

    if (withTruffle) {
      const cmd = `npx truffle run verify ${proxy} ${contractName}@${address} ${
        forcedConstructorArguments
          ? "--forceConstructorArgs string:" +
            forcedConstructorArguments.slice(2)
          : ""
      } --network ${networkProvider}`;
      console.log(cmd);
      const { stdout, stderr } = await exec(cmd);
      console.log(stdout);
      console.log(stderr);
    } else {
      let task = "verify";
      let params = {
        address,
        contract
      };
      if (
        constructorArguments.length > 0 &&
        contract.includes("SuperGoodDollar") === false
      ) {
        task = "verify:verify";
        params["constructorArguments"] = constructorArguments;
      }
      console.log("verifying:", task, params);

      await run(task, params).catch(e =>
        console.log("failed verifying:", address, contract, e.message)
      );
    }
  }

  //   await Promise.all(ps);
};

main().catch(e => console.log(e));
