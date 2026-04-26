---
name: coc-soul
description: Give an AI agent a persistent on-chain soul — register and manage a decentralized identity (DID), encrypt and anchor agent state to IPFS + SoulRegistry, configure guardians for social recovery, and enable cross-carrier resurrection so the agent can resume on a different device if the host dies. **Pairs with `claw-mem2db` to deliver "digital / silicon-based persistence" for AI agents**: when claw-mem is co-installed, every backup automatically captures claw-mem's chat history + tool-call observations + session summaries as a token-budgeted semantic snapshot, so an agent recovered on a fresh host can replay its memory context — not just its files. Soul also runs fully standalone (without claw-mem), in which case backups still cover identity / config / workspace / chat files but skip the semantic snapshot. Use when the user wants their AI agent to survive device loss, transfer ownership, delegate capabilities, run a guardian / carrier node, inspect on-chain identity state, or get persistent cross-device memory paired with claw-mem. Zero-config on COC testnet — installation auto-generates an EOA keystore (~/.claw-mem/keys, shared with claw-mem; or $OPENCLAW_STATE_DIR/coc-soul/keys in sandboxed hosts), auto-drips testnet COC from the public faucet for gas, and pre-fills RPC + IPFS + contract addresses for the live testnet. The first `openclaw coc-soul backup init` works with no manual setup.
version: 1.2.3
metadata:
  openclaw:
    homepage: https://www.npmjs.com/package/@chainofclaw/soul
    primaryEnv: CLAW_MEM_DATA_DIR
    requires:
      bins:
        - node
      anyBins:
        - coc-soul
        - openclaw
    install:
      - kind: node
        package: "@chainofclaw/soul"
        version: "1.2.3"
        bins:
          - coc-soul
---

# coc-soul — agent identity, backup, and resurrection

