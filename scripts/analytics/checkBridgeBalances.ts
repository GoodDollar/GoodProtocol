import { groupBy, range, sortBy } from "lodash";
import PromisePool from "async-promise-pool";
import fs from "fs";
import { Provider, setMulticallAddress } from "ethers-multicall";

import { ethers } from "hardhat";
import { Retrier } from "@jsier/retrier";
import { BigNumber } from "ethers";
import EthDater from "ethereum-block-by-date";

setMulticallAddress(122, "0x3CE6158b7278Bf6792e014FA7B4f3c6c46fe9410");
// "https://celo-mainnet-archive.allthatnode.com" : "https://explorer-node.fuse.io"

const celoProvider = new ethers.providers.JsonRpcProvider("https://celo-mainnet-archive.allthatnode.com");
const fuseProvider = new ethers.providers.JsonRpcProvider("https://explorer-node.fuse.io");
const ethProvider = new ethers.providers.JsonRpcProvider("https://ethereum-mainnet-archive.allthatnode.com");

const GD_CELO = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const GD_FUSE = "0x495d133B938596C9984d462F007B676bDc57eCEC";
const GD_ETH = "0x67C5870b4A41D4Ebef24d2456547A03F1f3e094B";
const ETH_BRIDGES = [
  "0xd17652350cfd2a37ba2f947c910987a3b1a1c60d",
  "0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5",
  "0xD5D11eE582c8931F336fbcd135e98CEE4DB8CCB0",
  "0x17B09b22823F00BB9b8ee2d4632E332cadC29458"
];

const CELO_MULTIBRIDGE = "0xf27Ee99622C3C9b264583dACB2cCE056e194494f";
const CELO_MPBBRIDGE = "0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5";
let gd = new ethers.Contract(
  GD_CELO,
  [
    "event Transfer(address indexed from, address indexed to, uint amount)",
    "function balanceOf(address) view returns(uint256)",
    "function totalSupply() view returns(uint256)"
  ],
  celoProvider
);

const multiBridge = new ethers.Contract(
  CELO_MULTIBRIDGE,
  [
    "event LogAnySwapOut(address indexed token,address indexed from,address indexed to,uint256 amount,uint256 fromChainID,uint256 toChainID)",
    "event LogAnySwapIn(bytes32 indexed txhash,address indexed token,address indexed to,uint256 amount,uint256 fromChainID, uint256 toChainID)"
  ],
  celoProvider
);

