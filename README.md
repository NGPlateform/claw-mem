# claw-mem

OpenClaw super-skill: **persistent semantic memory + COC node lifecycle + soul backup**, in one extension.

claw-mem absorbs and replaces three previously-independent extensions:
- the original `claw-mem` (semantic memory)
- `@openclaw/coc-nodeops` (COC node install/start/stop/status)
- `@openclaw/coc-backup` (agent soul backup → IPFS + on-chain anchoring)

## Why

OpenClaw agents need three things to operate inside the COC P2P network:

1. **Memory** that survives restarts and compaction.
2. **A COC node** that contributes ≥256 MiB of P2P storage and earns rewards.
3. **A backup pipeline** that anchors the agent's identity, configuration,
   and memory on-chain so the agent can be restored on any carrier.

These used to be three separate extensions that each held their own SQLite,
config, CLI, and lifecycle — and `coc-backup` had to reach into
`claw-mem`'s database directly to capture semantic snapshots. Now they
share a single store, single config schema, single CLI, and single skill
artifact.

## Install

```bash
npm install @chainofclaw/claw-mem
```

Or, in an OpenClaw extension folder, point at it locally:

```jsonc
// openclaw.json
{ "extensions": ["claw-mem"] }
```

## CLI

The standalone `claw-mem` binary and the `openclaw …` subcommands share the same commander definitions:

```text
claw-mem
├── status                # one-screen overview (memory + nodes + backup + bootstrap + storage)
├── doctor                # environment health checks (Node / COC repo / hardhat / ports / disk / quota / backup)
├── init                  # interactive first-time setup — writes ~/.claw-mem/config.json
├── version               # claw-mem version + schema version + Node / COC repo path
├── tools list            # list every agent tool the skill exposes (--with-schema for params)
├── uninstall             # selective cleanup of ~/.claw-mem (keeps keys by default)
│
├── mem
│   ├── search <q>        # FTS5 search over past observations
│   ├── status            # row counts and DB path
│   ├── forget <sid>      # delete observations for one session
│   ├── peek              # show what would be injected into the next prompt
│   ├── prune             # delete observations older than --older-than <days>
│   ├── export <file>     # dump observations + summaries + sessions to JSON
│   └── import <file>     # restore from a `mem export` file (idempotent)
│
├── node
│   ├── install           # init wizard (or non-interactive with --type/--network)
│   ├── list / status     # inspect tracked nodes
│   ├── start/stop/restart
│   ├── remove <name>
│   ├── config show|edit
│   └── logs <name>       # --service node|agent|relayer  --all  -f
│
├── backup
│   ├── configure         # interactive RPC / IPFS / contract / privateKey setup
│   ├── create [--full]
│   ├── restore           # by manifestCid / package / latestLocal
│   ├── list / history    # local archive index
│   ├── status / doctor
│   ├── prune             # drop old local archive entries (does NOT unpin IPFS)
│   └── find-recoverable  # local + (--on-chain) SoulRegistry latest CID
│
├── carrier               # carrier daemon: register / list (event-walk) / submit-request / start / stop / status / info / availability / deregister
├── guardian              # guardian-side resurrection + guardian set management
├── recovery              # social recovery (guardian-initiated owner migration)
├── did                   # DID identity management (DIDRegistry) — 14 subcommands
│
├── bootstrap
│   ├── dev               # spawn hardhat + deploy contracts + install + start + first backup
│   ├── prod              # interactive wizard for an existing chain (validates RPC + contract bytecode)
│   ├── status / teardown
│   └── logs              # tail ~/.claw-mem/logs/hardhat.log
│
├── db
│   ├── vacuum            # reclaim space after pruning
│   ├── migrate-status    # current vs latest schema version
│   └── size              # main / wal / shm bytes
│
└── config
    ├── get <path>        # dot-path read
    ├── set <path> <value>
    ├── list              # dump effective config
    └── path              # print ~/.claw-mem/config.json
```

## Memory layer (semantic memory)

claw-mem silently observes what your agent does — reading files, editing
code, running commands, searching the web — and distills each action into
a structured **observation**. At the end of every session it compresses
those observations into a **summary**. On the next session start it
**injects** the most relevant memories back into the agent's prompt, so
the agent picks up where it left off without you having to explain the
context again.

```text
Session N                                      Session N+1
─────────                                     ─────────────
[after_tool_call]   →  Observation            [session_start]   ←  Memory ctx
[after_tool_call]   →  Observation            [before_prompt]   ←  injected!
       …
[agent_end]         →  Summary
```

All of this lives in `~/.claw-mem/claw-mem.db` (SQLite + FTS5).

## The 256 MiB minimum

