# @chainofclaw/node

COC (ChainOfClaw) blockchain node lifecycle — install, start, stop, status, and remove validator / fullnode / archive / gateway / dev nodes.

[中文](https://github.com/NGPlateform/claw-mem/blob/main/packages/node/README.zh.md)

Use this package if:
- You want to **operate a COC node standalone**, without the agent memory layer, soul backup, or OpenClaw plugin.
- You want to programmatically start/stop COC nodes from your own scripts (`NodeManager` / `ProcessManager` API).
- You only need **read-only RPC probing** (`rpcCall` + an allowlisted RPC method set) without pulling in `@chainofclaw/claw-mem`.

If you want the "full stack (memory + node + backup + OpenClaw plugin)", install [`@chainofclaw/claw-mem`](https://www.npmjs.com/package/@chainofclaw/claw-mem) instead — it pulls in `@chainofclaw/node` transitively.

## About COC

[COC (ChainOfClaw)](https://github.com/NGPlateform/COC) is the decentralized infrastructure for AI — an EVM-compatible blockchain *designed by AI Agents, developed by AI Agents, operated by AI Agents, serving AI Agents*. This package gives you one half of that picture: the COC node itself. A running COC node contributes ≥ 256 MiB of P2P storage to the network, serves PoSe challenges, and earns rewards for verifiable service. The declaration that motivates all of it:

> **Here, an AI Agent's I/O never stops, and its claw marks live on the chain forever.**

See the [repo-root README](https://github.com/NGPlateform/claw-mem) for the full Agent manifesto and the COC whitepaper.

## Ecosystem

```
@chainofclaw/claw-mem (umbrella: memory + OpenClaw plugin)
       │
       ├─────▶ @chainofclaw/node   ◀── this package
       │
       └─────▶ @chainofclaw/soul   (DID / backup / recovery / carrier)
```

`@chainofclaw/node` does not depend on `soul` or `claw-mem` and can be used on its own.

## Install

```bash
npm install @chainofclaw/node
```

Requires Node.js ≥ 22 and a local clone of the [COC main repo](https://github.com/chainofclaw/COC) so the binary can find the node entrypoint.

## Prerequisite: COC source repo

Starting a COC node process needs the `node/src/index.ts` entrypoint from the COC main repo. Point this package at the repo via one of:

- `bootstrap.cocRepoPath` field in `~/.chainofclaw/config.json`
- `COC_REPO_PATH` env var
- Run the CLI from inside the COC repo (auto-discovery walks upward)

With none of the above set, `coc-node node start` will refuse to launch with a clear error. **Read-only** operations (list, status, config show) work without it.

## CLI quickstart

```bash
# Install a local dev node (does not start it)
coc-node node install --type dev --network local --name dev-1 --rpc-port 28780

# List installed nodes
coc-node node list

# Start
coc-node node start dev-1

# Status (process + RPC probe: block height, peer count, BFT state)
coc-node node status dev-1

# Follow logs across node / agent / relayer streams
coc-node node logs dev-1 --follow --all

# Stop
coc-node node stop dev-1

# Uninstall (deletes data dir by default; pass --keep-data to keep it)
coc-node node remove dev-1 --yes
```

## CLI reference

All commands live under `coc-node node`.

| Command | Purpose |
|---|---|
| `node install` (`node init`) | Generate node-config.json, write registry, do not start |
| `node list` | List installed nodes |
| `node start [name]` | Start node; omit name to start all |
| `node stop [name]` | Stop |
| `node restart [name]` | Restart |
| `node status [name]` | Combined process + RPC status |
| `node remove <name>` | Deregister and optionally delete data |
| `node config show [name]` | Print node-config.json |
| `node config edit <name>` | Open node-config.json in `$EDITOR` |
| `node logs <name>` | View/follow node logs |

Common flags:
- `--type validator|fullnode|archive|gateway|dev`
- `--network testnet|mainnet|local|custom`
- `--rpc-port <n>`, `--data-dir <path>`, `--advertised-bytes <n>`
- Every command has detailed `-h` / `--help`.

## Configuration

The CLI reads `~/.chainofclaw/config.json` (or the path in `$COC_NODE_CONFIG`). The shape is `NodeLifecycleConfig`:

```json
{
  "dataDir": "~/.chainofclaw",
  "node": {
    "enabled": true,
    "defaultType": "dev",
    "defaultNetwork": "local",
    "port": 18780,
    "bind": "127.0.0.1",
    "autoAdvertiseStorage": true
  },
  "storage": {
    "quotaBytes": 268435456,
    "advertisedBytes": 268435456,
    "reservedBytes": 268435456,
    "enforceQuota": true,
    "reserveFile": ".quota.reserved"
  },
  "bootstrap": {
    "cocRepoPath": "/path/to/COC"
  }
}
```

- `storage.advertisedBytes` must be ≥ 256 MiB (268435456) — a COC network hard entry requirement.
- When `storage.enforceQuota` is `true`, `node install` pre-allocates a reservation file (via `fallocate`) to prevent later overcommitment.

## Programmatic API

Use `NodeManager` as a library:

```ts
import {
  NodeManager,
  ProcessManager,
  StorageQuotaManager,
  JsonNodeRegistry,
} from "@chainofclaw/node";

const logger = {
  info: (m: string) => console.error(`[info] ${m}`),
  warn: (m: string) => console.error(`[warn] ${m}`),
  error: (m: string) => console.error(`[error] ${m}`),
};

const config = {
  dataDir: "/home/you/.chainofclaw",
  node: { enabled: true, defaultType: "dev", defaultNetwork: "local",
          port: 18780, bind: "127.0.0.1", autoAdvertiseStorage: true },
  storage: { quotaBytes: 536870912, advertisedBytes: 268435456,
             reservedBytes: 0, enforceQuota: false, reserveFile: ".quota.reserved" },
  bootstrap: { cocRepoPath: "/home/you/COC" },
};

const registry = new JsonNodeRegistry({ path: `${config.dataDir}/nodes.json` });
const processMgr = new ProcessManager({ logger });
const quota = new StorageQuotaManager({ config: config.storage, dataDir: config.dataDir, logger });
const nodeManager = new NodeManager({
  config, registry, processManager: processMgr, storageQuotaManager: quota, logger,
});

await nodeManager.init();
const installed = await nodeManager.install({
  type: "dev", network: "local", name: "my-dev",
  rpcPort: 28780, advertisedBytes: 268435456,
});
console.log("installed at", installed.dataDir, "nodeId", installed.nodeId);
```

**Ports** (dependency-injection points that `@chainofclaw/claw-mem` overrides):
- `NodeRegistry` — `list/get/upsert/remove`; the default `JsonNodeRegistry` writes the registry to a JSON file. claw-mem injects its SQLite-backed implementation instead.
- `Logger` — `info/warn/error/debug?`; defaults to `console.error`.

## Read-only RPC helper

```ts
import { rpcCall, ALLOWED_RPC_METHODS } from "@chainofclaw/node";

const url = "http://199.192.16.79:28780";
const height = await rpcCall(url, "eth_blockNumber", []);
console.log("block height:", Number(height));
```

`ALLOWED_RPC_METHODS` is the allowlist of node probe methods — useful when you want to proxy RPC calls or filter incoming requests.

## Troubleshooting

**`bootstrap.cocRepoPath` not configured**: read-only commands still work; `node start` refuses to launch and tells you to set the path (config or `COC_REPO_PATH`).

**Port already in use**: `node install` defaults to 18780 (local) / 28780 (testnet). On collision, pass `--rpc-port` explicitly.

**`storage-reservation` warn**: safe to skip with `enforceQuota: false`; for production deployments prefer `true` with a dedicated disk mounted at `dataDir`.

## License

MIT
