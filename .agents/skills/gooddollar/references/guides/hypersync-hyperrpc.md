# Envio HyperSync and HyperRPC

Use this guide when the task is high-volume historical blockchain data fetch (events, blocks, txs), especially analytics and indexing workflows.

## Official docs

- HyperSync overview: [docs.envio.dev/docs/HyperSync/overview](https://docs.envio.dev/docs/HyperSync/overview)
- HyperRPC overview: [docs.envio.dev/docs/HyperRPC/overview-hyperrpc](https://docs.envio.dev/docs/HyperRPC/overview-hyperrpc)
- HyperRPC supported networks: [docs.envio.dev/docs/HyperRPC/hyperrpc-supported-networks](https://docs.envio.dev/docs/HyperRPC/hyperrpc-supported-networks)

## What to use

- **HyperSync**: preferred for new data pipelines and heavy historical scans.
- **HyperRPC**: read-only JSON-RPC drop-in for existing RPC code paths.

## HyperRPC vs HyperSync (avoid mixing them up)

- **HyperRPC** is a **hosted JSON-RPC URL** (same methods as `eth_getLogs`, `eth_blockNumber`, and so on). Any HTTP client or existing RPC stack can call it; put the API token in the URL path as Envio documents.
- **HyperSync** is a **separate high-throughput query API** used through **Envio client libraries** (for example `@envio-dev/hypersync-client` in Node). It is **not** “just another RPC endpoint” with the same ergonomics as a one-line `fetch` to `eth_getLogs` at large scale.

## Decision rule

1. For GoodDollar protocol history that exists on subgraphs, query the subgraph first and validate fields in `references/subgraphs/*-guide.md`.
2. If subgraph schema or freshness cannot satisfy the request, use **HyperSync** for large scans and pipelines, or **HyperRPC** when you must stay inside standard JSON-RPC.
3. For write operations (sending tx), use normal RPC providers; HyperRPC is read-only.

## GoodDollar-relevant network coverage

- Celo and XDC are supported on HyperRPC.
- Fuse is not currently listed; treat this as non-blocking and use existing providers for Fuse.

## Access and auth

- HyperRPC/HyperSync usage is account-based.
- HyperRPC requires an API key for reliable production use.
- Requests without API token are rate-limited and should be treated as non-production fallback only.
- Add API key in endpoint URL as documented by Envio.
- HyperRPC token pattern example from docs: `https://<chain>.rpc.hypersync.xyz/<api-token>`

## Agents: Envio API token when HyperSync is the best option

After you decide **HyperSync** is the right tool for the user query (for example large historical scans or pipeline-scale log pulls where subgraphs are insufficient), check for a usable Envio credential in the execution environment (`ENVIO_API_TOKEN` for `@envio-dev/hypersync-client`, or the token Envio documents for your chosen URL pattern).

If **no** Envio API token is available and you cannot complete the HyperSync path without it, **stop and explicitly ask the user** to provide an Envio API token (name the env var you need, typically `ENVIO_API_TOKEN`). Do not silently rely on anonymous or heavily rate-limited access as a substitute when HyperSync was already identified as the best approach.

## Practical use in this repo

- Keep subgraphs as first option for indexed protocol entities.
- Use HyperSync/HyperRPC when subgraph coverage is missing, stale, or insufficient for bulk historical pulls.
- When an agent chooses **HyperSync** as the best path and no Envio API token is available, follow **Agents: Envio API token when HyperSync is the best option** in this file and ask the user for `ENVIO_API_TOKEN` before proceeding.
- Keep contract addresses from [GoodProtocol/deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) only; use GoodDocs for product context, not for resolving contract addresses.
- For implementation details (client setup, query structure, supported methods), follow the Envio docs links above directly.

## From block for historical fetches

For **`eth_getLogs`**, HyperRPC, and HyperSync range queries, the lower bound is **`fromBlock`** (or the client’s equivalent). Prefer the deployment’s **`creationBlock`** from the matching row in `references/contracts/*.abi.yaml` (or **`meta.deploymentCreationBlocks`** where deployments are plain address strings) so scans do not start at genesis when you only need post-deploy history. Field placement for **`creationBlock`** is defined in `references/contracts/_rich-abi-yaml-format.md`. If you cannot determine the creation block, **`fromBlock` 0** is valid.

## Prebuilt scripts (developers and local agents)

These scripts avoid rediscovering HyperRPC wiring on every task. They require **Node.js 18 or newer** (global `fetch`). Paths like `scripts/...` are relative to the **GoodSkills repository root** (the directory that contains both `skills/` and `scripts/`), not relative to `skills/gooddollar/` alone.

### Last N Identity `WhitelistedAdded` logs via HyperRPC

- Script: `scripts/fetch-whitelist-events-hyperrpc.mjs`
- Default `EVENT_TOPIC0` matches `WhitelistedAdded(address)` on `IdentityV4`; override `EVENT_TOPIC0` for other events.
- Production Celo defaults: `CONTRACT_ADDRESS` defaults to `Identity` from `production-celo` in [GoodProtocol deployment.json](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) (`0xC361A6E67822a0EDc17D899227dd9FC50BD62F42`). If `HYPERRPC_URL` is unset, the script builds `https://celo.rpc.hypersync.xyz/<token>` from `HYPERRPC_API_TOKEN` or `ENVIO_API_TOKEN`.
- Optional env: `HYPERRPC_URL` (overrides token-based default), `CONTRACT_ADDRESS`, `LIMIT` (default `500`), `STEP` (default `2000`), `FROM_BLOCK` (decimal; omit to read **`creationBlock`** for `CONTRACT_ADDRESS` from `ABI_PATH` or the default `skills/gooddollar/references/contracts/IdentityV4.abi.yaml`), `ABI_PATH`, `TO_BLOCK` (default `latest`). **`fromBlock`** behavior is described in **From block for historical fetches** above.

```bash
cd /path/to/GoodSkills
export HYPERRPC_API_TOKEN='<api-token>'
node scripts/fetch-whitelist-events-hyperrpc.mjs
```

Web-only assistants without a shell cannot run the file; they should return the same env keys and command text so the user runs it locally.

## HyperSync client minimal path (install required)

HyperSync uses the official client. Install and query pattern (Celo example URLs from [Envio Celo docs](https://docs.envio.dev/docs/HyperIndex/celo)):

```bash
npm install @envio-dev/hypersync-client
export ENVIO_API_TOKEN='<api-token>'
```

Save as a `.mjs` file (or use `"type": "module"` in a local `package.json`) and run with `node`:

```javascript
import { HypersyncClient, presetQueryLogsOfEvent } from "@envio-dev/hypersync-client";

const client = new HypersyncClient({
  url: "https://celo.hypersync.xyz",
  apiToken: process.env.ENVIO_API_TOKEN,
});

const identity = "0x...";
const whitelistedAddedTopic0 =
  "0xee1504a83b6d4a361f4c1dc78ab59bfa30d6a3b6612c403e86bb01ef2984295f";

const fromBlock = 17237952;
const toBlock = await client.getHeight();

const query = presetQueryLogsOfEvent(identity, whitelistedAddedTopic0, fromBlock, toBlock);
const res = await client.get(query);
console.log(res.data.logs.length);
```

The example **`fromBlock`** matches **`creationBlock`** for production Celo Identity in `skills/gooddollar/references/contracts/IdentityV4.abi.yaml`; see **From block for historical fetches** above.

Full API and streaming patterns: [HyperSync clients](https://docs.envio.dev/docs/HyperSync/hypersync-clients) and the package README for `@envio-dev/hypersync-client`.
