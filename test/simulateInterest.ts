import fse from "fs-extra";
import { ethers, network as networkData } from "hardhat";
import settings from "../releases/deploy-settings.json";
import deployment from "../releases/deployment.json";
import { increaseTime, advanceBlocks } from "./helpers";

/**
 * helper script to simulate enough days of interest transfer and claiming
 * so we can test fishing of inactive user accounts
 */

const waitTX = async (tx) => {
  return (await tx).wait();
};
const simulate = async function () {
  const network = networkData.name;
  const networkSettings = { ...settings["default"], ...settings[network] };
  const accounts = await ethers.getSigners();

  let addresses = deployment[network];
  let mainnetAddresses = deployment[`${network}-mainnet`];
  console.log({ addresses, network });
  const identity = await ethers.getContractAt("IIdentity", addresses.Identity);
  await Promise.all(
    accounts.slice(0, 10).map((a) =>
      identity
        .addWhitelistedWithDID(a.address, a.address + Math.random())
        .then((_) => _.wait())
        .catch((_) => _)
    )
  );
  const dai = await ethers.getContractAt("DAIMock", mainnetAddresses.DAI);
  const cDAI = await ethers.getContractAt("cDAIMock", mainnetAddresses.cDAI);
  const simpleStaking = mainnetAddresses.StakingContracts[0][0];
  const goodFundManager = await ethers.getContractAt(
    "GoodFundManager",
    mainnetAddresses.GoodFundManager
  );
  const ubi = await ethers.getContractAt("UBIScheme", addresses.UBIScheme);

  console.log("transaction count:", await accounts[0].getTransactionCount());
  await increaseTime(60 * 60 * 24).catch((e) =>
    console.log("nextday failed", e)
  );
  await waitTX(
    dai.approve(cDAI.address, ethers.utils.parseUnits("300000000000", "ether"))
  );
  await waitTX(
    dai.allocateTo(
      accounts[0].address,
      ethers.utils.parseUnits("300000000000", "ether")
    )
  );
  await waitTX(
    cDAI["mint(uint256)"](ethers.utils.parseUnits("300000000000", "ether"))
  );

  for (let day = 0; day < 15; day++) {
    const cdaiBalance = await cDAI
      .balanceOf(accounts[0].address)
      .then((_) => _.toString());
    console.log("transfering cdai to staking day:", { day, cdaiBalance });

    await waitTX(
      cDAI.transfer(simpleStaking, ethers.utils.parseUnits("30", "gwei")) //300 cdai
    );
    let stakingBalance = await cDAI
      .balanceOf(simpleStaking)
      .then((_) => _.toString());

    console.log("collecting interest...", { stakingBalance });

    await goodFundManager.collectInterest([simpleStaking]);

    console.log("claiming");

    await ubi.connect(accounts[day > 9 ? 9 : day]).claim();

    await increaseTime(60 * 60 * 24).catch((e) =>
      console.log("nextday failed", e)
    );
  }
};

simulate().catch(console.log);
