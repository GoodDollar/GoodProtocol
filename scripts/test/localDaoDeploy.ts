/***
 * deploy complete DAO for testing purposes.
 * for example run:
 * npx hardhat run scripts/test/localDaoDeploy.ts  --network develop
 * then to test upgrade process locally run:
 * npx hardhat run scripts/upgradeToV2/upgradeToV2.ts  --network develop
 */
import { ethers } from "hardhat";
import { createDAO, deployUBI, deployOldVoting } from "../../test/helpers";
import releaser from "../releaser";

const deploy = async () => {
  console.log("dao deploying...");
  //TODO: modify to deploy old DAO contracts version ie Reserve to truly simulate old DAO
  const dao = await createDAO();
  console.log("dao deployed");
  const ubi = await deployUBI(dao);
  console.log("ubi deployed");
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
    network: "develop",
    networkId: 4447
  };
  releaser(release, "develop");
};
deploy().catch(console.log);
