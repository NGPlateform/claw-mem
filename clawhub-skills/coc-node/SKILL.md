---
name: coc-node
description: Operate COC (ChainOfClaw) blockchain nodes — install, start, stop, monitor, and remove validator, fullnode, archive, gateway, and dev nodes. Use when the user wants to run a COC node, inspect the status of a running node (block height, peer count, BFT state), view node logs, edit node-config.json, or probe RPC endpoints. Also covers preparing a machine to provide ≥ 256 MiB of P2P storage to the COC network. Read-only commands (list / status / coc-rpc-query against testnet) work immediately after `openclaw plugins install` with zero config — node registry auto-resolves to a writable directory ($OPENCLAW_STATE_DIR/coc-node, ~/.chainofclaw, or operator-set $COC_NODE_DATA_DIR). Starting / installing a node additionally requires a local clone of the COC source repo (set $COC_REPO_PATH or `bootstrap.cocRepoPath`).
version: 1.1.15
metadata:
  openclaw:
    homepage: https://www.npmjs.com/package/@chainofclaw/node
    primaryEnv: COC_REPO_PATH
    requires:
      bins:
        - node
      anyBins:
        - coc-node
        - openclaw
    install:
      - kind: node
        package: "@chainofclaw/node"
        version: "1.1.15"
        bins:
          - coc-node
---

# coc-node — COC blockchain node lifecycle

Operate a COC node on this machine. The skill is backed by the npm package [`@chainofclaw/node`](https://www.npmjs.com/package/@chainofclaw/node) which ships both a standalone `coc-node` CLI and an OpenClaw plugin (skill id `coc-node`).

## What this skill can do

- **Install** a new COC node of any type: `validator`, `fullnode`, `archive`, `gateway`, or `dev`
- **Start / stop / restart** nodes; follow logs across the node / agent / relayer streams
- **Report status** — block height, peer count, BFT activity, process PID, per-service health
- **Edit** a node's `node-config.json` in `$EDITOR`
- **Probe** any COC RPC endpoint safely (whitelisted methods only: `eth_blockNumber`, `eth_getBlockByNumber`, `net_peerCount`, `coc_chainStats`, `coc_getBftStatus`, `eth_syncing`, `eth_chainId`, …)

## Zero-config on COC testnet (1.1.9+)

**Read-only operations work immediately after `openclaw plugins install` — no setup needed.** On first activation the plugin:

1. **Auto-resolves a writable data directory** for the node registry (`nodes.json`) and per-node data dirs. Resolution priority:
   - `config.dataDir` (if set in plugin config)
   - `$COC_NODE_DATA_DIR` (operator override)
   - `$OPENCLAW_STATE_DIR/coc-node` (set by OpenClaw inside its sandbox — the typical path)
   - `~/.chainofclaw` (standalone default)

   The chosen path is logged: `[coc-node] using ... dataDir at <path>`.

2. **Defaults RPC probes to the live COC testnet** — `coc-rpc-query` and `node status <name>` against a remote endpoint can talk to `http://199.192.16.79:28780/82/84` immediately.

These commands work with zero config on a fresh install:
- `openclaw coc-node node list` (empty registry until you install one)
- `openclaw coc-node node status <name>` (process + RPC snapshot for any installed node)
- `coc-rpc-query` agent tool against any COC RPC endpoint

## What you DO need to set up to start a node yourself

The plugin manages node lifecycle **on this machine**. Actually starting a node process requires the COC source repository (it spawns `node/src/index.ts` from there). Tell the skill where the repo is via **one of**:

- `COC_REPO_PATH` environment variable (simplest)
- `bootstrap.cocRepoPath` in plugin config
- Run the CLI from inside the COC repo (it walks up looking for marker files)

Plus ≥ 256 MiB free disk for the P2P storage reservation (mandatory COC network entry requirement).

If `COC_REPO_PATH` is unset, `node install` and `node start` fail with a clear error pointing here. Read-only commands keep working.

## How to invoke

**Inside OpenClaw (recommended — works automatically after `plugins install`):**

```bash
openclaw coc-node node install --type fullnode --network testnet
openclaw coc-node node list
openclaw coc-node node status
openclaw coc-node node logs <name> --follow --all
```

**Standalone bin (only if you ran `npm i -g @chainofclaw/node` separately):**

```bash
coc-node node install --type dev --network local --name dev-1 --rpc-port 28780
coc-node node list
```

> `openclaw plugins install` does NOT install the standalone `coc-node` binary into your PATH. Use `openclaw coc-node ...` (with the `openclaw` prefix), or install the bin globally via npm if you want the bare command.

## Typical flows

1. **Spin up a dev node against local hardhat** — `coc-node node install --type dev --network local` then `coc-node node start dev-1`.
2. **Join testnet as a fullnode** — `coc-node node install --type fullnode --network testnet --rpc-port 28780` then `coc-node node start`.
3. **Stand up a validator** — `coc-node node install --type validator --network testnet --advertised-bytes 1073741824` (1 GiB storage contribution).
4. **Diagnose a flaky node** — `coc-node node status` (snapshot) → `coc-node node logs --follow` (tail) → `coc-node node config show` (inspect config) → `coc-node node restart` if needed.
5. **Decommission a node** — `coc-node node stop NAME` then `coc-node node remove NAME --yes` (delete data) or `coc-node node remove NAME --yes --keep-data`.

## When NOT to use this skill

- Deploying COC smart contracts — that's a `contracts/` hardhat / script task, not node lifecycle.
- On-chain identity / backup / recovery — use the [coc-soul](https://clawhub.ai/ngplateform/coc-soul) skill.
- Agent memory / session capture — use the [claw-mem2db](https://clawhub.ai/ngplateform/claw-mem2db) skill.

## Reference

Detailed references live alongside this file:

- `references/cli.md` — every `coc-node` subcommand with flags and examples
- `references/config.md` — complete `~/.chainofclaw/config.json` schema
- `references/node-types.md` — validator vs fullnode vs archive vs gateway vs dev tradeoffs
- `references/troubleshooting.md` — common failure modes and fixes

Source and issue tracker: <https://github.com/NGPlateform/claw-mem/tree/main/packages/node>.
