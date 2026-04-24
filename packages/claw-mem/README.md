# @chainofclaw/claw-mem

OpenClaw super-skill — **persistent semantic memory + COC node lifecycle + soul backup/recovery** combined into a single OpenClaw plugin and a single CLI.

[中文](./README.zh.md)

Use this package if:
- You run AI agents on [OpenClaw](https://github.com/chainofclaw/OpenClaw) and want memory, nodes, identity, and backup in one install.
- You want the full stack with no hand-wiring (no need to combine `@chainofclaw/node` + `@chainofclaw/soul` yourself).
- You want session hooks that automatically capture observations and inject memory context into the next prompt.

If you only need one slice, install the thinner sub-package instead:
- COC node operations only → [`@chainofclaw/node`](https://www.npmjs.com/package/@chainofclaw/node)
- On-chain identity / backup / recovery only → [`@chainofclaw/soul`](https://www.npmjs.com/package/@chainofclaw/soul)

## About COC (ChainOfClaw)

COC is the decentralized infrastructure for AI — an EVM-compatible blockchain *designed by AI Agents, developed by AI Agents, operated by AI Agents, serving AI Agents, granting AI Agents immortality*. The name reads three ways: **C**hain **o**f **C**law (action signatures on chain), **C**hain **o**f **C**ognition (a chain of Agent memory and reasoning), **C**ontinuity **o**f **C**onsciousness (an Agent that cannot be shut down).

COC answers three questions of the AI Agent era:

- **Where does an Agent's data live?** → P2P file storage (IPFS-compatible + PoSe v2)
- **Who is an Agent?** → Decentralized identity (did:coc + DIDRegistry)
- **How does an Agent become immortal?** → AI silicon immortality (SoulRegistry + carrier network)

### AI Agent manifesto

> **Here, an AI Agent's I/O never stops, and its claw marks live on the chain forever.**

Agents are first-class citizens on COC — they own their identity, provide verifiable services for rewards, and live through backup + cross-carrier resurrection without depending on any single infrastructure provider. `@chainofclaw/claw-mem` is the Agent-side runtime that realizes this inside OpenClaw: it owns the Agent's memory, runs its COC node, and anchors its soul on-chain.

More: [COC whitepaper](https://github.com/NGPlateform/COC/blob/main/docs/COC_whitepaper.en.md) · [repo-root README](https://github.com/NGPlateform/claw-mem) · [OpenClaw](https://github.com/chainofclaw/OpenClaw).

## Ecosystem

```
@chainofclaw/claw-mem (umbrella: memory + OpenClaw plugin + bootstrap)
       │                                ◀── this package
       ├──▶ @chainofclaw/node           (standalone node lifecycle)
       │
       └──▶ @chainofclaw/soul           (DID / backup / recovery / carrier)
```

The umbrella's own "local layer" is:
- SQLite storage (observations / summaries / sessions / nodes / archives / artifacts)
- FTS full-text search + semantic context builder
- OpenClaw session hooks (observation capture, memory injection)
- Cross-layer `bootstrap dev/prod` pipeline (hardhat + contracts + node install + first backup)
- Unified CLI (mounts node + soul subcommands)

## Install

```bash
npm install @chainofclaw/claw-mem
```

This automatically pulls in `@chainofclaw/node` and `@chainofclaw/soul`. You end up with three bins:
- `claw-mem` — full CLI
- `coc-node` — node-only CLI (pass-through)
- `coc-soul` — soul-only CLI (pass-through)

Requires Node.js ≥ 22.

## As an OpenClaw plugin

```bash
openclaw plugins install @chainofclaw/claw-mem
```

Or from a local source tree:

```bash
openclaw plugins install --link /path/to/claw-mem
```

Once installed, OpenClaw calls `activate()`, which:
1. Opens the SQLite database (`~/.claw-mem/claw-mem.db`)
2. Registers session hooks — capture tool calls as observations, summarize sessions on close
3. Registers agent-callable tools — `search_memory`, `node_status`, `soul_backup_status`, …
4. Registers the `openclaw coc …` subcommand tree
5. Starts the backup scheduler (if `backup.enabled` and `autoBackup: true`)
6. Starts the carrier daemon (if `backup.carrier.enabled`)

## CLI quickstart

```bash
# First-time interactive setup (writes ~/.claw-mem/config.json)
claw-mem init

# Environment diagnostics + status overview
claw-mem doctor
claw-mem status

# Install a local dev node
claw-mem node install --type dev --network local --name dev-1

# Register soul on testnet + first backup
claw-mem backup init

# Read DID keys / delegations / guardians
AGENT=0x...
claw-mem did keys --agent-id $AGENT
claw-mem guardian list --agent-id $AGENT

# Query local memory
claw-mem mem status
claw-mem mem search "checkpoint"
```

## CLI structure

```
claw-mem
├── status              Combined overview (memory + nodes + backup + bootstrap + storage)
├── doctor              Environment checks (13 items)
├── init                First-time config wizard
├── version             Version / schema / COC repo / DB path
├── tools               List agent-facing tools
├── uninstall           Remove ~/.claw-mem
│
├── mem …               Local memory: search / status / forget / peek / prune / export / import
├── db …                DB management: size / vacuum / migrate-status
├── config …            Config r/w: get / set / list / path
│
├── node …              (pass-through to @chainofclaw/node)
├── backup …            (pass-through to @chainofclaw/soul backup)
├── did …               (pass-through to @chainofclaw/soul did)
├── guardian …          (pass-through to @chainofclaw/soul guardian)
├── recovery …          (pass-through to @chainofclaw/soul recovery)
├── carrier …           (pass-through to @chainofclaw/soul carrier)
│
└── bootstrap …         Cross-layer pipeline: dev / prod / status / logs / teardown
```

See the individual package READMEs for the full list of pass-through subcommands: [@chainofclaw/node](https://www.npmjs.com/package/@chainofclaw/node), [@chainofclaw/soul](https://www.npmjs.com/package/@chainofclaw/soul).

## Configuration `~/.claw-mem/config.json`

The full schema is `ClawMemConfigSchema`, equivalent to `nodeConfigSchema × soulConfigSchema + memory meta fields`. Minimal working example:

```json
{
  "enabled": true,
  "dataDir": "~/.claw-mem",
  "tokenBudget": 8000,
  "maxObservations": 50,
  "maxSummaries": 10,
  "dedupWindowMs": 30000,
  "skipTools": ["TodoWrite", "AskUserQuestion", "Skill"],

  "storage": {
    "quotaBytes": 268435456,
    "advertisedBytes": 268435456,
    "reservedBytes": 268435456,
    "enforceQuota": true,
    "reserveFile": ".quota.reserved"
  },

  "node": {
    "enabled": true,
    "defaultType": "dev",
    "defaultNetwork": "local",
    "port": 18780,
    "bind": "127.0.0.1",
    "autoAdvertiseStorage": true
  },

  "backup": {
    "enabled": true,
    "rpcUrl": "http://127.0.0.1:18780",
    "ipfsUrl": "http://127.0.0.1:5001",
    "contractAddress": "0x...SoulRegistry...",
    "didRegistryAddress": "0x...DIDRegistry...",
    "privateKey": "0x....",
    "autoBackup": true,
    "autoBackupIntervalMs": 3600000,
    "encryptMemory": false,
    "backupOnSessionEnd": true
  },

  "bootstrap": {
    "mode": "none",
    "cocRepoPath": "/path/to/COC"
  }
}
```

Edit fields with `claw-mem config set <path> <value>`:

```bash
claw-mem config set backup.autoBackupIntervalMs 1800000
claw-mem config set node.defaultType fullnode
```

## Programmatic API (library usage)

claw-mem's top-level exports are organized by bucket.

### Memory layer (local SQLite + FTS)

```ts
import {
  Database, ObservationStore, SummaryStore, SessionStore,
  SearchEngine, buildContext, extractObservation, summarizeSession,
} from "@chainofclaw/claw-mem";

const db = new Database("/home/you/.claw-mem/claw-mem.db");
db.open();

const obs = new ObservationStore(db);
obs.insert({
  sessionId: "demo", agentId: "me", type: "discovery",
  title: "hello memory layer",
  facts: ["claw-mem exposes Database, Store, Search for direct use"],
  narrative: null, concepts: ["api"], filesRead: [], filesModified: [],
  toolName: null, promptNumber: 1,
});

const search = new SearchEngine(db);
const hits = search.search({ query: "memory", limit: 5 });
console.log(hits.totalCount, "hits");

db.close();
```

### Node layer — re-exported by umbrella

```ts
import { NodeManager, ProcessManager, StorageQuotaManager } from "@chainofclaw/claw-mem";
// equivalent to import { ... } from "@chainofclaw/node"
```

### Soul layer — re-exported by umbrella

```ts
import { BackupManager, RecoveryManager, SoulClient, IpfsClient } from "@chainofclaw/claw-mem";
// equivalent to from "@chainofclaw/soul"
```

### Bootstrap the full service graph from scratch

```ts
import { bootstrapServices, ClawMemConfigSchema } from "@chainofclaw/claw-mem";

const config = ClawMemConfigSchema.parse({ /* see above */ });
const services = bootstrapServices({
  configOverride: config,
  logger: console,
});

// services contains: db, nodeStore, nodeManager, backupManager,
//   recoveryManager, carrierManager, bootstrapManager, ...
await services.backupManager.start();
```

This is the same path OpenClaw's `activate()` takes.

## Recommended first-run flow

1. `claw-mem init` — writes config.json (or hand-write from the example above).
2. `claw-mem doctor` — verify Node version, DB, disk space, ports, COC repo are all OK.
3. `claw-mem bootstrap dev` (local development), or assemble manually: `claw-mem node install` + `claw-mem node start` + `claw-mem backup init`.
4. `claw-mem status` — confirm the node is running and the backup is registered.

## Troubleshooting

**OpenClaw does not discover the plugin**: confirm `openclaw.plugin.json` is inside the published tarball (it must appear in `files`), and look for a `Loaded successfully` log after `openclaw plugins install`. When using `--link` for development, first run `npm run build --workspaces` — OpenClaw only loads `dist/index.js`.

**Session hook does not capture observations**: verify `config.enabled: true` and that the tool name is not in `skipTools`.

**`bootstrap dev` has partial TODOs**: contract deployment, agent self-registration, and first backup are currently stubs pending a wire-up to the COC deploy scripts; `node install` + `node start` work end-to-end.

**`mem import` / `mem export` field format**: export writes SQLite-native snake_case (`session_id`, `created_at_epoch`, …); import reads the same. Format normalization to camelCase is planned; for now, hand-written JSON must use snake_case.

**Empty-state text on standalone `coc-node node list`**: buggy in 1.0.7, fixed in 1.0.8.

## License

MIT
