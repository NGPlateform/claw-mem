# Migrating from `@openclaw/coc-nodeops` / `@openclaw/coc-backup`

claw-mem 1.0 absorbs both `coc-nodeops` and `coc-backup` into a single
OpenClaw skill. The old packages still exist as thin compatibility shims
that re-export `activate` from `@openclaw/claw-mem`, so existing
OpenClaw configs keep working without changes.

This guide covers what has moved, what has been renamed, and what is
still pending.

## TL;DR

```bash
# old
openclaw extension install @openclaw/coc-nodeops
openclaw extension install @openclaw/coc-backup
openclaw extension install @openclaw/claw-mem

openclaw coc init
openclaw coc-backup create

# new
openclaw extension install @openclaw/claw-mem

openclaw node install
openclaw backup create
```

The `coc` and `coc-backup` command prefixes still resolve while the
shims are installed.

## Where each module lives now

| Old path | New path |
|----------|----------|
| `coc-nodeops/src/runtime/node-manager.ts` | `claw-mem/src/services/node-manager.ts` |
| `coc-nodeops/src/runtime/process-manager.ts` | `claw-mem/src/services/process-manager.ts` |
| `coc-nodeops/src/runtime/rpc-client.ts` | `claw-mem/src/services/rpc-client.ts` |
| `coc-nodeops/src/cli/{commands,init-wizard}.ts` | `claw-mem/src/cli/{commands/node,init-wizard}.ts` |
| `coc-nodeops/src/{network-presets,node-types}.ts` | `claw-mem/src/shared/presets.ts` |
| `coc-nodeops/src/shared/paths.ts` | `claw-mem/src/shared/paths.ts` (rewritten — no longer assumes coc-nodeops's nesting) |
| `coc-backup/src/{soul,ipfs,did}-client.ts` | `claw-mem/src/services/{soul,ipfs,did}-client.ts` |
| `coc-backup/src/lifecycle.ts` | `claw-mem/src/services/lifecycle.ts` |
| `coc-backup/src/local-state.ts` | `claw-mem/src/services/local-state.ts` |
| `coc-backup/src/crypto.ts` | `claw-mem/src/services/crypto.ts` |
| `coc-backup/src/types.ts` | `claw-mem/src/services/backup-types.ts` (renamed to avoid clash with `claw-mem/src/types.ts`) |
| `coc-backup/src/utils.ts` | `claw-mem/src/services/backup-utils.ts` (same reason) |
| `coc-backup/src/config-schema.ts` | `claw-mem/src/services/backup-config-schema.ts` (preserved 1:1; the user-facing schema is in `claw-mem/src/config.ts`, with an adapter in `backup-config-adapter.ts`) |
| `coc-backup/src/backup/*.ts` | `claw-mem/src/services/backup/*.ts` |
| `coc-backup/src/recovery/*.ts` | `claw-mem/src/services/recovery/*.ts` |
| `coc-backup/src/carrier/*.ts` | `claw-mem/src/services/carrier/*.ts` (CLI not yet ported) |
| `coc-backup/src/cli/commands.ts` | `claw-mem/src/cli/commands/backup.ts` (subset; carrier/guardian/DID commands deferred) |

## Storage layout

The on-disk layout has moved under one root:

```
~/.claw-mem/
├── claw-mem.db          (SQLite — observations, summaries, sessions,
│                         + new v2 tables: coc_nodes, backup_archives,
│                         coc_artifacts, carrier_requests)
├── nodes/               (per-node working dirs — NodeManager)
├── backup/              (backup state files)
├── archives/            (backup payloads)
├── logs/                (process stdout/stderr — ProcessManager)
├── keys/                (operator key — BootstrapManager)
└── .quota.reserved      (256 MiB placeholder — StorageQuotaManager)
```

For backup, the **source** dir to back up is unchanged — it defaults to
`~/.openclaw` (configurable via `backup.sourceDir`).

The legacy `~/.clawdbot/coc/nodes.json` registry is auto-migrated into
the SQLite `coc_nodes` table on first launch (NodeStore.importLegacyJson;
see node-store.ts).

## Config schema changes

Old `CocBackupConfig` (used by `coc-backup`) and the equivalent
top-level fields in `coc-nodeops` are now subsections of one
`ClawMemConfig`:

```jsonc
// ~/.claw-mem/config.json
{
  "enabled": true,
  // memory (unchanged): claw-mem v0.x fields stay at the top level
  "tokenBudget": 8000,
  "maxObservations": 50,

  "storage": {
    "quotaBytes": 268435456,        // 256 MiB local cap
    "advertisedBytes": 268435456,   // ≥256 MiB; written into node-config.json
    "reservedBytes": 268435456,     // fallocate placeholder
    "enforceQuota": true
  },

  "node": {
    "defaultType": "dev",
    "defaultNetwork": "local",
    "port": 18780,
    "agent":   { "intervalMs": 60000, "batchSize": 5, "sampleSize": 2 },
    "relayer": { "enabled": false }
  },

  "backup": {
    "enabled": true,
    "sourceDir": "~/.openclaw",
    "rpcUrl": "http://127.0.0.1:18780",
    "ipfsUrl": "http://127.0.0.1:5001",
    "contractAddress": "0x...",      // SoulRegistry
    "didRegistryAddress": "0x...",
    "privateKey": "0x...",
    "autoBackup": true,
    "autoBackupIntervalMs": 3600000,
    "categories": { ... },
    "carrier":    { "enabled": false }
  },

  "bootstrap": {
    "mode": "none",                  // dev | prod | none
    "hardhatPort": 8545,
    "autoFundEther": "0.1",
    "skipIfReady": true
  }
}
```

You can edit this file directly, or use `claw-mem config set <path> <value>`.

## What is intentionally **not** ported in 1.0

- `coc-backup` carrier daemon CLI commands (`coc-backup carrier register`,
  `submit-request`, etc.). The carrier service code is migrated
  (`claw-mem/src/services/carrier/`) but isn't started or surfaced in CLI yet.
- `coc-backup` guardian + recovery + DID CLI subcommands. Tools (e.g.
  `soul-guardian-initiate`) need to be re-registered against the new
  `RecoveryManager` facade.
- The 4 `vitest`-style tests in `test/backup-suite/vitest-deferred/`
  were left in their original framework and will be rewritten to
  `node:test` in a follow-up.
- Contract deployment in `bootstrap dev` step 10. Today the script
  spawns hardhat and funds an operator, but you must deploy
  PoSeManager / SoulRegistry / DIDRegistry / CidRegistry by hand and
  record their addresses with `claw-mem config set` (or wait for the
  follow-up that wires `contracts/deploy/*.ts` in).

If your workflow depends on any of the above, keep
`@openclaw/coc-backup` installed alongside `@openclaw/claw-mem` for now —
the shim will not interfere with claw-mem's own `backup` commands.

## Verifying the upgrade

A small smoke run that does not need on-chain configuration:

```bash
claw-mem mem status            # SQLite opens, schema v2 in place
claw-mem node install -t dev -n local --name smoke-node --rpc-port 18999
claw-mem node list
cat ~/.claw-mem/nodes/smoke-node/node-config.json | jq '.advertisedStorageBytes'
# → 268435456
claw-mem node remove smoke-node --yes
```

The full happy-path script is sketched in the plan file
(`.claude/plans/clawbot-claw-mem-openclaw-skills-coc-25-rustling-feigenbaum.md`).