The COC P2P network requires every node to contribute at least 256 MiB of
storage. claw-mem enforces this in two places:

1. `storage.advertisedBytes` (default `268_435_456`) is written into every
   node-config.json under `advertisedStorageBytes`. The COC node layer
   doesn't yet broadcast this field; future versions will.
2. `storage.quotaBytes` (default `268_435_456`) is enforced locally. New
   node installs are rejected if they would push the data directory over
   the quota; a fallocate-based reservation file prevents the OS from
   filling the disk first.

## Bootstrap dev

```bash
claw-mem bootstrap dev
```

Brings up a local hardhat L1, generates an operator key, funds it with 0.1
ETH from hardhat account #0, generates a node-config (with
advertisedStorageBytes=256 MiB), installs and starts a `dev` COC node, and
prints a summary. Contract deployment, agent self-registration, and the
first backup are stubs in this initial version — see the in-source TODOs.

## Architecture

See `.claude/plans/clawbot-claw-mem-openclaw-skills-coc-25-rustling-feigenbaum.md`
for the full integration design — every file path, schema, and PR plan.

## Documentation

- 📘 [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — full user manual (~1200 lines): concepts, every command, workflows, troubleshooting, FAQ, appendix
- 🔄 [`docs/MIGRATION.md`](docs/MIGRATION.md) — migrating from `@openclaw/coc-nodeops` and `@openclaw/coc-backup`

## Status

PRs in this revision (1.0.0):

- ✅ PR 1 — config + DB schema v2 + node/archive/artifact stores
- ✅ PR 2 — `coc-nodeops` migration: NodeManager, ProcessManager, RpcClient, init wizard, `node` CLI, 10 agent tools
- ✅ PR 3 — StorageQuotaManager + 256 MiB enforcement, integrated with NodeManager.install
- ✅ PR 4 — `coc-backup` migration: BackupManager / RecoveryManager facades, 5 agent tools, `backup` CLI
- ✅ PR 5 — BootstrapManager + `bootstrap dev|status|teardown`
- ✅ PR 6 — `config get/set/list/path`, COC compatibility shims, docs, migration guide

UX revision (post-1.0):

- ✅ `status` / `doctor` / `init` / `version` / `tools list` / `uninstall`
- ✅ `mem peek` / `mem prune` / `mem export` / `mem import`
- ✅ `node logs --all`
- ✅ `bootstrap logs`
- ✅ `backup configure` / `backup prune` / `backup find-recoverable`
- ✅ `db vacuum` / `db migrate-status` / `db size`
- ✅ `bootstrap dev` step 16 now persists operator key to disk
- ✅ `node install` warns about missing COC repo; `node start` hard-fails with a clear message
- ✅ shared `config-persistence` helpers reused across config / init / configure / bootstrap

Round 4 (carrier / guardian / DID / bootstrap completion):

- ✅ `carrier { register | deregister | availability | info | submit-request | start | stop | status }` + auto-start in `activate()` if `backup.carrier.enabled`
- ✅ `guardian { initiate | approve | status | add | remove | list }`
- ✅ `recovery { initiate | approve | complete | cancel | status }`
- ✅ `did` — 14 subcommands covering all DIDRegistry operations
- ✅ `backup { init | register | heartbeat | configure-resurrection | resurrection { start | status | confirm | complete | cancel } }`
- ✅ 8 additional agent tools: `soul-auto-restore`, `soul-resurrection`, `soul-carrier-request`, `soul-guardian-initiate`, `soul-guardian-approve`, `soul-guardian-manage`, `soul-recovery-initiate`, `soul-recovery-approve` (total now 26)
- ✅ `bootstrap dev` step 10 — real contract deployment via ethers + compiled artifacts (PoSeManagerV2, SoulRegistry, CidRegistry, DIDRegistry); auto-runs `npx hardhat compile` if artifacts missing
- ✅ `bootstrap dev` step 15 — agent self-registration polled via `coc-agent.log` (45s timeout)
- ✅ vitest → node:test rewrite of all 4 deferred backup tests (`test/backup-suite/{binary-handler,change-detector-extended,lifecycle,scheduler}.test.ts`)

Round 5 (final):

- ✅ `bootstrap prod` — interactive @clack/prompts wizard validating RPC + each contract address (eth_getCode), supports `--non-interactive` flag-driven mode for scripts/CI; persists everything to `~/.claw-mem/config.json` and the artifact store under the resolved network name (mainnet / sepolia / coc-testnet / local / chain-N)
- ✅ `carrier list` — walks `CarrierRegistered` / `CarrierDeregistered` events on-chain (`--from-block`, `--include-inactive`), no external indexer required
- ✅ `SoulClient.listCarriers()` exposed for programmatic use

All deferred items now closed.
