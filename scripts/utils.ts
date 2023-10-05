import { Contract, Provider, setMulticallAddress } from "ethers-multicall";
import Identity from "../artifacts/contracts/Interfaces.sol/IIdentity.json";
import { ethers } from "hardhat";

export const bulkIsWhitelisted = async (accounts: Array<String>) => {
  setMulticallAddress(122, "0x3CE6158b7278Bf6792e014FA7B4f3c6c46fe9410");
  setMulticallAddress(42220, "0x75F59534dd892c1f8a7B172D639FA854D529ada3");
  const celoProvider = new ethers.providers.JsonRpcProvider("https://forno.celo.org");
  const ethcallProvider = new Provider(celoProvider, 42220);
  const identityContract = new Contract("0xC361A6E67822a0EDc17D899227dd9FC50BD62F42", Identity.abi);
  const calls = accounts.map(d => identityContract.isWhitelisted(d));
  const result = await ethcallProvider.all(calls);
  const whitelisted = accounts.filter((v, i) => result[i]);
  return whitelisted;
};