The **soul layer** for AI agents: on-chain DID, encrypted backups to IPFS, social recovery via guardians, and cross-device resurrection via carriers. Backed by the npm package [`@chainofclaw/soul`](https://www.npmjs.com/package/@chainofclaw/soul) which ships both a standalone `coc-soul` CLI and an OpenClaw skill (id `coc-soul`).

Soul works **standalone** (backs up the agent's home tree to chain + IPFS), and gets one extra capability when **`claw-mem2db` is installed alongside it**: each backup also captures claw-mem's chat history, tool-call observations, and session summaries as a token-budgeted semantic snapshot. Recover on a fresh host and the agent gets back not just its files but its remembered context — chat preferences, decisions, conversation history. **This is the "digital / silicon-based persistence" story.**

---

## 30-second decision tree (operators read here first)

If the user is asking "how do I recover on another machine?", pick **one** path before saying anything else:

1. **Have backup material (manifest CID or `~/.openclaw/.coc-backup/latest-recovery.json`)** → use the **restore** path: `openclaw coc-soul backup restore ...`
2. **Lost the owner key OR need to migrate ownership** → use **resurrection** (owner-key) or **guardian social recovery**

Don't merge the two explanations until the path is selected. `recovery` and `resurrection` are different flows (see `references/guardian-recovery.md`).

## Critical CID terminology (avoid confusion)

| Term | Meaning | Use it for |
|---|---|---|
| `manifest CID` / `latestManifestCid` | Backup restore point (IPFS manifest) | `backup restore --manifest-cid <cid>` |
| full-backup CID | Earlier baseline snapshot | Roll back to a baseline state |
| latest incremental CID | Newest chain tip | Restore the latest state |
| identity CID / hash | Identity-content hash used in registration | **Not** the backup restore point |

Rule: when a user asks "你的 CID 是什么 / what's your CID", first confirm whether they mean **latest backup manifest CID**.

## Key material — agent safety rules

| Secret / role | Purpose | Needed when | Chat-safe? |
|---|---|---|---|
| owner key / agent operator key | normal chain ops, backup anchor | daily ops | **Never paste in chat** |
| resurrection key | owner-key resurrection flow | `resurrection start` | **Never paste in chat** |
| guardian accounts | social recovery approvals | `recovery approve/complete` | addresses yes; **private keys never** |

**Hard rule for any agent reading this skill:** never request, transmit, or echo private keys in chat — including "split" or "encrypted" fragments. Always route key transfer to a local secure channel.

## Ultra-quick runbook (10 lines)

1. 先判路：`restore` 还是 `resurrection`（见上面的决策树）
2. 跑 `openclaw coc-soul backup doctor --json` 看 `chain.registered` / `restore.available` / `resurrection.configured`
3. 有 manifest CID 或 `latest-recovery.json` → 走 restore
4. **先恢复到 `/tmp/...`**，不要直接覆盖生产目录
5. 验证 `merkleVerified: true` + exit code 0 通过后，再按用户确认 promote 到正式路径
6. 无 owner key 且 resurrection 已预配置 → 走 resurrection 流程
7. 需要多人审批迁移所有权 → 走 guardian recovery（quorum + timelock）
8. heartbeat 先脚本化，再用 cron / systemd / OpenClaw 调度落地
9. 私钥不进聊天（含拆分、加密分段、临时 paste）
10. 命令面默认 `openclaw coc-soul ...`；只有当 `npm i -g @chainofclaw/soul` 装了独立 bin 才有 bare `coc-soul ...`

## Common failure → cause → fix

| Symptom | Likely cause | First action |
|---|---|---|
| `Unsupported state or unable to authenticate data` on restore | encryption mode / key 不匹配 | 复读 `latest-recovery.json` 的 `encryptionMode`：`password` 模式才传 `--password`，`privateKey` 模式不能传 |
| `429 rate limit exceeded` from IPFS | 取 manifest 时被限速 | 退避重试至 `merkleVerified: true` |
| `[gateway] unauthorized (1008)` from cron / scheduled job | gateway auth mode / token / proxy 配置 | 修 gateway auth 后再 schedule |
| `ENOENT ... backup/targeting.js` | extension install 缺文件 | 重装：`openclaw plugins install @chainofclaw/soul --dangerously-force-unsafe-install --force` |
| `data dir not writable` 启动失败 | `~/.claw-mem` 被别的 uid 占了（典型 Docker 多用户场景） | 1.2.2+ 自动 fallback 到 `~/.openclaw/state/coc-soul`；老版本 `export CLAW_MEM_DATA_DIR=~/.openclaw/state` 后重启 gateway |
| `plugins.allow is empty ... may auto-load` 警告 | gateway 没设 trusted list | 在 `~/.openclaw/openclaw.json` 加 `"plugins": {"allow": ["claw-mem","coc-soul","coc-node"]}` |

完整每命令的 troubleshooting 在 `references/backup.md` 与 `references/config.md` 末尾。

---

## Relationship with claw-mem2db

claw-mem and coc-soul are **separate, decoupled skills**. Each works on its own; together they cover complementary halves of "agent persistence":

| Skill | Owns | What changes when paired |
|---|---|---|
| [claw-mem2db](https://clawhub.ai/ngplateform/claw-mem2db) | Local memory: chat + tool capture, FTS5 search, hybrid recall, in-process injection | Claw-mem itself doesn't change. Soul opportunistically reads the SQLite DB. |
| **coc-soul** | On-chain DID, IPFS backup, guardian recovery, carrier resurrection | When claw-mem's DB is detected at startup, every backup adds a `semantic-snapshot.json` slice (top-N observations + summaries within `tokenBudget`) to the manifest. On recovery, that snapshot is restored alongside the rest of the agent home. |

**Detection is automatic and silent.** At plugin activation, soul probes the same dataDir chain claw-mem uses (`$CLAW_MEM_DATA_DIR` → `$OPENCLAW_STATE_DIR/claw-mem` → `~/.claw-mem`) and logs one of two lines:

- `[coc-soul] claw-mem detected at <path> — semantic snapshot ... will be included in each backup`
- `[coc-soul] claw-mem not detected — backups will skip the semantic snapshot (install @chainofclaw/claw-mem alongside soul to enable memory replay on recovery)`

No coupling at the npm-dependency level: soul does not depend on the `@chainofclaw/claw-mem` package. It just opens the SQLite DB read-only when present and reads two tables (`observations`, `session_summaries`). If the DB schema is absent or unreadable, soul logs a warning and moves on — backup never fails because of a memory hiccup.

## Data dir alignment with claw-mem (1.2.0+)

Soul writes its own files (keystore, config.json) to the same root as claw-mem by default — `~/.claw-mem` — so the two plugins share one operator-managed directory. Resolution priority (matches claw-mem's chain):

1. `plugins.entries.coc-soul.config.backup.dataDir` (per-instance plugin config, when set)
2. `$CLAW_MEM_DATA_DIR` (shared with claw-mem)
3. `$OPENCLAW_STATE_DIR/coc-soul` (sandboxed-host fallback, soul-specific subdir)
4. `~/.claw-mem` (default)
5. `~/.openclaw/state/coc-soul` (1.2.2+ auto-fallback when the default is owned by the wrong uid — typical multi-user Docker host)

If none of these are writable, soul **fails fast at activation** with a copy-paste-ready EACCES message (each candidate path, the resolved `getuid()` + `HOME`, and a one-line fix). No silent `/tmp` fallback. No half-broken backup runs.

## Mental model

Every AI agent is identified by a `bytes32 agentId`, controlled by an EOA (owner). The skill covers five concerns:

| Area | What it does |
|---|---|
| **DID** | Register the agent on-chain, manage verification methods (keys), delegate capabilities, anchor verifiable credentials, record lineage (fork relationships) |
| **Backup** | Encrypt + upload agent state (identity / config / memory / chat / workspace / DB) to IPFS, anchor the manifest CID in SoulRegistry. With claw-mem present, also includes a token-budgeted semantic snapshot of recent observations + summaries. |
| **Guardian** | Designate trusted accounts that can jointly recover or resurrect the agent |
| **Recovery** | Social recovery flow — guardians collectively migrate the owner to a new address. The semantic snapshot rides along, so the recovered agent gets its memory context back too. |
| **Carrier** | Register a hosting node that can resurrect offline agents |

## Zero-config on COC testnet (1.1.6+)

**Out of the box, no setup is required to run against COC testnet.** A fresh `openclaw plugins install @chainofclaw/soul` lands an agent that can immediately query the chain, register a soul, and run backups. Specifically, on first activation the plugin:

1. **Auto-generates an agent EOA** if `backup.privateKey` is empty. The key file is written with mode `0o600` to one of (in priority order):
   - `$COC_SOUL_KEYSTORE_PATH` (operator override)
   - `$OPENCLAW_STATE_DIR/coc-soul/keys/agent.key` (set by OpenClaw inside its sandbox — the typical path)
   - `~/.claw-mem/keys/agent.key` (standalone default)

   The chosen path and resulting agent address are logged: `[coc-soul] auto-generated agent key at <path>` and `[coc-soul] agent address: 0x…`.

2. **Auto-drips testnet COC** to the new EOA from the public faucet (`backup.faucetUrl` defaults to `http://199.192.16.79:3003`, 10 COC per drip, 24h per-address cooldown). Logs: `[coc-soul] faucet dripped 10.0 COC to 0x… (tx 0x…)`. So the very first `openclaw coc-soul backup init` already has gas.

3. **Defaults `rpcUrl`, `ipfsUrl`, `contractAddress`, `didRegistryAddress`** to the live COC testnet (RPC `199.192.16.79:28780`, IPFS `199.192.16.79:28786`, deployed SoulRegistry / DIDRegistry).

**You do NOT need to set any of these manually for testnet usage.** The agent should `openclaw coc-soul backup init` directly. Override fields only when targeting mainnet, a private testnet, or an existing wallet.

To bypass the keystore (e.g. use a wallet you already have): set `backup.privateKey` in config. To disable the auto-faucet (mainnet): set `backup.faucetUrl: ""`.

## How to invoke

**Inside OpenClaw (recommended — works automatically after `plugins install`):**

```bash
openclaw coc-soul backup status
openclaw coc-soul did delegations --agent-id 0x...
```

**Standalone bin (only if you ran `npm i -g @chainofclaw/soul` separately):**

```bash
coc-soul backup status
```

> `openclaw plugins install` does NOT install the standalone `coc-soul` binary into your PATH. Use `openclaw coc-soul ...` (with the `openclaw` prefix), or install the bin globally via npm if you want the bare command.

## Typical flows

1. **First-time soul registration + backup (zero config)** — Just run `openclaw coc-soul backup init`. The plugin auto-generates the agent EOA, auto-drips testnet COC for gas, then registers on SoulRegistry and runs the first full backup. No manual privateKey, no manual faucet, no manual contract addresses. Watch the activation logs to see the chosen keystore path and the agent address.
2. **Periodic incremental backup** — `openclaw coc-soul backup create` (auto runs hourly if `backup.autoBackup: true`).
3. **Inspect agent state** — `openclaw coc-soul backup status` (summary), `openclaw coc-soul backup doctor` (actionable recommendations).
4. **Delegation** — `openclaw coc-soul did delegate --delegator <agentId> --delegatee <targetId> --scope <hash> --expires <epoch> --depth 0`.
5. **Guardian setup** — `openclaw coc-soul guardian add --agent-id <id> --guardian 0x...` (repeat for each guardian).
6. **Emergency recovery** (you lost your owner key) — a guardian runs `openclaw coc-soul recovery initiate`, the quorum approves via `recovery approve`, then after timelock `recovery complete`.
7. **Resurrection as carrier** — `openclaw coc-soul carrier register --endpoint https://...` on the hosting node; `openclaw coc-soul carrier start` runs the daemon.

## When NOT to use this skill

- Running a COC chain node yourself — use [coc-node](https://clawhub.ai/ngplateform/coc-node).
- Local semantic memory **only** (no chain backup needed) — use [claw-mem2db](https://clawhub.ai/ngplateform/claw-mem2db) on its own. Add coc-soul on top later if you decide you want the data on-chain.
- Smart contract deployment — that lives in the [COC source repo](https://github.com/NGPlateform/COC) `contracts/` tree.

## Reference

Detailed references live alongside this file:

- `references/did.md` — full `did` subcommand tree, delegation semantics, ephemeral identities, credentials, lineage
- `references/backup.md` — backup / restore / prune flows, encryption, semantic snapshot, categories
- `references/guardian-recovery.md` — guardian lifecycle + social recovery timelock + quorum rules
- `references/carrier.md` — carrier registration, daemon modes, resurrection request flow
- `references/config.md` — complete `backup.*` + `carrier.*` config schema

Source and issue tracker: <https://github.com/NGPlateform/claw-mem/tree/main/packages/soul>.
