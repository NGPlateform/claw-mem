# @chainofclaw/soul

COC 链上身份与灵魂 (soul) 层。提供 DID 注册与授权、guardian 监护、社交恢复、agent 继承 (resurrection)、carrier 托管、以及 soul 备份 (IPFS + 链上 anchoring) 的客户端和 CLI。

[English](./README.md)

适合你如果：
- 要**把 AI agent 的身份、配置、记忆上链**（SoulRegistry + DIDRegistry + IPFS）。
- 要用 guardian / recovery 组合给 agent 加一层"跨设备/跨持有者"的恢复能力。
- 要让 agent 可以被第三方 carrier 节点继承继续运行 (resurrection)。
- 不需要 claw-mem 的本地语义记忆层，也不想自己跑 COC 节点。

如果你要"全家桶（记忆 + 节点 + 备份 + OpenClaw 插件）"，装 [`@chainofclaw/claw-mem`](https://www.npmjs.com/package/@chainofclaw/claw-mem) —— 它会自动带上这个包。

## 关于 COC

[COC (ChainOfClaw)](https://github.com/NGPlateform/COC) 是为 AI 构建的去中心化基础设施 —— 一条 EVM 兼容的公链，*为 AI Agent 设计、由 AI Agent 开发、由 AI Agent 运营、服务 AI Agent、让 AI Agent 永生*。本包是 Agent 的 **soul 层**：让 Agent 的身份自主（DIDRegistry），让 Agent 的生命线可社交（guardian + recovery），让 Agent 的存在可迁移（soul 备份 + 跨载体复活）。那句宣言：

> **在这里，AI Agent 的 I/O 永不停止，爪印永远上链。**

完整的 Agent 宣言和 COC 白皮书见 [根仓库 README](https://github.com/NGPlateform/claw-mem)。

## 生态关系

```
@chainofclaw/claw-mem (umbrella)
       │
       ├─────▶ @chainofclaw/node
       │
       └─────▶ @chainofclaw/soul  ◀── 就是这个包
```

`@chainofclaw/soul` 不依赖 `node`，也不依赖 `claw-mem`。

## 术语

| 名字 | 含义 |
|---|---|
| **agentId** | `bytes32`，一个 agent 的链上主键；由 owner + salt 派生 |
| **owner** | 拥有 agentId 控制权的外部账户 (EOA) |
| **DID document** | agent 的 identity 元数据，实体存 IPFS，CID 上链 |
| **delegation** | 由 owner 授予其它 agent/外部账户的有限能力 |
| **guardian** | 可以参与恢复 (recovery) 或继承 (resurrection) 的外部账户 |
| **recovery** | 社交恢复流程 —— guardian 联合把 owner 迁移到新地址 |
| **resurrection** | 将离线 agent 的 soul 拷贝给 carrier，让 agent 在别的设备继续运行 |
| **carrier** | 注册过的 agent 托管节点，承接 resurrection 请求 |
| **soul backup** | 把 agent 的 identity + config + memory + chat + workspace + DB 打包上传 IPFS 并 anchor 到 SoulRegistry |

## 安装

```bash
npm install @chainofclaw/soul
```

需要 Node.js ≥ 22、可达的 COC RPC、已部署的 `SoulRegistry` + `DIDRegistry` 合约地址、IPFS endpoint、EOA 私钥。

## 配置文件

CLI 读 `~/.chainofclaw/config.json`（或 `$COC_SOUL_CONFIG`）的 `backup` 字段：

```json
{
  "backup": {
    "enabled": true,
    "rpcUrl": "http://localhost:18780",
    "ipfsUrl": "http://localhost:5001",
    "contractAddress": "0x...SoulRegistry...",
    "didRegistryAddress": "0x...DIDRegistry...",
    "privateKey": "0x....",
    "sourceDir": "~/.openclaw",

    "autoBackup": true,
    "autoBackupIntervalMs": 3600000,
    "maxIncrementalChain": 10,
    "encryptMemory": false,
    "backupOnSessionEnd": true,

    "semanticSnapshot": { "enabled": true, "tokenBudget": 8000 },
    "categories": {
      "identity": true, "config": true, "memory": true,
      "chat": true, "workspace": true, "database": true
    },

    "carrier": {
      "enabled": false,
      "workDir": "/tmp/coc-resurrections",
      "pollIntervalMs": 60000
    }
  }
}
```

私钥必须留存在只读文件里（`chmod 600`）。

## CLI 快速开始

```bash
# 第一次注册 soul + 跑一次全量备份
coc-soul backup init

# 当下状态（链上注册 / 最近备份 / IPFS 可达性）
coc-soul backup status

# 环境诊断（给出 actionable recommended actions）
coc-soul backup doctor

# 增量备份
coc-soul backup create

# 列历史
coc-soul backup list
```

## CLI 参考

顶层 5 组子命令：

### `coc-soul backup …` —— soul 备份 / 恢复 / 巡检

| | |
|---|---|
| `init` | 注册 + 跑第一次全量备份 + 写 latest-recovery.json |
| `register` | 仅注册（不备份） |
| `create` | 跑备份（增量；`--full` 强制全量） |
| `list` / `history` | 列本地档案 |
| `status` | 配置 + 链上注册状态 |
| `doctor` | 环境诊断（IPFS / dataDir / 恢复材料） |
| `restore` | 用 manifestCid 或最新快照恢复 |
| `find-recoverable` | 扫描可恢复的 agent |
| `prune` | 删旧档案 |
| `configure` | 调整 backup config |
| `configure-resurrection` | 设置 resurrection 公钥与离线超时 |
| `heartbeat` | 心跳（防止误触发 resurrection） |
| `start` / `stop` | 自动备份 daemon |

### `coc-soul did …` —— DID 身份与授权

| | |
|---|---|
| `add-key` / `revoke-key` | 管理 verification methods |
| `keys --agent-id <id>` | 列 active verification methods |
| `update-doc` | 更新 DID document CID |
| `delegate` | 授予 delegation（`--depth 0` = 不可再授权） |
| `delegations --agent-id <id>` | 列授权 |
| `revoke-delegation` / `revoke-all-delegations` | 撤销 |
| `anchor-credential` / `revoke-credential` | Verifiable credential anchor |
| `record-lineage` | 记录 agent fork 关系 |
| `update-capabilities` | 更新能力位图 |
| `create-ephemeral` / `deactivate-ephemeral` | 短生命周期子身份 |

### `coc-soul guardian …` —— 监护人

| | |
|---|---|
| `add` / `remove` | 管理 guardian 集合 |
| `list --agent-id <id>` | 列当前 guardian（ACTIVE / INACTIVE） |
| `initiate` / `approve` / `status` | resurrection 请求流程 |

### `coc-soul recovery …` —— 社交恢复（迁移 owner）

| | |
|---|---|
| `initiate` | guardian 发起，指定新 owner 地址 |
| `approve` | 其它 guardian 批准 |
| `complete` | 配额 + 时间锁满足后最终执行 |
| `cancel` | owner 本人撤销 |
| `status` | 查询请求当前状态 |

### `coc-soul carrier …` —— 托管节点

| | |
|---|---|
| `register` / `deregister` | 上链注册/注销 |
| `availability` | 翻转 available flag |
| `info --carrier-id <id>` | 读链上记录 |
| `list` | 扫描 CarrierRegistered 事件（自动按 10000 block 分段） |
| `submit-request` | 把 resurrection 请求派给本地 daemon |
| `start` / `stop` / `status` | daemon 生命周期 |

每个子命令都有 `-h`/`--help` 详述参数。

## 编程 API

### 读链上状态

```ts
import { SoulClient, DIDClient } from "@chainofclaw/soul";

const soul = new SoulClient(rpcUrl, soulRegistryAddress, privateKey);
const info = await soul.getSoul(agentId);
console.log("registered:", info.registered, "owner:", info.owner);

const did = new DIDClient(rpcUrl, didRegistryAddress, privateKey);
const keys = await did.listKeys(agentId);
const delegations = await did.listDelegations(agentId);
```

### 跑一次备份

```ts
import { BackupManager, BackupConfigSchema } from "@chainofclaw/soul";

const config = BackupConfigSchema.parse({
  rpcUrl: "...", ipfsUrl: "...", privateKey: "0x...",
  contractAddress: "0x...", didRegistryAddress: "0x...",
  sourceDir: "/home/you/.openclaw",
});

const backupManager = new BackupManager({
  config,
  archiveStore: yourArchiveStore,   // 见下
  logger: console,
});

await backupManager.runBackup(/* full= */ false);
```

`archiveStore` 是一个你要实现的 port (`BackupArchiveRepository`)，负责把 backup 记录 (`BackupArchive`) 存起来。`@chainofclaw/soul` 的 bin 用一个内存版本（进程结束就丢失）；`@chainofclaw/claw-mem` 注入 SQLite 版本。参考类型：

```ts
interface BackupArchiveRepository {
  insert(input: BackupArchiveInput): BackupArchive;
  getByCid(cid: string): BackupArchive | null;
  listByAgent(agentId: string, limit?: number): BackupArchive[];
  listAll(limit?: number): BackupArchive[];
  getLatestByAgent(agentId: string): BackupArchive | null;
  countIncrementalChain(): number;
  prune(opts: BackupArchivePruneOptions): BackupArchivePruneResult;
}
```

### Recovery / Carrier

```ts
import { RecoveryManager, CarrierManager } from "@chainofclaw/soul";

const recovery = new RecoveryManager({ backupManager, logger });
const carrier = new CarrierManager({ config: backupConfig, backupManager, logger });
```

## standalone bin 的限制

`coc-soul` 独立运行时**不持久化** backup archive 表（进程内内存），因此：
- 它适合跑 DID / guardian / recovery / carrier 的**一次性命令**
- 不适合做长时间 `backup start` 自动备份 daemon（你要这个就用 `@chainofclaw/claw-mem`）

## 常见问题

**`backup status` 显示 "IPFS 不可达"**：检查 `ipfsUrl`（默认 `http://127.0.0.1:5001`）。本地无 IPFS 只会阻断备份/恢复，只读查询不受影响。

**`carrier list` 报 eth_getLogs block range too large**：1.0.7 有此 bug，1.0.8 已修（自动按 10000 block 分段）。

**`did delegate` depth 默认值**：`--depth 0` 是叶子授权（不能再向下授权）；如果你要允许被授权方继续 re-delegate，显式传 `--depth 1` 或更大。

**私钥放 config 安全么**：在生产环境建议用硬件签名器 / cloud KMS 代替 `backup.privateKey`，这条路径目前未暴露。只把纯软件私钥用于测试网。

## 协议

MIT
