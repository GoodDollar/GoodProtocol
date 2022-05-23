import { request, gql } from "graphql-request";
import fetch from "node-fetch";

let txCount = {};
const fetchSwaps = async (to, url, pair) => {
  let from = to - 60 * 60 * 24;
  //0xa02ed9fe9e3351fe2cd1f588b23973c1542dcbcc
  //0x8d441c2ff54c015a1be22ad88e5d42efbec6c7ef
  const query = gql`
    {
        swaps(first:1000 where:{pair: "${pair}", timestamp_gt:${from}, timestamp_lte:${to}}) {
          to
        }
      }
    `;

  const { swaps } = await request(
    url,
    // "https://api.thegraph.com/subgraphs/name/fuseio/fuseswap",
    //"https://api.thegraph.com/subgraphs/name/voltfinance/voltage-exchange",
    query
  );
  swaps.forEach(({ to }) => (txCount[to] = (txCount[to] || 0) + 1));
  console.log(swaps.length);
  //   if (from < 1646925850) return;
  if (from < 1604823310) return;
  return fetchSwaps(from, url, pair);
};
//1652752130

const main = async () => {
  await Promise.all([
    fetchSwaps(
      1652755140,
      "https://api.thegraph.com/subgraphs/name/fuseio/fuseswap",
      "0x8d441c2ff54c015a1be22ad88e5d42efbec6c7ef"
    ).then(_ => console.log({ txCount, unique: Object.keys(txCount).length })),
    fetchSwaps(
      1652755140,
      "https://api.thegraph.com/subgraphs/name/voltfinance/voltage-exchange",
      "0xa02ed9fe9e3351fe2cd1f588b23973c1542dcbcc"
    ).then(_ => console.log({ txCount, unique: Object.keys(txCount).length }))
  ]);

  console.log("final:", { txCount, unique: Object.keys(txCount).length });
};
main();
