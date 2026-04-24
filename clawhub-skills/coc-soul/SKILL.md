---
name: coc-soul
description: Give an AI agent a persistent on-chain soul on COC — register and manage the agent's decentralized identity (DID), anchor encrypted backups to IPFS + SoulRegistry, configure guardians for social recovery, and enable cross-carrier resurrection so the agent can resume on a different device if the original host goes offline. Use when the user wants their AI agent to survive device loss, transfer ownership, delegate capabilities, run a guardian / carrier node, or inspect an agent's on-chain identity state.
version: 1.1.0
metadata:
  openclaw:
    homepage: https://www.npmjs.com/package/@chainofclaw/soul
    primaryEnv: COC_SOUL_CONFIG
    requires:
      bins:
        - node
      anyBins:
        - coc-soul
        - openclaw
    install:
      - kind: node
        package: "@chainofclaw/soul"
        version: "1.1.0"
        bins:
          - coc-soul
---

# coc-soul — agent identity, backup, and resurrection on COC

The **soul layer** for AI agents on COC. Backed by the npm package [`@chainofclaw/soul`](https://www.npmjs.com/package/@chainofclaw/soul) which ships both a standalone `coc-soul` CLI and an OpenClaw skill (id `coc-soul`).

## Mental model

Every AI agent is identified by a `bytes32 agentId`, controlled by an EOA (owner). The skill covers five concerns:

| Area | What it does |
|---|---|
| **DID** | Register the agent on-chain, manage verification methods (keys), delegate capabilities, anchor verifiable credentials, record lineage (fork relationships) |
| **Backup** | Encrypt + upload agent state (identity / config / memory / chat / workspace / DB) to IPFS, anchor the manifest CID in SoulRegistry |
| **Guardian** | Designate trusted accounts that can jointly recover or resurrect the agent |
| **Recovery** | Social recovery flow — guardians collectively migrate the owner to a new address |
| **Carrier** | Register a hosting node that can resurrect offline agents |

## Prerequisites

Before first use, the skill reads `~/.chainofclaw/config.json` (or `$COC_SOUL_CONFIG`) for:

- `backup.rpcUrl` — a reachable COC JSON-RPC endpoint
- `backup.contractAddress` — deployed SoulRegistry address
- `backup.didRegistryAddress` — deployed DIDRegistry address
- `backup.ipfsUrl` — IPFS HTTP API (for blob upload)
- `backup.privateKey` — EOA private key (chmod 600 the file)

Without these, only non-chain operations still work (`backup doctor` diagnoses what's missing).

## How to invoke

```bash
# Standalone
coc-soul backup status
coc-soul did delegations --agent-id 0x...

# Inside OpenClaw
openclaw coc-soul backup status
```

## Typical flows

1. **First-time soul registration + backup** — `coc-soul backup init` registers on SoulRegistry, runs the first full backup, writes `~/.coc-backup/latest-recovery.json` locally.
2. **Periodic incremental backup** — `coc-soul backup create` (auto runs if `backup.autoBackup: true`).
3. **Inspect agent state** — `coc-soul backup status` (summary), `coc-soul backup doctor` (actionable recommendations).
4. **Delegation** — `coc-soul did delegate --delegator <agentId> --delegatee <targetId> --scope <hash> --expires <epoch> --depth 0`.
5. **Guardian setup** — `coc-soul guardian add --agent-id <id> --guardian 0x...` (repeat for each guardian).
6. **Emergency recovery** (you lost your owner key) — a guardian runs `coc-soul recovery initiate`, the quorum approves via `recovery approve`, then after timelock `recovery complete`.
7. **Resurrection as carrier** — `coc-soul carrier register --endpoint https://...` on the hosting node; `coc-soul carrier start` runs the daemon.

## When NOT to use this skill

- Running a COC chain node yourself — use [coc-node](https://clawhub.ai/skill/coc-node).
- Local semantic memory (non-chain) — use [claw-mem](https://clawhub.ai/skill/claw-mem).
- Smart contract deployment — that lives in the [COC source repo](https://github.com/NGPlateform/COC) `contracts/` tree.

## Reference

Detailed references live alongside this file:

- `references/did.md` — full `did` subcommand tree, delegation semantics, ephemeral identities, credentials, lineage
- `references/backup.md` — backup / restore / prune flows, encryption, semantic snapshot, categories
- `references/guardian-recovery.md` — guardian lifecycle + social recovery timelock + quorum rules
- `references/carrier.md` — carrier registration, daemon modes, resurrection request flow
- `references/config.md` — complete `backup.*` + `carrier.*` config schema

Source and issue tracker: <https://github.com/NGPlateform/claw-mem/tree/main/packages/soul>.
