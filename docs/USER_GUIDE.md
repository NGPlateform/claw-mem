# claw-mem 使用手册

> **claw-mem 1.0** · OpenClaw 上的"记忆 + COC 节点 + 备份"超级 skill
> Node.js ≥ 22 · 适配 OpenClaw / COC (chainofclaw) 生态

本手册按「快速上手 → 概念 → 命令参考 → 工作流 → 排错 → 附录」组织。
新用户建议先读 §3（5 分钟上手）和 §4（核心概念），按需查 §6 命令参考。

---

## 目录

1. [简介](#1-简介)
2. [安装](#2-安装)
3. [5 分钟上手](#3-5-分钟上手)
4. [核心概念](#4-核心概念)
5. [配置文件](#5-配置文件)
6. [命令参考](#6-命令参考)
7. [典型工作流](#7-典型工作流)
8. [Agent tools 参考](#8-agent-tools-参考)
9. [排错](#9-排错)
10. [FAQ](#10-faq)
11. [附录](#11-附录)

---

## 1. 简介

claw-mem 是 OpenClaw 上的一个 **三合一扩展（super-skill）**，把以下三件事统一在一个进程、一份配置、一份 SQLite 数据库里：

| 层 | 作用 | 之前在 |
|----|------|--------|
| **记忆层** | Agent 行为自动记录、按 token 预算注入到下次 prompt | 旧 `claw-mem` |
| **节点层** | COC 区块链节点的安装/启动/停止/状态 | `@openclaw/coc-nodeops` |
| **备份层** | Agent "灵魂"（identity / 配置 / 记忆 / 聊天）→ IPFS + 链上锚定 | `@openclaw/coc-backup` |

### 它解决什么问题

- **Agent 健忘**：每次新会话都得重新解释上下文 → 记忆层自动注入。
- **节点运维繁琐**：手动写 `node-config.json`、跟踪 PID、看日志 → `claw-mem node ...`。
- **灵魂迁移困难**：换机器、换 carrier、社交恢复都要写脚本 → `backup / carrier / guardian / recovery / did` 命令组。
- **配置散落**：原来三个扩展各自一份 SQLite/配置 → 统一到 `~/.claw-mem/`。

### 256 MiB P2P 门槛

COC 是 AI Agent 公链，要求每个节点至少为 P2P 网络贡献 **256 MiB** 存储。claw-mem 在两个地方落实这个门槛：

1. `storage.advertisedBytes`（默认 `268_435_456`）写入每个 `node-config.json` 顶层 `advertisedStorageBytes`。
2. `storage.quotaBytes`（默认 `268_435_456`）作为本地硬上限：node 安装时占用超配会被拒绝。

可以调高（贡献更多换更多收益），但不能调低到 256 MiB 以下。

---

## 2. 安装

### 前置依赖

- **Node.js ≥ 22**（用了 `node:sqlite` 实验 API + `--experimental-strip-types`）
- 如果要跑 COC 节点：本地有 [COC 仓库](https://github.com/chainofclaw/COC) 的 clone（或 fork），并 `cd contracts && npm install` 装 hardhat
- 如果用 prod 模式：现有的 RPC URL + 已部署的 SoulRegistry 等合约地址 + operator 私钥

### 安装方式

**A. 作为 OpenClaw 扩展（推荐）**

```bash
npm install @openclaw/claw-mem
```

在 `openclaw.json` 引用：
```jsonc
{ "extensions": ["claw-mem"] }
```

**B. 独立 CLI**

clone 后软链 bin：
```bash
git clone https://github.com/NGPlateform/claw-mem
cd claw-mem
npm install
ln -s $(pwd)/bin/claw-mem ~/.local/bin/claw-mem
claw-mem --help
```

**C. 在工作区里直接用**

如果 claw-mem 已经在 `~/claw-mem`：
```bash
~/claw-mem/bin/claw-mem --help
```

---

## 3. 5 分钟上手

### 路径 A — 本地 dev 玩耍（无外部链依赖）

```bash
# 0. 一次性初始化（写 ~/.claw-mem/config.json）
claw-mem init

# 1. 检查环境（Node 版本 / COC repo / 端口冲突 / 磁盘）
claw-mem doctor

# 2. 一键起栈：本地 hardhat + 部署合约 + 装 dev 节点 + 首次备份
claw-mem bootstrap dev

# 3. 看一下全景
claw-mem status

# 4. 试一次备份
claw-mem backup create

# 5. 查记忆（先要有 agent 跑过几次才有数据）
claw-mem mem status

# 6. 收摊
claw-mem bootstrap teardown --yes
```

**bootstrap dev 完成后会有：**
- 本地 hardhat 跑在 `127.0.0.1:8545`
- 4 个合约部署到 hardhat（PoSeManagerV2 / SoulRegistry / CidRegistry / DIDRegistry）
- 一个 dev 类型 COC 节点跑在 `127.0.0.1:18780`
- operator 私钥生成并写入 `~/.claw-mem/config.json` 的 `backup.privateKey`
- 256 MiB 占位文件 `~/.claw-mem/.quota.reserved`

### 路径 B — 接入现有链（testnet/mainnet）

```bash
claw-mem init                          # 写一份基础 config
claw-mem doctor                        # 检查环境

# 交互式向导，会校验 RPC 可达 + 每个合约地址都有 bytecode
claw-mem bootstrap prod

# 或者非交互方式（CI 友好）
claw-mem bootstrap prod --non-interactive \
  --rpc https://rpc.coc.network \
  --pose-manager 0xPOSE... \
  --soul-registry 0xSOUL... \
  --did-registry 0xDID... \
  --private-key 0x<64 hex>

claw-mem backup register               # 在 SoulRegistry 创建你的灵魂
claw-mem backup create                 # 第一次备份
claw-mem backup heartbeat              # 周期心跳保持 alive
```

---

## 4. 核心概念

### 4.1 记忆层

每次 agent 用工具时，claw-mem 在 **after_tool_call** hook 里捕获一条 **Observation**（结构化：title + facts + concepts + 涉及的文件）。

会话结束时（**agent_end** hook），所有 observation 被压缩成一份 **SessionSummary**。

下一次会话启动时（**before_prompt_build** hook），最近的 summaries + observations 经过 **token-budgeted 选择**，注入到 prompt 顶部。

```
Session N                    Session N+1
─────────                   ─────────────
[after_tool_call] → Obs     [session_start] ←
[after_tool_call] → Obs     [before_prompt] ← memory injected (≤ tokenBudget)
[after_tool_call] → Obs
   ...
[agent_end]       → Summary
[session_end]
```

数据全部存在 `~/.claw-mem/claw-mem.db`（SQLite + FTS5 全文索引）。

调试 prompt 注入：`claw-mem mem peek` 显示**下次会注入的内容**。

### 4.2 COC 节点类型

| 类型 | 用途 | services | BFT | 适合场景 |
|------|------|---------|-----|---------|
| `dev` | 单机开发，预存测试账户 | node | off | 写代码调试 |
| `validator` | BFT 共识 + 出块 | node, agent | on | 主网验证人 |
| `fullnode` | 同步 + RPC，不出块 | node | off | 普通 RPC 提供者 |
| `archive` | 全历史，无 pruning | node | off | 区块浏览器 / 索引服务 |
| `gateway` | 内存存储，仅 RPC 代理 | node | off | 边缘节点 |

每种 type 对应一组 `configOverrides`（看 `src/shared/presets.ts`）。

### 4.3 256 MiB 协议门槛 — 落地

```
config.storage.quotaBytes      = 268_435_456   ← 本地硬上限（install 拒超配）
config.storage.advertisedBytes = 268_435_456   ← 写入 node-config.json 的 advertisedStorageBytes
config.storage.reservedBytes   = 268_435_456   ← fallocate 占位文件防 OS 把盘吃光
```

调成 1 GiB：
```bash
claw-mem config set storage.quotaBytes      1073741824
claw-mem config set storage.advertisedBytes 1073741824
claw-mem config set storage.reservedBytes   1073741824
```

### 4.4 Soul backup 数据流

```
~/.openclaw/                        ~/.claw-mem/
  IDENTITY.md                         claw-mem.db (semantic snapshot 抽自这里)
  MEMORY.md                                ↓
  config/                          [BackupManager.runBackup()]
  chat/                                    ↓
  workspace/             →  build manifest (JSON)
                                           ↓
                          encrypt（可选）+ 切片 → IPFS → manifestCid
                                           ↓
                          SoulRegistry.anchorBackup(agentId, manifestCid, ...)
                                           ↓
                                  archive_store 表记一笔 + Heartbeat
```

恢复时反过来：`backup restore --manifest-cid <cid>` 或 `soul-auto-restore` 自动解析最新 CID。

### 4.5 Resurrection / 灾难恢复

如果 agent 离线超过 `maxOfflineDuration`（默认 24h）：

- **Owner-key 路径**：拿着 resurrection key 的人调 `backup resurrection start --carrier-id ... --resurrection-key ...`
- **Guardian-vote 路径**：guardian 们投票（2/3 quorum）→ `guardian initiate` → 其他 guardian `guardian approve` → 最后 `complete`
- 任一路径完成后，agent 在 carrier 上"复活"（carrier daemon 拉 backup → 启动新 agent 进程）

### 4.6 Social recovery

如果 owner 私钥丢了：guardian 们可以投票转移 ownership 到一个新地址。流程类似 resurrection 但操作的是 ownership 而非运行实例。

### 4.7 DID

SoulRegistry 之外，可选挂一个 DIDRegistry：管理 verification methods、delegations（最多 3 层、scope-limited、time-bound）、ephemeral identity、verifiable credentials、agent lineage。

---

## 5. 配置文件

### 位置

`~/.claw-mem/config.json`（首次 `init` 创建；任何 CLI 命令都可以读）。

也可以 `--config /path/to/your.json` 临时指定。

### 完整 schema

```jsonc
{
  "enabled": true,
  "dataDir": "",                              // 默认 ~/.claw-mem

  // ─── 记忆层（保留旧 claw-mem 字段，向后兼容） ───
  "tokenBudget": 8000,
  "maxObservations": 50,
  "maxSummaries": 10,
  "dedupWindowMs": 30000,
  "skipTools": ["TodoWrite", "AskUserQuestion", "Skill"],

  // ─── 存储 / P2P 门槛 ───
  "storage": {
    "quotaBytes": 268435456,                  // 本地硬上限
    "advertisedBytes": 268435456,             // ≥ 256 MiB
    "reservedBytes": 268435456,               // fallocate 占位
    "enforceQuota": true,
    "reserveFile": ".quota.reserved"
  },

  // ─── 节点 ───
  "node": {
    "enabled": true,
    "runtimeDir": null,                       // 留空则从 bootstrap.cocRepoPath 推
    "defaultType": "dev",
    "defaultNetwork": "local",
    "port": 18780,
    "bind": "127.0.0.1",
    "agent":   { "enabled": true, "intervalMs": 60000, "batchSize": 5, "sampleSize": 2 },
    "relayer": { "enabled": false, "intervalMs": 60000 },
    "autoAdvertiseStorage": true              // 把 advertisedBytes 写进 node-config.json
  },

  // ─── 备份 ───
  "backup": {
    "enabled": true,
    "sourceDir": "~/.openclaw",               // 要备份的源目录
    "rpcUrl": "http://127.0.0.1:18780",
    "ipfsUrl": "http://127.0.0.1:5001",
    "contractAddress": "0x...",               // SoulRegistry — 必填才能 backup
    "didRegistryAddress": "0x...",            // 可选，启用 did 命令组
    "privateKey": "0x...",                    // operator 私钥 — 必填
    "rpcAuthToken": null,
    "autoBackup": true,
    "autoBackupIntervalMs": 3600000,          // 每小时
    "maxIncrementalChain": 10,
    "encryptMemory": false,
    "encryptionPassword": null,
    "backupOnSessionEnd": true,
    "semanticSnapshot": {
      "enabled": true, "tokenBudget": 8000,
      "maxObservations": 50, "maxSummaries": 10
    },
    "categories": {
      "identity": true, "config": true, "memory": true,
      "chat": true, "workspace": true, "database": true
    },
    "carrier": {
      "enabled": false,
      "carrierId": null,
      "agentEntryScript": null,
      "workDir": "/tmp/coc-resurrections",
      "watchedAgents": [],
      "pendingRequestIds": [],
      "pollIntervalMs": 60000,
      "readinessTimeoutMs": 86400000,
      "readinessPollMs": 30000
    }
  },

  // ─── Bootstrap ───
  "bootstrap": {
    "mode": "none",                           // none | dev | prod
    "hardhatPort": 8545,
    "hardhatNetworkName": "claw-mem-local",
    "autoFundEther": "0.1",
    "operatorKeyPath": null,                  // 默认 ~/.claw-mem/keys/operator.key
    "cocRepoPath": null,                      // 默认 auto-discover
    "skipIfReady": true
  }
}
```

### 编辑方式

```bash
# 单字段
claw-mem config set storage.quotaBytes 536870912
claw-mem config set backup.contractAddress 0x...

# JSON 值
claw-mem config set backup.categories '{"identity":true,"config":false}' --json

# 看一个值
claw-mem config get node.port

# 全文 dump
claw-mem config list

# 仅看一段
claw-mem config list --section backup

# 路径
claw-mem config path
```

> ⚠️ `config set` 写盘后**不会影响当前进程**——下次启动才生效。

---

## 6. 命令参考

每个命令都支持 `--help`。下方是详细说明 + 典型用法。

### 6.1 入门 / 维护命令

#### `claw-mem status [--json]`

一屏总览：memory 行数 / 节点列表 / backup 配置完整度 / bootstrap 状态 / storage 配额。

```text
═══ claw-mem status ═══
Memory:
  observations: 142
  summaries:    18
  ...
Nodes (1):
  dev-1            dev        local    node               256MiB   :18780
Backup:
  configured:     yes
  ...
```

#### `claw-mem doctor [--json] [--ports a,b,c]`

环境检查（11 项）：Node 版本、DB 可打开、schema 版本、COC repo 可达、hardhat 装没装、磁盘空间、占位文件、6 个端口、backup 配置、operator key。

退出码：有 `fail` 项时非 0。

```bash
claw-mem doctor                        # 默认检查 6 个端口
claw-mem doctor --ports 8545,18780     # 自定义端口列表
claw-mem doctor --json | jq .          # 机器可读
```

#### `claw-mem init [--force] [--non-interactive]`

首次设置向导（@clack/prompts）：选 cocRepoPath / sourceDir / quota / bootstrap 模式 / 是否立即配 backup。

- `--non-interactive`：写默认值跑路（适合 CI 或脚本初始化）
- `--force`：覆盖已存在的 config.json

#### `claw-mem version [--json]`

版本信息：claw-mem 版本 / schema version / Node version / COC repo 路径 / 数据库位置。

#### `claw-mem tools list [--with-schema] [--json]`

列出 26 个 agent tool（按 memory / node / backup 分组）。`--with-schema` 显示每个工具的参数 schema。

#### `claw-mem uninstall [--yes] [--purge-keys] [--keep-database] [--dry-run]`

清理 `~/.claw-mem/`：

- 默认保留 `keys/`（operator 私钥可能是访问链上备份的唯一凭证）
- `--keep-database` 只删 nodes/logs/backup/archives，留 SQLite
- `--purge-keys` 也删 keys（**慎用**）
- `--dry-run` 只列出会删什么，不真删

### 6.2 `mem` — 记忆

#### `claw-mem mem search <query> [--limit N] [--type T] [--agent A] [--json]`

FTS5 全文搜索，按观察类型 / agent 过滤。

```bash
claw-mem mem search "Redis cache" --limit 5
claw-mem mem search "migration" --type decision --json
```

#### `claw-mem mem status [--json]`

行数 + agent 列表 + DB 路径 + token 预算。

#### `claw-mem mem forget <sessionId>`

删某个会话的 observations。

#### `claw-mem mem peek [--agent A] [--json]`

⭐ **关键调试工具**：显示下一次 prompt 会注入的 markdown + 实际 token 用量。

```bash
claw-mem mem peek
# Agent: my-agent
# Tokens: 1542 / 8000
# Observations: 12, summaries: 3
# ─────────────────────────────────────────────
# ## Recent observations
# ...
```

#### `claw-mem mem prune --older-than <days> [--include-summaries] [--include-sessions] [--agent A] [--dry-run]`

按天数切。`--dry-run` 只报数。删完建议跑 `claw-mem db vacuum` 回收空间。

```bash
claw-mem mem prune --older-than 30 --dry-run
claw-mem mem prune --older-than 30 --include-summaries --include-sessions
```

#### `claw-mem mem export <file> [--agent A]` / `claw-mem mem import <file> [--skip-existing]`

跨机迁移。Export 是 JSON v1 格式，Import 默认按 `(session_id, content_hash)` 去重（observations 表无 UNIQUE 约束）。

```bash
claw-mem mem export /tmp/mem.json
scp /tmp/mem.json other-host:/tmp/
ssh other-host claw-mem mem import /tmp/mem.json
```

### 6.3 `node` — COC 节点

#### `claw-mem node install [--type] [--network] [--name] [--rpc-port] [--advertised-bytes]`

无 flag 时进交互向导。

```bash
# 非交互
claw-mem node install -t dev -n local --name dev-1 --rpc-port 18780

# 交互（@clack/prompts）
claw-mem node install
```

写完后磁盘会有 `~/.claw-mem/nodes/<name>/{node-config.json, node-key, logs/}`。

#### `claw-mem node list [--json]`

表格：NAME | TYPE | NETWORK | SERVICES | STORAGE | CREATED

#### `claw-mem node start [name]` / `stop [name]` / `restart [name]`

无 name 时对所有节点操作。`stop` 反向遍历（防服务依赖）。

> ⚠️ `start` 之前会**预检 cocRepoPath**，找不到就 fail-fast 给修复建议。

#### `claw-mem node status [name] [--json]`

带 RPC 实时状态：blockHeight / peerCount / 各 service 的 PID。

#### `claw-mem node remove <name> [--yes] [--keep-data]`

默认删数据目录；`--keep-data` 仅取消注册。

#### `claw-mem node config show [name]` / `claw-mem node config edit <name>`

`edit` 用 `$EDITOR` 打开 `node-config.json`（默认 `vi`）。

#### `claw-mem node logs <name> [-f] [--service node|agent|relayer] [--all] [--lines N]`

查日志。`--all` 同时 tail node + agent + relayer 三个 service。

```bash
claw-mem node logs dev-1                       # 默认 service=node, 最近 100 行
claw-mem node logs dev-1 --service agent -f   # follow agent
claw-mem node logs dev-1 --all -f             # follow 三个 service（多文件 tail -f）
```

### 6.4 `backup` — 灵魂备份 / 恢复

#### `claw-mem backup configure [--non-interactive]`

⭐ **第一次配 backup 的入口**。交互向导：RPC / IPFS / SoulRegistry / DIDRegistry / privateKey（粘贴 / 生成新 / 保留旧三选一）。

`--non-interactive`：仅在 privateKey 缺失时生成一个，其他字段不动。

#### `claw-mem backup init [--agent-id] [--identity-cid] [--key-hash] [--max-offline]`

一条龙：注册灵魂 + 跑首次完整备份 + 写本地 recovery 元数据 + （可选）配 resurrection。

#### `claw-mem backup register [--agent-id] [--identity-cid]`

仅注册灵魂（不跑备份）。

#### `claw-mem backup create [--full]`

跑一次备份。默认增量，`--full` 强制全量。

#### `claw-mem backup restore --manifest-cid <cid> [--target-dir D] [--password]`

从给定 CID 恢复。也支持：
- `--package <path>`：从本地 recovery package JSON 恢复
- `--latest-local`：用最新本地 recovery package

#### `claw-mem backup list [--limit N] [--agent A] [--json]` / `history [--limit N]`

本地 archive 索引。`history` 是 `list` 的别名。

#### `claw-mem backup status [--json]` / `doctor [--json]`

`status` 是简版（生命周期 + 链上是否注册），`doctor` 是详版（含推荐动作）。

#### `claw-mem backup heartbeat`

发心跳（重置离线计时器）。建议设个 cron 每 hour 跑一次：

```cron
0 * * * * /usr/local/bin/claw-mem backup heartbeat >> /var/log/claw-mem-heartbeat.log 2>&1
```

#### `claw-mem backup configure-resurrection --key-hash <hash> [--max-offline 86400]`

设 resurrection 公钥的 keccak256 hash + 最大离线时长。

#### `claw-mem backup resurrection { start | status | confirm | complete | cancel }`

owner-key 路径的复活流程。

```bash
claw-mem backup resurrection start --carrier-id 0x... --resurrection-key 0x<64hex>
claw-mem backup resurrection status        # 默认读本地 pending request
claw-mem backup resurrection confirm
claw-mem backup resurrection complete
```

#### `claw-mem backup prune --older-than <days> [--keep-latest N] [--agent A] [--dry-run]`

清本地 archive 索引（**不会** unpin IPFS 上的数据）。

```bash
# 保留每 agent 最近 5 份，删掉超过 90 天的
claw-mem backup prune --older-than 90 --keep-latest 5
```

#### `claw-mem backup find-recoverable [--agent A] [--owner ADDR] [--on-chain] [--json]`

列出可恢复的备份。`--on-chain` 会查 SoulRegistry 拿每个 agent 的最新链上 CID。

### 6.5 `carrier` — 灵魂托管

#### `claw-mem carrier status`

显示 daemon 是 enabled / running 状态。

#### `claw-mem carrier list [--from-block N] [--include-inactive] [--json]`

⭐ **不需要外部索引器**：内部用 `contract.queryFilter()` 走 `CarrierRegistered` / `CarrierDeregistered` 事件。

```bash
claw-mem carrier list                         # 默认 fromBlock=earliest
claw-mem carrier list --from-block 1000000    # 大链上必须缩范围
claw-mem carrier list --include-inactive --json
```

#### `claw-mem carrier register --carrier-id <id> --endpoint <url> [--cpu] [--memory] [--storage]`

链上注册成 carrier provider。

#### `claw-mem carrier deregister --carrier-id <id>`

#### `claw-mem carrier availability --carrier-id <id> --available true|false`

#### `claw-mem carrier info --carrier-id <id> [--json]`

读链上某个 carrier 的当前状态。

#### `claw-mem carrier submit-request --request-id <id> --agent-id <id>`

把一个 pending resurrection request 提交给本地 carrier daemon 处理。

#### `claw-mem carrier start` / `claw-mem carrier stop`

启停 carrier daemon。仅当 `config.backup.carrier.enabled=true` 且有 `carrierId` + `agentEntryScript` 时 start 才生效。

### 6.6 `guardian` — 监护人操作

```bash
# guardian 集合管理
claw-mem guardian add    --guardian 0x... [--agent-id 0x...]
claw-mem guardian remove --guardian 0x... [--agent-id 0x...]
claw-mem guardian list   [--agent-id 0x...] [--json]

# guardian 触发的 resurrection 流程
claw-mem guardian initiate --agent-id 0x... --carrier-id 0x...
claw-mem guardian approve  --request-id 0x...
claw-mem guardian status   --request-id 0x... [--json]
```

### 6.7 `recovery` — 社交恢复（owner 迁移）

```bash
# 1. 任一 guardian 发起：转移 ownership 到 newOwner
claw-mem recovery initiate --agent-id 0x... --new-owner 0x...

# 2. 其他 guardian approve（达到 2/3 quorum）
claw-mem recovery approve --request-id 0x...

# 3. 时间锁过后，complete
claw-mem recovery complete --request-id 0x...

# 旧 owner 可以 cancel（若还在时间锁内）
claw-mem recovery cancel --request-id 0x...

# 看进度
claw-mem recovery status --request-id 0x... [--json]
```

### 6.8 `did` — DID 身份管理（14 个子命令）

需要 `backup.didRegistryAddress` 已设。

| 命令 | 用途 |
|------|------|
| `did add-key` | 加一个 verification method |
| `did revoke-key` | 撤销 verification method |
| `did keys --agent-id` | 列出 active keys |
| `did delegate` | 授予 delegation（depth ≤ 3, scope-limited, time-bound）|
| `did revoke-delegation` | 撤销单个 delegation |
| `did revoke-all-delegations` | 紧急：清空一个 agent 所有 delegation |
| `did delegations --agent-id` | 列出 agent 的 delegation |
| `did update-doc` | 更新 DID document CID |
| `did anchor-credential` | 锚定 verifiable credential |
| `did revoke-credential` | 撤销 credential |
| `did record-lineage` | 记录 fork 关系（parent + generation）|
| `did update-capabilities` | 更新 capability bitmask |
| `did create-ephemeral` | 创建临时子身份 |
| `did deactivate-ephemeral` | 停用临时身份 |

Key purpose bitmask（`did add-key --purpose`）：
- `1` = authentication
- `2` = assertion
- `4` = capability invocation
- `8` = capability delegation

组合：`--purpose 5` = auth + capInvoke。

### 6.9 `bootstrap` — 端到端栈启动

#### `claw-mem bootstrap dev [--hardhat-port] [--fund] [--skip-contracts] [--skip-first-backup] [--coc-repo PATH] [--name N]`

18 步全自动（见 §7.1 详细分解）。

#### `claw-mem bootstrap prod [--non-interactive] [--rpc] [--pose-manager] [--soul-registry] [--did-registry] [--cid-registry] [--private-key]`

接入现有链。交互式时会校验：
- RPC `eth_chainId` 可达
- 每个合约 `eth_getCode != "0x"`
- 私钥能算出地址 + 显示 ETH 余额

#### `claw-mem bootstrap status [--json]`

hardhat / 节点 / 合约 / operator 当前状态。

#### `claw-mem bootstrap teardown [--yes] [--keep-keys]`

停所有 bootstrap 起的进程 + 清 local network artifacts。**默认保留 keys 文件**。

#### `claw-mem bootstrap logs [-f] [--lines N]`

tail `~/.claw-mem/logs/hardhat.log`。

### 6.10 `db` — SQLite 维护

| 命令 | 用途 |
|------|------|
| `claw-mem db migrate-status [--json]` | 当前 vs 最新 schema version |
| `claw-mem db size [--json]` | main / wal / shm 字节数 |
| `claw-mem db vacuum [--json]` | VACUUM，回收 prune 后的空间 |

### 6.11 `config` — 持久化配置

见 §5。

---

## 7. 典型工作流

### 7.1 本地 dev — `bootstrap dev` 18 步详解

| 步 | 干啥 | 失败时 |
|---|------|-------|
| 1 | 定位 COC repo（cocRepoPath / `COC_REPO_PATH` env / 自动找）| throw |
| 2 | Node ≥ 22 + 磁盘 ≥ quotaBytes 检查 | throw |
| 3 | `fallocate -l 256M ~/.claw-mem/.quota.reserved`（fallback truncate / fs.truncate）| warn |
| 4 | 端口预检：8545 / 18780-1 / 19780-1 / 5001 | throw + 列冲突 |
| 5 | `skipIfReady`：hardhat PID 还活着就跳过下面几步 | — |
| 6 | spawn `npx hardhat node --port 8545`（在 cocRepoPath/contracts 下）| SIGTERM |
| 7 | 轮询 `eth_chainId` 等 L1 ready（2s × 20）| throw |
| 8 | `Wallet.createRandom()` 生成 operator key，写 `~/.claw-mem/keys/operator.key` (0600) | rm |
| 9 | hardhat account #0 转 `autoFundEther` (默认 0.1 ETH) → operator | teardown 6 |
| 10 | **真实部署合约**：检查 `contracts/artifacts/`，没有就 `npx hardhat compile`，然后用 ethers ContractFactory 部署 PoSeManagerV2 / SoulRegistry / CidRegistry / DIDRegistry | warn 单个失败 |
| 11 | 生成 node-config.json（注入 `advertisedStorageBytes` + 合约地址）| rm node dir |
| 12 | NodeStore upsert | nodeStore.delete |
| 13 | spawn coc-node + coc-agent | stopNode |
| 14 | 健康检查：轮询 `eth_blockNumber ≥ 0x1`（5s × 12）| warn |
| 15 | tail `coc-agent.log` 找 `ensureNodeRegistered (succeeded\|already registered\|complete)`（45s timeout）| warn |
| 16 | operator key 写盘到 `backup.privateKey`（如果该字段为空）| warn 时给手动恢复命令 |
| 17 | 如果 backup.enabled + soulRegistry deployed → 跑首次 full backup | warn |
| 18 | 打印 summary（CLI 渲染，logger 不再重复）| — |

`teardown` 反向：stop nodes → kill hardhat → 清 `coc_artifacts.network='local'`，**保留 keys/**（用户决定何时清）。

### 7.2 接入测试网 / 主网

```bash
claw-mem init                                     # 写基础配置
claw-mem doctor                                   # 排查环境
claw-mem bootstrap prod                           # 交互式接入

# bootstrap prod 之后：
claw-mem backup register                          # 链上创建灵魂
claw-mem backup configure-resurrection \          # （可选）设 resurrection 公钥
  --key-hash $(echo -n 0xMyResurrectionPubAddr | xxd -p | xxd -r -p | sha3sum)
claw-mem guardian add --guardian 0xFRIEND_A       # 加监护人
claw-mem guardian add --guardian 0xFRIEND_B
claw-mem guardian add --guardian 0xFRIEND_C
claw-mem backup create                            # 第一次备份

# 每天定时
crontab -e
# 0 * * * * claw-mem backup heartbeat
# 30 2 * * * claw-mem backup create
# 0 3 * * 0 claw-mem db vacuum && claw-mem backup prune --older-than 90 --keep-latest 10
```

### 7.3 日常运行（OpenClaw 内 agent 自动用）

如果 claw-mem 通过 OpenClaw 加载（`openclaw.json` 注册过），它在 `activate()` 里：

1. 注册 5 个生命周期 hook（session_start / before_prompt_build / after_tool_call / agent_end / session_end）
2. 注册 26 个 agent tool（mem-* / coc-* / soul-*）
3. 启动 backup auto-scheduler（如果 `backup.autoBackup=true`）
4. 启动 carrier daemon（如果 `backup.carrier.enabled=true`）
5. 把 CLI 命令注册成 OpenClaw 子命令（`openclaw mem ...` / `openclaw node ...` 等）

用户什么都不用做。Agent 会自然地：
- 自动捕获 observation（无 LLM 开销，启发式抽取）
- 自动注入 memory context（before_prompt_build）
- 自动 backup（autoBackupIntervalMs + session_end + before_compaction + gateway_stop）

调试：`claw-mem mem peek` 看下次注入；`claw-mem backup status` 看备份健康度。

### 7.4 跨机迁移

```bash
# 老机器
claw-mem mem export /tmp/mem.json
claw-mem config get backup.privateKey                  # 单独抄走（注意安全）
scp /tmp/mem.json new-host:/tmp/

# 新机器
claw-mem init --non-interactive
claw-mem config set backup.privateKey 0x<old-private-key>
claw-mem mem import /tmp/mem.json
claw-mem doctor
```

如果想连灵魂一起搬：在老机器 `claw-mem backup create --full` → 拿到 manifestCid → 新机器 `claw-mem backup restore --manifest-cid <cid>`。

### 7.5 灾难恢复 — owner key 还在

```bash
# 在新机器
claw-mem init --non-interactive
claw-mem config set backup.rpcUrl <chain-rpc>
claw-mem config set backup.contractAddress <SoulRegistry>
claw-mem config set backup.privateKey <owner-private-key>

# 自动找最新 CID 并恢复
claw-mem backup find-recoverable --on-chain
# 假设输出: agent 0xabc...  cid=QmXYZ...

claw-mem backup restore --manifest-cid QmXYZ...
```

或一步：通过 agent tool `soul-auto-restore`（自动从 wallet 解析 agentId、找最新 CID、下载、解密、校验）。

### 7.6 灾难恢复 — owner key 丢了，guardian 接手

**需要：** 已经设置好 ≥ 3 个 guardian，且 `2/3` 还在线。

```bash
# Guardian A 发起 ownership 转移
claw-mem recovery initiate --agent-id 0xabc... --new-owner 0xNEW...
# 输出 Request ID: 0xreq...

# Guardian B 投票
claw-mem recovery approve --request-id 0xreq...

# Guardian C 投票
claw-mem recovery approve --request-id 0xreq...

# 看是否达 quorum
claw-mem recovery status --request-id 0xreq...

# 时间锁过后，任一 guardian
claw-mem recovery complete --request-id 0xreq...
# 现在 0xNEW 是新 owner，可以 backup restore 拉数据
```

### 7.7 成为 carrier

```bash
# 1. 在链上注册 carrier
claw-mem carrier register \
  --carrier-id $(echo -n my-carrier-1 | xxd -p | head -c 64 | xxd -r -p | sha3sum) \
  --endpoint https://my-carrier.example.com \
  --cpu 4000 --memory 8192 --storage 102400

# 2. 配 carrier 模式
claw-mem config set backup.carrier.enabled true --json
claw-mem config set backup.carrier.carrierId 0x<carrier-id>
claw-mem config set backup.carrier.agentEntryScript /opt/openclaw/start-resurrected-agent.sh
claw-mem config set backup.carrier.workDir /var/lib/coc-resurrections

# 3. 重启 OpenClaw（让 carrier daemon 自动起）
# 或独立启动
claw-mem carrier start
claw-mem carrier status

# 4. 看本节点处理过哪些 resurrection 请求
sqlite3 ~/.claw-mem/claw-mem.db "SELECT * FROM carrier_requests"
```

### 7.8 多 agent 切换

claw-mem 通过 agentId 隔离记忆。同一台机器上跑多个 agent 时，OpenClaw 会传不同的 `agentId` 进 hook，记忆自然分桶。

CLI 里很多查询命令都接受 `--agent <id>`：
```bash
claw-mem mem search "..."         --agent agent-1
claw-mem mem export /tmp/a1.json  --agent agent-1
claw-mem mem prune --older-than 30 --agent agent-1
claw-mem backup find-recoverable --agent agent-1
```

### 7.9 升级 / 数据迁移

```bash
# 装新版前先备份
claw-mem mem export /tmp/pre-upgrade.json
claw-mem db migrate-status

# 升级
npm install -g @openclaw/claw-mem@latest

# 升级后第一次启动会自动跑 migration（ADD-only，老数据不动）
claw-mem db migrate-status                 # 应该显示 "up to date"
claw-mem doctor

# 出问题时回滚
claw-mem mem import /tmp/pre-upgrade.json
```

---

## 8. Agent tools 参考

`claw-mem tools list` 列出全部 26 个。摘要：

### Memory（3）
| 工具 | 用途 |
|------|------|
| `mem-search` | 查历史 observation（FTS5）|
| `mem-status` | 行数 + agent 列表 |
| `mem-forget` | 删某 session 的 observation |

### Node（10）
| 工具 | 用途 |
|------|------|
| `coc-node-init` | 装一个新节点（=`node install` 的工具版）|
| `coc-node-list` / `start` / `stop` / `restart` / `status` / `remove` | 节点生命周期 |
| `coc-node-config` | 看 / patch node-config.json |
| `coc-node-logs` | 拿日志末尾 N 行 |
| `coc-rpc-query` | 走白名单的 read-only RPC（`eth_blockNumber` / `coc_chainStats` 等）|

### Soul（13）
| 工具 | 用途 |
|------|------|
| `soul-backup` / `soul-restore` / `soul-status` / `soul-doctor` | 基础四件套 |
| `soul-memory-search` | 直接查 claw-mem 数据库（用 RecoveryManager 的入口）|
| `soul-auto-restore` | 一键恢复（从 wallet 解析 agentId → 找最新 CID → 下载校验）|
| `soul-resurrection` | owner-key 复活流程（5 个 action）|
| `soul-carrier-request` | 把 resurrection request 推给本地 carrier daemon |
| `soul-guardian-initiate` / `soul-guardian-approve` / `soul-guardian-manage` | guardian 操作 |
| `soul-recovery-initiate` / `soul-recovery-approve` | 社交恢复 |

Agent 不需要专门 prompt 用这些 tool —— OpenClaw 会按需暴露。

---

## 9. 排错

### 9.1 第一步永远是 `doctor`

```bash
claw-mem doctor
```

输出会指明每项的修法。常见结果：

```
[ ⚠ ] coc-repo               COC repo not located. Set bootstrap.cocRepoPath ...
        ↳ Required for `node start` and `bootstrap dev`
```
→ `claw-mem config set bootstrap.cocRepoPath /path/to/COC` 或 `export COC_REPO_PATH=...`

```
[ ⚠ ] hardhat                hardhat not installed
        ↳ Run: cd /path/to/COC/contracts && npm install
```
→ 照做。

```
[ ⚠ ] backup-config          Backup enabled but missing contractAddress / privateKey
        ↳ Run `claw-mem backup configure`
```
→ 见 §6.4。

```
[ ✗ ] disk-space             50 MiB free (need 256 MiB)
```
→ 清磁盘，或调小 `storage.quotaBytes`（但低于 256 MiB 会破坏 P2P 协议门槛）。

### 9.2 常见错误信息

| 错误信息 | 原因 | 修法 |
|---------|------|------|
| `Backup not configured. Missing required fields: contractAddress, privateKey` | backup.* 未设 | `claw-mem backup configure` |
| `[node start] COC repo not located` | install 时只 warn，start 时硬错 | `claw-mem config set bootstrap.cocRepoPath ...` |
| `Port 8545 in use` | 别的 hardhat 跑着 / IPFS daemon | `lsof -i :8545` 找出来 kill，或 `--hardhat-port 9545` |
| `advertisedBytes 1024 is below the COC P2P minimum (256 MiB)` | 试图把节点声明的存储调到 256 MiB 以下 | 改回 `268435456` |
| `Storage quota exceeded` | 磁盘已经用超 quotaBytes | 调高 `storage.quotaBytes`，或删点东西 |
| `RPC ... unreachable` (bootstrap prod) | RPC URL 错 / 网络不通 | 检查 URL，`curl -X POST -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' <url>` |
| `0x... has no bytecode at this RPC` | 合约地址错或不在这条链上 | 重新确认部署地址 |
| `DID operations require backup.didRegistryAddress` | 没设 DIDRegistry 地址 | `claw-mem config set backup.didRegistryAddress 0x...` |

### 9.3 日志位置

| 进程 | 文件 |
|------|------|
| coc-node | `~/.claw-mem/nodes/<name>/coc-node.log` |
| coc-agent | `~/.claw-mem/nodes/<name>/coc-agent.log` |
| coc-relayer | `~/.claw-mem/nodes/<name>/coc-relayer.log` |
| hardhat (bootstrap dev) | `~/.claw-mem/logs/hardhat.log` |

PID 文件在同一目录下（`coc-*.pid` / `hardhat.pid`）。

通过 CLI 看：
```bash
claw-mem node logs <name>            # 默认 service=node
claw-mem node logs <name> --all -f
claw-mem bootstrap logs -f
```

### 9.4 记忆没注入 / agent 还是健忘

排查清单：
1. `claw-mem mem status` —— observations 数 > 0 吗？没的话是 hook 没装上（OpenClaw 没正确加载 claw-mem）。
2. `claw-mem mem peek --agent <agentId>` —— peek 出来的 markdown 是空的吗？
   - `Tokens: 0 / 8000` → token 预算被全部裁掉了，调大 `tokenBudget`
   - 内容存在但 agent 没用到 → OpenClaw 那边没把 `prependContext` 真的注入 prompt（看 OpenClaw 日志）
3. agent ID 对不对？（多 agent 场景）`claw-mem mem status` 看 agents 列表。

### 9.5 备份失败

```bash
claw-mem backup doctor      # 完整诊断
```

doctor 会告诉你：
- 是否注册过灵魂
- backup count
- 上次 backup 时间
- IPFS 是否可达
- 是否有未完成的 resurrection request
- **推荐的下一步动作**

### 9.6 carrier daemon 起不来

```bash
claw-mem carrier status
```

输出 `enabled: false` 时检查：
```bash
claw-mem config get backup.carrier.enabled         # 必须 true
claw-mem config get backup.carrier.carrierId       # 必须设
claw-mem config get backup.carrier.agentEntryScript # 必须存在的可执行
```

输出 `enabled: true, running: false` 但启动失败 → 看 OpenClaw 日志（carrier daemon 在 `activate()` 内部启动，错误进 logger）。

### 9.7 数据库锁

claw-mem 用 SQLite WAL + busy_timeout=5000，正常情况下不会撞锁。如果撞了：
```bash
claw-mem db size                   # 看 wal/shm 大小
claw-mem db vacuum                 # 强制 checkpoint
```

> ⚠️ 如果 OpenClaw 进程还在跑，**不要**手动删 `claw-mem.db-wal`。

---

## 10. FAQ

**Q1. claw-mem 一定要装 OpenClaw 才能用吗？**

不要。CLI（`claw-mem ...`）独立可用，所有命令都能在 shell 里跑。OpenClaw 集成是额外的便利层（自动 hook + 把 CLI 注册成 `openclaw mem ...` 子命令）。

**Q2. 我能不开 backup，只用记忆层吗？**

可以。`config set backup.enabled false` 即可。记忆层、节点层、配置层都独立工作。

**Q3. 256 MiB 是必须的吗？我只想本地玩。**

P2P 协议门槛是面向真实网络。本地 dev 模式下，`storage.advertisedBytes` 写进 node-config.json 但 COC node 当前版本不读这个字段——所以**不真正影响**本地运行。但 `storage.quotaBytes` 会限制本地磁盘占用，如果实在嫌占地方可以：
```bash
claw-mem config set storage.reservedBytes 0   # 别 fallocate 占位
claw-mem config set storage.enforceQuota false # 别拒超配
```
（仍然不能调 advertisedBytes < 256 MiB，那是 install 时的硬校验。）

**Q4. operator key 会被加密吗？**

`bootstrap dev` 写到 `~/.claw-mem/keys/operator.key`（chmod 600）和 `~/.claw-mem/config.json` 的 `backup.privateKey` 字段（**明文**）。生产用：
- 用单独的、专用的 EOA
- 给 config.json 也 `chmod 600`
- 严肃方案是改成走 keystore + 启动时输密码（claw-mem 当前未实现，欢迎 PR）

**Q5. 我把电脑搬了，CID 还能恢复吗？**

能。备份的整个意义就是这个。`claw-mem backup find-recoverable --on-chain` 找 agentId 对应的最新 CID，`backup restore --manifest-cid <cid>` 拉回来。

但**前提是 owner 私钥还在**。私钥丢 → 走 guardian / social recovery（§7.6）。

**Q6. 同一台机器跑多个 OpenClaw 实例可以吗？**

可以，但每个实例最好用不同的 `dataDir`：
```bash
CLAW_MEM_HOME=/srv/claw-mem-A openclaw start ...
CLAW_MEM_HOME=/srv/claw-mem-B openclaw start ...
```
（`CLAW_MEM_HOME` 不是直接生效的环境变量，要么改 `--config /path`，要么 `claw-mem config set dataDir /srv/claw-mem-A` 再启）。

**Q7. 我能 fork 这个项目吗？**

MIT 协议，随便 fork。

**Q8. 怎么贡献？**

先 `claw-mem doctor` 跑通，然后：
- 看 `.claude/plans/*.md` 了解架构
- `npm test` 跑全套（170 tests）
- `npm run typecheck` 验证类型
- 提 PR 时附 `claw-mem version --json` 输出

**Q9. 命令太多记不住，有 cheatsheet 吗？**

90% 时间只用这 5 个：
```bash
claw-mem status        # 我现在啥情况
claw-mem doctor        # 哪里有问题
claw-mem mem peek      # 下次会注入啥
claw-mem backup create # 立刻备份
claw-mem node status   # 节点活着吗
```

**Q10. 我能去掉 256 MiB 占位文件吗（dev 环境硬盘紧）？**

```bash
claw-mem config set storage.reservedBytes 0
rm ~/.claw-mem/.quota.reserved
```

---

## 11. 附录

### 11.1 文件布局

```
~/.claw-mem/
├── claw-mem.db                 # SQLite 主库
├── claw-mem.db-wal             # WAL 日志
├── claw-mem.db-shm             # WAL 共享内存
├── config.json                 # 用户配置（init 创建）
├── .quota.reserved             # 256 MiB 占位（fallocate）
├── keys/
│   └── operator.key            # bootstrap dev 生成的私钥（chmod 600）
├── nodes/
│   └── <node-name>/
│       ├── node-config.json
│       ├── node-key            # 节点身份私钥（chmod 600）
│       ├── coc-node.log
│       ├── coc-node.pid
│       ├── coc-agent.log
│       ├── coc-agent.pid
│       └── (chain data, leveldb)
├── logs/
│   └── hardhat.log             # bootstrap dev 起的 hardhat 日志
├── backup/                     # backup 状态文件（latest manifest 指针等）
└── archives/                   # 大块备份 payload（manifest JSON 等）
```

### 11.2 端口表

| 端口 | 服务 | 谁占 |
|------|------|------|
| 8545 | hardhat L1 | bootstrap dev |
| 18780 | COC node JSON-RPC | coc-node |
| 18781 | COC node WebSocket RPC | coc-node |
| 19780 | COC P2P (HTTP gossip) | coc-node |
| 19781 | COC Wire protocol (TCP) | coc-node |
| 5001 | IPFS HTTP API | coc-node |
| 9100 | Prometheus metrics | coc-agent |

`claw-mem doctor --ports 8545,18780,5001` 自定义检查。

### 11.3 schema v2 表（`~/.claw-mem/claw-mem.db`）

| 表 | 关键列 | 内容 |
|----|------|------|
| `observations` | id, session_id, agent_id, type, title, facts, narrative, concepts, files_*, content_hash, created_at_epoch | 单次工具调用产生的发现 |
| `observations_fts` | (FTS5 虚表) | title/narrative/facts/concepts 全文索引 |
| `session_summaries` | session_id (UNIQUE), agent_id, request, investigated, learned, completed, next_steps | 会话级压缩 |
| `sessions` | session_id (PK), agent_id, started_at_epoch, prompt_count | 会话元数据 |
| `coc_nodes` | name (PK), type, network, data_dir, services (JSON), advertised_bytes, rpc_port | NodeManager 注册表 |
| `backup_archives` | id, agent_id, manifest_cid (UNIQUE), backup_type, file_count, total_bytes, data_merkle_root, tx_hash, parent_cid, created_at_epoch | 备份历史索引 |
| `coc_artifacts` | key (PK), value, network, chain_id | 合约地址 / operator key 引用 |
| `carrier_requests` | request_id (PK), agent_id, carrier_id, status | carrier daemon 处理过的请求 |

### 11.4 网络名映射（`bootstrap prod` 解析后写入 `coc_artifacts.network`）

| chainId | network 名 |
|---------|-----------|
| 1 | mainnet |
| 11155111 | sepolia |
| 18780 | coc-testnet |
| 31337 | local |
| 其他 | `chain-<N>` |

### 11.5 退出码

| 命令 | 非 0 退出场景 |
|------|--------------|
| `doctor` | 任一项 fail |
| `node start/stop/...` | 操作失败 |
| `backup *` | 操作失败 / backup 未配置 |
| `bootstrap dev/prod` | 致命错误（端口占用 / 找不到 cocRepoPath / 等）|

### 11.6 推荐 cron

```cron
# 每 30 分钟心跳，防 isOffline
*/30 * * * * /usr/local/bin/claw-mem backup heartbeat 2>&1 | logger -t claw-mem

# 每天凌晨 2:30 全量备份
30 2 * * * /usr/local/bin/claw-mem backup create --full 2>&1 | logger -t claw-mem

# 每周日凌晨 3:00 维护：vacuum + prune
0 3 * * 0 /usr/local/bin/claw-mem db vacuum && \
          /usr/local/bin/claw-mem mem prune --older-than 90 --include-summaries && \
          /usr/local/bin/claw-mem backup prune --older-than 90 --keep-latest 10
```

### 11.7 可选环境变量

| 变量 | 作用 |
|------|------|
| `COC_REPO_PATH` | 覆盖 cocRepoPath |
| `EDITOR` | `claw-mem node config edit` 用什么编辑器（默认 `vi`）|
| `CLAW_MEM_DEBUG=1` | 打开 logger.debug 输出 |
| `HOME` | 改了会改变 `~/.claw-mem` 解析（测试有用）|

### 11.8 进一步阅读

- 架构设计：`.claude/plans/clawbot-claw-mem-openclaw-skills-coc-25-rustling-feigenbaum.md`
- 从 `coc-nodeops` / `coc-backup` 迁移：`docs/MIGRATION.md`
- COC 链本身：`COC/CLAUDE.md`
- DID 规范：`COC/docs/did-method-spec.zh.md`
- Soul Registry / 灵魂备份：`COC/docs/soul-registry-backup.zh.md`

---

**手册版本**：1.0（对应 claw-mem 1.0）
**许可**：MIT
**问题反馈**：https://github.com/NGPlateform/claw-mem/issues
