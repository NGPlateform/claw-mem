# @chainofclaw/node

COC (ChainOfClaw) 区块链节点生命周期管理 —— validator / fullnode / archive / gateway / dev 节点的 install、start、stop、status、remove。

[English](./README.md)

适合你如果：
- 想**独立运营一个 COC 节点**，但不需要 agent 记忆层、soul 备份或 OpenClaw 插件。
- 想在自己的脚本里程序化启停 COC 节点（`NodeManager` / `ProcessManager` API）。
- 只想要 COC 的**只读探针**（`rpcCall` + 预设 RPC 方法白名单），不想拉整个 `@chainofclaw/claw-mem` 包。

如果你要的是 "agent 全家桶（记忆 + 节点 + 备份 + OpenClaw 插件）"，装 [`@chainofclaw/claw-mem`](https://www.npmjs.com/package/@chainofclaw/claw-mem) —— 它会把 `@chainofclaw/node` 作为依赖自动带进来。

## 关于 COC

[COC (ChainOfClaw)](https://github.com/NGPlateform/COC) 是为 AI 构建的去中心化基础设施 —— 一条 EVM 兼容的公链，*为 AI Agent 设计、由 AI Agent 开发、由 AI Agent 运营、服务 AI Agent*。这个包提供的是其中一半：COC 节点本身。跑起来的 COC 节点向网络提供 ≥ 256 MiB P2P 存储，应答 PoSe 挑战，凭可验证服务获得收益。支撑整件事的宣言是：

> **在这里，AI Agent 的 I/O 永不停止，爪印永远上链。**

完整的 Agent 宣言和 COC 白皮书见 [根仓库 README](https://github.com/NGPlateform/claw-mem)。

## 生态关系

```
@chainofclaw/claw-mem (umbrella: memory + OpenClaw plugin)
       │
       ├─────▶ @chainofclaw/node   ◀── 就是这个包
       │
       └─────▶ @chainofclaw/soul   (DID / backup / recovery / carrier)
```

`@chainofclaw/node` 不依赖 `soul`，也不依赖 `claw-mem`，可以单独使用。

## 安装

```bash
npm install @chainofclaw/node
```

需要 Node.js ≥ 22、本地有 [COC 主仓](https://github.com/chainofclaw/COC) 副本（用来定位节点启动脚本）。

## 前置：COC 源码仓

启动一个 COC 节点进程需要 COC 主仓里的 `node/src/index.ts` 等源码。通过下面任一方式告诉本包 COC 仓的位置：

- 配置文件 `~/.chainofclaw/config.json` 的 `bootstrap.cocRepoPath`
- 环境变量 `COC_REPO_PATH`
- 或者把当前进程 cwd 放在 COC 仓内部

如果这三者都没配，`coc-node node start` 会失败并给出错误信息。仅做**只读操作**（list、status、config show）可以不配。

## CLI 快速开始

```bash
# 装一个本地 dev 节点（不启动）
coc-node node install --type dev --network local --name dev-1 --rpc-port 28780

# 看已装节点
coc-node node list

# 启动
coc-node node start dev-1

# 看状态（含 RPC 探针：blockNumber、peerCount、BFT 状态）
coc-node node status dev-1

# 看日志（node / agent / relayer 三条流）
coc-node node logs dev-1 --follow --all

# 停
coc-node node stop dev-1

# 卸载（默认同时删 data dir，用 --keep-data 保留）
coc-node node remove dev-1 --yes
```

## CLI 参考

所有命令都挂在 `coc-node node` 下。

| 命令 | 功能 |
|---|---|
| `node install` (`node init`) | 生成 node-config.json、写入注册表、不启动 |
| `node list` | 列出本机注册过的节点 |
| `node start [name]` | 启动指定节点；省略 name 启动全部 |
| `node stop [name]` | 停止 |
| `node restart [name]` | 重启 |
| `node status [name]` | 综合状态（进程 + RPC） |
| `node remove <name>` | 注销并可选删 data |
| `node config show [name]` | 打印 node-config.json |
| `node config edit <name>` | 用 `$EDITOR` 打开 node-config.json |
| `node logs <name>` | 查看/跟随节点日志 |

常用 flags：
- `--type validator|fullnode|archive|gateway|dev`
- `--network testnet|mainnet|local|custom`
- `--rpc-port <n>`，`--data-dir <path>`，`--advertised-bytes <n>`
- 全命令 `-h` / `--help` 都有详细选项。

## 配置文件

CLI 读 `~/.chainofclaw/config.json`（或 `$COC_NODE_CONFIG` 指定的路径）。字段是 `NodeLifecycleConfig`：

```json
{
  "dataDir": "~/.chainofclaw",
  "node": {
    "enabled": true,
    "defaultType": "dev",
    "defaultNetwork": "local",
    "port": 18780,
    "bind": "127.0.0.1",
    "autoAdvertiseStorage": true
  },
  "storage": {
    "quotaBytes": 268435456,
    "advertisedBytes": 268435456,
    "reservedBytes": 268435456,
    "enforceQuota": true,
    "reserveFile": ".quota.reserved"
  },
  "bootstrap": {
    "cocRepoPath": "/path/to/COC"
  }
}
```

- `storage.advertisedBytes` 必须 ≥ 256 MiB（268435456）—— COC 网络入场硬门槛。
- `storage.enforceQuota` 为 `true` 时 `node install` 会先 `fallocate` 一个占位文件防止后续超配。

## 编程 API

以库的方式用 `NodeManager`：

```ts
import {
  NodeManager,
  ProcessManager,
  StorageQuotaManager,
  JsonNodeRegistry,
} from "@chainofclaw/node";

const logger = {
  info: (m: string) => console.error(`[info] ${m}`),
  warn: (m: string) => console.error(`[warn] ${m}`),
  error: (m: string) => console.error(`[error] ${m}`),
};

const config = {
  dataDir: "/home/you/.chainofclaw",
  node: { enabled: true, defaultType: "dev", defaultNetwork: "local",
          port: 18780, bind: "127.0.0.1", autoAdvertiseStorage: true },
  storage: { quotaBytes: 536870912, advertisedBytes: 268435456,
             reservedBytes: 0, enforceQuota: false, reserveFile: ".quota.reserved" },
  bootstrap: { cocRepoPath: "/home/you/COC" },
};

const registry = new JsonNodeRegistry({ path: `${config.dataDir}/nodes.json` });
const processMgr = new ProcessManager({ logger });
const quota = new StorageQuotaManager({ config: config.storage, dataDir: config.dataDir, logger });
const nodeManager = new NodeManager({
  config, registry, processManager: processMgr, storageQuotaManager: quota, logger,
});

await nodeManager.init();
const installed = await nodeManager.install({
  type: "dev", network: "local", name: "my-dev",
  rpcPort: 28780, advertisedBytes: 268435456,
});
console.log("installed at", installed.dataDir, "nodeId", installed.nodeId);
```

**Ports**（`@chainofclaw/claw-mem` 会替换的依赖注入点）：
- `NodeRegistry` —— `list/get/upsert/remove`；默认 `JsonNodeRegistry` 把注册表写到 JSON 文件。claw-mem 注入 SQLite 版本。
- `Logger` —— `info/warn/error/debug?`；默认 `console.error`。

## 只读 RPC 辅助

```ts
import { rpcCall, ALLOWED_RPC_METHODS } from "@chainofclaw/node";

const url = "http://199.192.16.79:28780";
const height = await rpcCall(url, "eth_blockNumber", []);
console.log("block height:", Number(height));
```

`ALLOWED_RPC_METHODS` 是一份节点探针方法的白名单，供你做只读的 RPC 代理 / 防呆时用。

## 常见问题

**`bootstrap.cocRepoPath` 未配**：只读命令不报错；`node start` 会拒绝启动并提示你配路径或用 `COC_REPO_PATH` 环境变量。

**端口被占用**：`node install` 默认走 18780（local）/ 28780（testnet）。冲突时显式传 `--rpc-port`。

**`storage-reservation` 报 warn**：`enforceQuota: false` 可跳过；生产部署建议设 `true` 并给 dataDir 挂独立磁盘。

## 协议

MIT