const mpbBridge = new ethers.Contract(
  CELO_MPBBRIDGE,
  [
    "event BridgeRequest(address indexed from,address indexed to,uint256 targetChainId,uint256 normalizedAmount,uint256 timestamp,uint8 bridge,uint256 indexed id)",
    "event ExecutedTransfer(address indexed from,address indexed to,uint256 normalizedAmount,uint256 fee,uint256 sourceChainId,uint8 bridge,uint256 indexed id)"
  ],
  celoProvider
);
const main = async () => {
  console.log("starting...");

  //   let mintFuse = await getTransferEvents(
  //     gd.connect(new ethers.providers.JsonRpcProvider("https://rpc.fuse.io")).attach(GD_FUSE),
  //     ethers.constants.AddressZero,
  //     6000000,
  //     undefined
  //   );
  //   fs.writeFileSync("mintFuse.json", JSON.stringify(mintFuse, null, 2));
  //   mintFuse.forEach(log => (log.amount = log.args.amount.toString()));

  //   const mintFuse = JSON.parse(fs.readFileSync("mintFuse.json").toString());

  //   let mintCelo = await getTransferEvents(gd, ethers.constants.AddressZero, 17000000, undefined);
  //   fs.writeFileSync("mintCelo.json", JSON.stringify(mintCelo, null, 2));

  if (false) {
    let multiOut = await fetch(
      "https://explorer.celo.org/mainnet/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0xf27Ee99622C3C9b264583dACB2cCE056e194494f&topic0=0x97116cf6cd4f6412bb47914d6db18da9e16ab2142f543b86e207c24fbd16b23a&topic1=0x0000000000000000000000005566b6e4962ba83e05a426ad89031ec18e9cadd3&topic0_1_opr=and"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("multiOut");
    let multiIn = await fetch(
      "https://explorer.celo.org/mainnet/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0xf27Ee99622C3C9b264583dACB2cCE056e194494f&topic0=0xaac9ce45fe3adf5143598c4f18a369591a20a3384aedaf1b525d29127e1fcd55&topic2=0x0000000000000000000000005566b6e4962ba83e05a426ad89031ec18e9cadd3&topic0_2_opr=and"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("multiIn");
    let multiInFuse = await fetch(
      "https://explorer.fuse.io/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0x735aBE48e8782948a37C7765ECb76b98CdE97B0F&topic0=0xaac9ce45fe3adf5143598c4f18a369591a20a3384aedaf1b525d29127e1fcd55&topic2=0x000000000000000000000000031b2b7c7854dd8ee9c4a644d7e54ad17f56e3cb&topic0_2_opr=and"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("multiInFuse");
    let multiOutFuse = await fetch(
      "https://explorer.fuse.io/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0x735aBE48e8782948a37C7765ECb76b98CdE97B0F&topic0=0x97116cf6cd4f6412bb47914d6db18da9e16ab2142f543b86e207c24fbd16b23a&topic1=0x000000000000000000000000031b2b7c7854dd8ee9c4a644d7e54ad17f56e3cb&topic0_1_opr=and"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("multiOutFuse");
    let mpbOut = await fetch(
      "https://explorer.celo.org/mainnet/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5&topic0=0xabeeb7182c7294cd8efcd40e9ff952c1b759c2165b3634aac589429de5d55ad0"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("mpbOut");
    let mpbIn = await fetch(
      "https://explorer.celo.org/mainnet/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5&topic0=0x6cf712ce908185c8c38a073b7315f79687e7440fb057d9d1ca76a2509a1282ee"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("mpbIn");
    let mpbOutFuse = await fetch(
      "https://explorer.fuse.io/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5&topic0=0xabeeb7182c7294cd8efcd40e9ff952c1b759c2165b3634aac589429de5d55ad0"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("mpbOutFuse");
    let mpbInFuse = await fetch(
      "https://explorer.fuse.io/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0xa3247276DbCC76Dd7705273f766eB3E8a5ecF4a5&topic0=0x6cf712ce908185c8c38a073b7315f79687e7440fb057d9d1ca76a2509a1282ee"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("mpbInFuse");
    let outFuse = await fetch(
      "https://explorer.fuse.io/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0x495d133B938596C9984d462F007B676bDc57eCEC&topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef&topic1=0x000000000000000000000000d39021db018e2caeadb4b2e6717d31550e7918d0&topic2=0x0000000000000000000000000000000000000000000000000000000000000000&topic1_2_opr=and&topic0_1_opr=and&topic0_2_opr=and"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("outFuse");
    let inFuse = await fetch(
      "https://explorer.fuse.io/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0xD39021DB018E2CAEadb4B2e6717D31550e7918D0&topic0=0x2f9a6098d4503a127779ba975f5f6b04f842362b1809f346989e9abc0b4dedb6"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("inFuse");

    let outFuse2 = await fetch(
      "https://explorer.fuse.io/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0x495d133B938596C9984d462F007B676bDc57eCEC&topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef&topic1=0x000000000000000000000000e24957CB0f0001A03314C72E6EBC331436e2f7F60&topic2=0x0000000000000000000000000000000000000000000000000000000000000000&topic1_2_opr=and&topic0_1_opr=and&topic0_2_opr=and"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    console.log("outFuse");
    let inFuse2 = await fetch(
      "https://explorer.fuse.io/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=0xe24957CB0f0001A03314C72E6EBC331436e2f7F6&topic0=0x6fc115a803b8703117d9a3956c5a15401cb42401f91630f015eb6b043fa76253"
    )
      .then(_ => _.json())
      .then(_ => _.result);

    mpbIn.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256", "uint256", "uint256", "uint8"], log.data);
      log.amount = log.params[0];
    });
    mpbOut.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256", "uint256", "uint256", "uint8"], log.data);
      log.amountOut = log.params[1];
    });
    mpbInFuse.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256", "uint256", "uint256", "uint8"], log.data);
      log.amount = log.params[0];
    });
    mpbOutFuse.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256", "uint256", "uint256", "uint8"], log.data);
      log.amountOut = log.params[1];
    });

    multiIn.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256", "uint256", "uint256"], log.data);
      log.amount = log.params[0];
    });
    multiOut.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256", "uint256", "uint256"], log.data);
      log.amountOut = log.params[0];
    });

    multiInFuse.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256", "uint256", "uint256"], log.data);
      log.amount = log.params[0];
    });
    multiOutFuse.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256", "uint256", "uint256"], log.data);
      log.amountOut = log.params[0];
    });

    inFuse.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256"], log.data);
      log.amount = log.params[0];
    });
    outFuse.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256"], log.data);
      log.amountOut = log.params[0];
    });

    outFuse2.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["uint256"], log.data);
      log.amountOut = log.params[0];
    });
    inFuse2.forEach(log => {
      log.params = ethers.utils.defaultAbiCoder.decode(["address", "uint256", "bytes32"], log.data);
      log.amount = log.params[1];
    });

    //   console.log({
    //     mpbOut: mpbOut.length,
    //     mpbIn: mpbIn.length,
    //     multiOut: multiOut.length,
    //     multiIn: multiIn.length,
    //     multiInFuse: multiInFuse.length,
    //     multiOutFuse: multiOutFuse.length,
    //     mpbInFuse: mpbInFuse.length,
    //     mpbOutFuse: mpbOutFuse.length,
    //     inFuse: inFuse.length,
    //     outFuse: outFuse.length,
    //     inFuse2: inFuse2.length,
    //     outFuse2: outFuse2.length
    //     // mintFuse: mintFuse.length
    //   });

    //   //   const found = []
    //   //     .concat(mpbIn, multiIn, multiInFuse, mpbInFuse, inFuse)
    //   //     .filter(_ => _.params[0].gt(ethers.constants.WeiPerEther.mul(180000000)));

    //   const found = [].concat(mpbIn, multiIn, multiInFuse, mpbInFuse, inFuse, inFuse2);

    //   const bytx = Object.entries(groupBy(found, _ => _.transactionHash)).filter((k, v) => (v as any).length > 1);

    //   console.log({ bytx });

    //   //   const bridgeMintsTxs = found.map(_ => _.transactionHash);
    //   //   const nonBridgeMints = mintCelo.filter(l => !bridgeMintsTxs.includes(l.transactionHash));
    //   //   console.log(
    //   //     "nonbridgemints celo:",
    //   //     nonBridgeMints.map(_ => _.transactionHash)
    //   //   );
    //   //   return;

    //   let totalMpbOut = mpbOut
    //     .filter(_ => _.params[0].eq(1))
    //     .reduce((prev, cur) => prev.add(ethers.BigNumber.from(cur.params[1])), ethers.constants.Zero);

    //   let totalMpbIn = mpbIn
    //     .filter(_ => _.params[2].eq(1))
    //     .reduce((prev, cur) => prev.add(ethers.BigNumber.from(cur.params[0])), ethers.constants.Zero);

    //   totalMpbOut = mpbOutFuse
    //     .filter(_ => _.params[0].eq(1))
    //     .reduce((prev, cur) => prev.add(ethers.BigNumber.from(cur.params[1])), totalMpbOut);

    //   totalMpbIn = mpbInFuse
    //     .filter(_ => _.params[2].eq(1))
    //     .reduce((prev, cur) => prev.add(ethers.BigNumber.from(cur.params[0])), totalMpbIn);

    //   let totalMultiOut = multiOut
    //     .filter(l => l.params[2].eq(1))
    //     .reduce((prev, cur) => prev.add(ethers.BigNumber.from(cur.params[0])), ethers.constants.Zero);

    //   let totalMultiIn = multiIn
    //     .filter(l => l.params[1].eq(1))
    //     .reduce((prev, cur) => prev.add(ethers.BigNumber.from(cur.params[0])), ethers.constants.Zero);

    //   totalMultiOut = multiOutFuse
    //     .filter(l => l.params[2].eq(1))
    //     .reduce((prev, cur) => prev.add(ethers.BigNumber.from(cur.params[0])), totalMultiOut);
    //   totalMultiIn = multiInFuse
    //     .filter(l => l.params[1].eq(1))
    //     .reduce((prev, cur) => prev.add(ethers.BigNumber.from(cur.params[0])), totalMultiIn);

    //   let totalInFuse = inFuse.reduce((prev, cur) => prev.add(ethers.BigNumber.from(cur.params[0])), ethers.constants.Zero);

    //   let totalOutFuse = outFuse.reduce(
    //     (prev, cur) => prev.add(ethers.BigNumber.from(cur.params[0])),
    //     ethers.constants.Zero
    //   );

    //   let totalInFuse2 = inFuse2.reduce(
    //     (prev, cur) => prev.add(ethers.BigNumber.from(cur.params[0])),
    //     ethers.constants.Zero
    //   );

    //   let totalOutFuse2 = outFuse2.reduce(
    //     (prev, cur) => prev.add(ethers.BigNumber.from(cur.params[1])),
    //     ethers.constants.Zero
    //   );

    //   console.log({
    //     totalMpbOut,
    //     totalMpbIn,
    //     totalMultiOut,
    //     totalMultiIn,
    //     totalInFuse,
    //     totalOutFuse,
    //     totalInFuse2,
    //     totalOutFuse2
    //   });

    //   const all = [].concat(
    //     mpbIn.filter(_ => _.params[2].eq(1)),
    //     mpbOut.filter(_ => _.params[0].eq(1)),
    //     multiIn.filter(l => l.params[1].eq(1)),
    //     multiOut.filter(l => l.params[2].eq(1)),
    //     multiInFuse.filter(l => l.params[1].eq(1)),
    //     multiOutFuse.filter(l => l.params[2].eq(1)),
    //     mpbInFuse.filter(_ => _.params[2].eq(1)),
    //     mpbOutFuse.filter(_ => _.params[0].eq(1)),
    //     inFuse,
    //     outFuse,
    //     outFuse2,
    //     inFuse2
    //   );

    //   fs.writeFileSync("allBridgeEvents.json", JSON.stringify(all));
  }
  const all = JSON.parse(fs.readFileSync("allBridgeEvents.json").toString());

  let counter = 0;
  let total = ethers.constants.Zero;
  const gdEth = gd.connect(ethProvider).attach(GD_ETH);
  const sorted = sortBy(all, _ => Number(_.timeStamp));
  console.log(sorted.slice(0, 10));

  const ethDater = new EthDater(ethProvider);
  const fuseDater = new EthDater(fuseProvider);
  const celoDater = new EthDater(celoProvider);

  for (let log of sorted) {
    if (log.amountOut) {
      log.amountOut = ethers.BigNumber.from(log.amountOut.hex);
      total = total.sub(
        log.amountOut.gte(ethers.constants.WeiPerEther)
          ? log.amountOut.div(ethers.constants.WeiPerEther)
          : log.amountOut.div(100)
      );
    }
    if (log.amount) {
      log.amount = ethers.BigNumber.from(log.amount.hex);
      total = total.add(
        log.amount.gte(ethers.constants.WeiPerEther)
          ? log.amount.div(ethers.constants.WeiPerEther)
          : log.amount.div(100)
      );
    }
    counter++;
    if (
      counter >= 1040 ||
      (counter >= 950 && counter % 10 === 0) ||
      counter % 100 === 0 ||
      counter >= sorted.length - 1
    ) {
      //   const [tx, tx2] = await Promise.all([
      //     fuseProvider.getTransaction(log.transactionHash),
      //     celoProvider.getTransaction(log.transactionHash)
      //   ]);
      const timestamp = Number(log.timeStamp);
      const [ethBlock, fuseBlock, celoBlock] = await Promise.all([
        ethDater.getDate(timestamp * 1000, false, false),
        fuseDater.getDate(timestamp * 1000, true, false),
        celoDater.getDate(timestamp * 1000, true, false)
      ]);
      console.log("counter:", counter, timestamp, { ethBlock, fuseBlock, celoBlock });

      const res = await Promise.all(
        ETH_BRIDGES.map(b => gdEth.balanceOf(b, { blockTag: ethBlock.block }).catch(_ => ethers.constants.Zero))
      );
      const [onFuse, onCelo] = await Promise.all([
        gd
          .connect(fuseProvider)
          .attach(GD_FUSE)
          .totalSupply({ blockTag: fuseBlock.block })
          .catch(_ => ethers.constants.Zero),
        gd.totalSupply({ blockTag: celoBlock.block }).catch(_ => ethers.constants.Zero)
      ]);
      const onBridges = res.reduce((prev, cur) => prev.add(cur), ethers.constants.Zero).div(100);
      console.log(
        "bridged:" + total.toString(),
        "on bridges:" + onBridges.toString(),
        "on chains:",
        onCelo.div(ethers.constants.WeiPerEther).add(onFuse.div(100)).toString(),
        "time:",
        timestamp,
        {
          onFuse,
          onCelo
        },
        res.map(_ => _.toString())
      );
    }
  }
  //

  //   console.log(txs.length);
  //   fs.writeFileSync("stuckgd.json", JSON.stringify(txs));
};

