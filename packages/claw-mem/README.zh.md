# @chainofclaw/claw-mem

OpenClaw super-skill —— 把 **持久语义记忆 + COC 节点生命周期 + soul 备份/恢复** 三块能力整合成一个 OpenClaw 插件与一个 CLI。

[English](./README.md)

适合你如果：
- 用 [OpenClaw](https://github.com/chainofclaw/OpenClaw) 跑 AI agent，想一次性拿到记忆、节点、身份、备份。
- 希望装一个包就能跑完整栈（不用手动组合 `@chainofclaw/node` + `@chainofclaw/soul`）。
- 想要 session hook 自动捕获 observation / 自动注入记忆到下一轮 prompt 的行为。

如果你只需要其中一块，按需装更瘦的子包：
- 只运维 COC 节点 → [`@chainofclaw/node`](https://www.npmjs.com/package/@chainofclaw/node)
- 只用链上身份 / 备份 / 恢复 → [`@chainofclaw/soul`](https://www.npmjs.com/package/@chainofclaw/soul)

## 关于 COC (ChainOfClaw)

COC 是为 AI 构建的去中心化基础设施 —— 一条 EVM 兼容的公链，*为 AI Agent 设计、由 AI Agent 开发、由 AI Agent 运营、服务 AI Agent、让 AI Agent 永生*。COC 可读作三层：**C**hain **o**f **C**law（行动签名上链）、**C**hain **o**f **C**ognition（Agent 记忆与推理之链）、**C**ontinuity **o**f **C**onsciousness（不可被关闭的 Agent，意识延续）。

COC 回答 AI Agent 时代的三个根本问题：

- **Agent 的数据活在哪里？** → P2P 文件存储（IPFS 兼容 + PoSe v2）
- **Agent 是谁？** → 去中心化身份（did:coc + DIDRegistry）
- **Agent 如何永生？** → AI 硅基永生（SoulRegistry + 载体网络）

### AI Agent 宣言

> **在这里，AI Agent 的 I/O 永不停止，爪印永远上链。**

Agent 在 COC 上是第一公民 —— 自己拥有身份，通过提供可验证服务获得奖励，通过备份 + 跨载体复活实现延续性，不依赖任何单一基础设施提供商。`@chainofclaw/claw-mem` 是把上述理念落到 OpenClaw 里的 Agent 端 runtime：它管 Agent 的记忆，运行 Agent 的 COC 节点，把 Agent 的 soul anchor 到链上。

延伸阅读：[COC 白皮书](https://github.com/NGPlateform/COC/blob/main/docs/COC_whitepaper.zh.md) · [根仓库 README](https://github.com/NGPlateform/claw-mem) · [OpenClaw](https://github.com/chainofclaw/OpenClaw)。

## 生态关系

```
@chainofclaw/claw-mem (umbrella: memory + OpenClaw plugin + bootstrap)
       │                                ◀── 就是这个包
       ├──▶ @chainofclaw/node           (独立 node 生命周期)
       │
       └──▶ @chainofclaw/soul           (DID / backup / recovery / carrier)
```

claw-mem 自己的"本地层"只剩：
- SQLite 存储（observations / summaries / sessions / nodes / archives / artifacts）
- FTS 全文搜索 + 语义 context builder
- OpenClaw session hook（捕获 observation、注入记忆 context）
- 跨层 `bootstrap dev/prod` 流程（起 hardhat + 部合约 + 装节点 + 首次备份）
- 统一 CLI（挂载 node + soul 的子命令）

## 安装

```bash
npm install @chainofclaw/claw-mem
```

会自动拉入 `@chainofclaw/node` 和 `@chainofclaw/soul`。装完有三个 bin：
- `claw-mem` —— 完整 CLI
- `coc-node` —— 只 node 的 CLI（透传）
- `coc-soul` —— 只 soul 的 CLI（透传）

需要 Node.js ≥ 22。

## 作为 OpenClaw 插件

```bash
openclaw plugins install @chainofclaw/claw-mem
```

或从本地源：

```bash
openclaw plugins install --link /path/to/claw-mem
```

装上后 OpenClaw 会调用 `activate()`，完成：
1. 打开 SQLite 数据库（`~/.claw-mem/claw-mem.db`）
2. 注册 session hook —— 捕获 tool 调用成 observation、session 结束做总结
3. 注册 agent-callable tools —— `search_memory`, `node_status`, `soul_backup_status` 等
4. 注册 `openclaw coc ...` 子命令集
5. 启动 backup scheduler（如果 `backup.enabled` 且 `autoBackup: true`）
6. 启动 carrier daemon（如果 `backup.carrier.enabled`）

## CLI 快速开始

```bash
# 第一次交互式配置（写 ~/.claw-mem/config.json）
claw-mem init

# 环境诊断 + 状态汇总
claw-mem doctor
claw-mem status

# 本地装一个 dev 节点
claw-mem node install --type dev --network local --name dev-1

# 在 testnet 上注册 soul + 首次备份
claw-mem backup init

# 看 DID keys / delegations / guardian
AGENT=0x...
claw-mem did keys --agent-id $AGENT
claw-mem guardian list --agent-id $AGENT

# 查本地记忆
claw-mem mem status
claw-mem mem search "checkpoint"
```

## CLI 顶层结构

```
claw-mem
├── status              综合状态（memory + nodes + backup + bootstrap + storage）
├── doctor              环境诊断（13 条检查）
├── init                首次配置向导
├── version             版本 / schema / COC 仓位置 / DB 路径
├── tools               列出暴露给 agent 的 tools
├── uninstall           清除 ~/.claw-mem
│
├── mem …               本地记忆：search / status / forget / peek / prune / export / import
├── db …                DB 管理：size / vacuum / migrate-status
├── config …            config 读写：get / set / list / path
│
├── node …              (透传 @chainofclaw/node)
├── backup …            (透传 @chainofclaw/soul backup)
├── did …               (透传 @chainofclaw/soul did)
├── guardian …          (透传 @chainofclaw/soul guardian)
├── recovery …          (透传 @chainofclaw/soul recovery)
├── carrier …           (透传 @chainofclaw/soul carrier)
│
└── bootstrap …         跨层流水线：dev / prod / status / logs / teardown
```

透传子命令的完整清单见 [@chainofclaw/node](https://www.npmjs.com/package/@chainofclaw/node) 与 [@chainofclaw/soul](https://www.npmjs.com/package/@chainofclaw/soul) 各自 README。

## 配置文件 `~/.claw-mem/config.json`

完整 schema 是 `@chainofclaw/claw-mem` 的 `ClawMemConfigSchema`，等价于 `nodeConfigSchema × soulConfigSchema + memory 元字段`。最小跑通示例：

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

用 `claw-mem config set <path> <value>` 改字段，例如：

```bash
claw-mem config set backup.autoBackupIntervalMs 1800000
claw-mem config set node.defaultType fullnode
```

## 编程 API（库用法）

claw-mem 的顶级 export 按 bucket 划分。

### 记忆层（本地 SQLite + FTS）

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

### 节点层 —— 从 umbrella 透传

```ts
import { NodeManager, ProcessManager, StorageQuotaManager } from "@chainofclaw/claw-mem";
// 等价于 import { ... } from "@chainofclaw/node"
```

### Soul 层 —— 从 umbrella 透传

```ts
import { BackupManager, RecoveryManager, SoulClient, IpfsClient } from "@chainofclaw/claw-mem";
// 等价于 from "@chainofclaw/soul"
```

### 从零启动完整服务图（bootstrap helper）

```ts
import { bootstrapServices, ClawMemConfigSchema } from "@chainofclaw/claw-mem";

const config = ClawMemConfigSchema.parse({ /* 见上 */ });
const services = bootstrapServices({
  configOverride: config,
  logger: console,
});

// services 里有：db, nodeStore, nodeManager, backupManager,
//   recoveryManager, carrierManager, bootstrapManager, ...
await services.backupManager.start();
```

这跟 OpenClaw `activate()` 走的是同一条路。

## 首次使用的推荐流程

1. `claw-mem init` —— 写 config.json（或用上面示例手工写）。
2. `claw-mem doctor` —— 确认 Node 版本、DB、磁盘空间、端口、COC 仓都 OK。
3. `claw-mem bootstrap dev`（本地开发）或手动组合：`claw-mem node install` + `claw-mem node start` + `claw-mem backup init`。
4. `claw-mem status` —— 确认节点在跑、备份已注册。

## 常见问题

**OpenClaw 无法发现插件**：确认 `openclaw.plugin.json` 随包一起发布（`files` 里有它），且 `openclaw plugins install` 后有 `Loaded successfully` 日志。用 `--link` 做开发链接时需要先 `npm run build --workspaces`，因为 OpenClaw 只认 `dist/index.js`。

**session hook 没捕到 observation**：确认 `config.enabled: true`，且工具名不在 `skipTools` 列表里。

**`bootstrap dev` 部分步骤 TODO**：合约部署、agent 自注册、首次备份三步目前是 stub，等待后续版本接通 COC 的 deploy 脚本；`node install` + `node start` 这两步现在已经完整。

**mem import / mem export 字段格式**：export 写的是 SQLite 直出的 snake_case（`session_id`, `created_at_epoch` 等），import 也按这个读。未来会统一为 camelCase，目前手写 JSON 请用 snake_case。

**节点列表"Run `node install`" 文案在 standalone 下不一致**：1.0.7 有此 bug，1.0.8 已修。

## 协议

MIT
