import { run, network, ethers } from "hardhat";
import { omit } from "lodash";
import dao from "../../releases/deployment.json";

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
  const release = dao[network.name];
  //   const impl = await getImplementationAddress(release.AdminWallet);
  //   console.log({ impl, aw: release.AdminWallet });
  const toVerify = omit(release, [
    "GoodDollar",
    "Avatar",
    "Controller",
    "DAOCreator",
    "AddFounders",
    "FeeFormula"
  ]);
  //verify the first proxy
  const identityProxy = toVerify["Identity"];
  await run("verify:verify", {
    address: identityProxy,
    contract: "contracts/utils/ProxyFactory1967.sol:ERC1967Proxy"
  }).catch(e =>
    console.log("failed verifying proxy:", identityProxy, e.message)
  );
  for (let key in toVerify) {
    const address = toVerify[key];
    //   }
    //   const ps = Object.entries(toVerify).map(([key, address]) => {
    let contract;
    switch (key) {
      case "AdminWallet":
        contract = "contracts/utils/AdminWallet.sol:AdminWallet";
        break;
      case "Faucet":
        contract = "contracts/fuseFaucet/Faucet.sol:Faucet";
        break;
      case "Invites":
        contract = "contracts/invite/InvitesV2.sol:InvitesV2";
        break;
      case "ProxyFactory":
        contract = "contracts/utils/ProxyFactory1967.sol:ProxyFactory1967";
        break;
      case "NameService":
        contract = "contracts/utils/NameService.sol:NameService";
        break;
      case "GReputation":
        contract = "contracts/governance/GReputation.sol:GReputation";
        break;
      case "Identity":
        contract = "contracts/identity/IdentityV2.sol:IdentityV2";
        break;
      default:
        contract = undefined;
    }
    console.log("verifying:", address, contract);
    await run("verify", {
      address,
      contract
    }).catch(e =>
      console.log("failed verifying:", address, contract, e.message)
    );
  }

  //   await Promise.all(ps);
};

main().catch(e => console.log(e));