import { last, range, sortBy } from "lodash";
import PromisePool from "async-promise-pool";
import fs from "fs";
import { ethers } from "hardhat";

const main = async () => {
  let result = [];
  let balances = {};
  let lastAddr = ethers.constants.AddressZero;

  const graphQuery = async (start, skip) => {
    const query = `{
      goodBalances(first:1000 orderBy:id orderDirection: asc where:{id_gt:"${start}" }) {
          id
          coreBalance
          totalVotes
        }
      }`;
    // console.log({ query });
    try {
      const { data = {}, errors } = await fetch("https://api.thegraph.com/subgraphs/name/gooddollar/gooddollarfuse2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query })
      }).then(_ => _.json());
      errors && console.log({ errors });
      if (data?.goodBalances?.length === 1000) {
        const nextAddr = last(data?.goodBalances).id;
        console.log("fetching next page:", nextAddr);
        return data.goodBalances.concat(await graphQuery(nextAddr, 0));
      }
      return data.goodBalances || [];
    } catch (error) {
      console.log({ query, error });
      return [];
    }
  };
  const goodBalances = await graphQuery(lastAddr, 0);
  console.log("goodBalances:", goodBalances.length);
  fs.writeFileSync("goodBalances.json", JSON.stringify(goodBalances));
  //   console.log({ lastUsed });
};

main().catch(e => console.log(e));