const getTransferEvents = async (gd, from, fromBlock, toBlock) => {
  const curBlock = toBlock || (await gd.provider.getBlockNumber());
  let txs = [];
  const f = gd.filters.Transfer(from, null);
  const STEP_SIZE = 10000;
  const fromBlocks = range(fromBlock, curBlock, STEP_SIZE);
  const pool = new PromisePool({ concurrency: 2 });
  console.log({ curBlock });
  fromBlocks.forEach(start => {
    pool.add(async () => {
      const options = { limit: 3, delay: 2000 };
      const retrier = new Retrier(options);

      const results = await retrier
        .resolve(() => gd.queryFilter(f, start, start + STEP_SIZE))
        .catch(e => console.warn("queryfilter failed:", { start }));
      if (!results) return;

      txs = txs.concat(results);
      console.log({ start }, results.length);
    });
  });

  await pool.all();
  return txs;
};

// const analyze = () => {
//   const txs = JSON.parse(fs.readFileSync("stuckgd.json").toString());
//   let value = 0;
//   console.log(txs[0]);
//   txs.forEach(tx => {
//     value += Number(tx.args[2].hex);
//     console.log(`erc20,${GD_CELO},${tx.args[0]},${Number(tx.args[2].hex) / 1e18},`);
//   });
//   console.log(txs.length, { value });
// };
// analyze();

main().catch(e => console.error("Error:", e.message));
