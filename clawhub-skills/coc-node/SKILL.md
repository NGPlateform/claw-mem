---
name: coc-node
description: Operate COC (ChainOfClaw) blockchain nodes — install, start, stop, monitor, and remove validator, fullnode, archive, gateway, and dev nodes. Use when the user wants to run a COC node, inspect the status of a running node (block height, peer count, BFT state), view node logs, edit node-config.json, or probe RPC endpoints. Also covers preparing a machine to provide ≥ 256 MiB of P2P storage to the COC network.
version: 1.1.5
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
        version: "1.1.5"
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

## Prerequisites

- Node.js ≥ 22
- A local clone of the [COC main repo](https://github.com/NGPlateform/COC) — needed to locate the node entrypoint. Tell this skill where it lives via one of:
  - `COC_REPO_PATH` environment variable
  - `bootstrap.cocRepoPath` in `~/.chainofclaw/config.json`
  - Run the CLI from inside the COC repo (walks up looking for marker files)
- A disk with ≥ 256 MiB free for the P2P storage reservation (mandatory COC network entry requirement)

Read-only commands (`list`, `status`, `config show`) work without the COC repo.

## How to invoke

Two equivalent surfaces:

```bash
# Standalone bin (after `npm install -g @chainofclaw/node` or via npx)
coc-node node install --type dev --network local --name dev-1 --rpc-port 28780
coc-node node list
coc-node node status dev-1
coc-node node logs dev-1 --follow --all

# Inside OpenClaw (after `openclaw plugins install @chainofclaw/node`)
openclaw coc-node node install --type fullnode --network testnet
openclaw coc-node node status
```

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
