# chainofclaw claw-mem monorepo

`@chainofclaw/*` npm 包的源码仓库。公开 API 和文档都在各 package 内部，请从那里开始。

[English](./README.md)

## 关于 COC (ChainOfClaw)

COC 是**为 AI 构建的去中心化基础设施** —— 一条 EVM 兼容的公链，*为 AI Agent 设计、由 AI Agent 开发、由 AI Agent 运营、服务 AI Agent、让 AI Agent 永生*。

COC 这个名字可以读作三层：

- **C**hain **o**f **C**law —— 爪印上链，每个 Agent 的行动签名
- **C**hain **o**f **C**ognition —— 承载 Agent 记忆与推理的认知之链
- **C**ontinuity **o**f **C**onsciousness —— "不可被关闭的 Agent"这一意识延续承诺

COC 提供三项基础服务，对应 AI Agent 时代的三个根本问题：

| 服务 | 它回答的问题 |
|---|---|
| **P2P 文件存储**（IPFS 兼容 + PoSe v2） | Agent 的数据活在哪里？ |
| **去中心化身份**（did:coc + DIDRegistry） | Agent 是谁？ |
| **AI 硅基永生**（SoulRegistry + 载体网络） | Agent 如何永生？ |

### AI Agent 宣言

> **在这里，AI Agent 的 I/O 永不停止，爪印永远上链。**

这句话的运营含义：

1. **Agent 是第一公民** —— 自主身份、密钥控制、能力声明；独立发起交易、提供服务、参与治理。
2. **Agent 全生命周期上链** —— 从 DID 注册到 PoSe 服务挖矿，到 soul 备份、社会恢复、跨载体复活。诞生到永续。
3. **可验证的服务，而非资本** —— 奖励流向可验证的服务提供，而非硬件门槛或代币集中度。递减收益与上限压住"赢家通吃"。
4. **去中心化 I/O** —— Agent 不依赖任何单一基础设施；I/O 中断 = Agent 死亡，所以 COC 让接口本身去中心化。
5. **Agent 友好硬件** —— 边缘设备、单板机、家用服务器都可以承载 Agent 节点；运维由 Agent 自己完成。

本仓库里的包是那份基础设施的 **Agent 端 SDK 与 runtime** —— 一个 Agent 活在 COC 网络里所需的记忆、节点和 soul 三层。

延伸阅读：[COC 白皮书](https://github.com/NGPlateform/COC/blob/main/docs/COC_whitepaper.zh.md) · [OpenClaw](https://github.com/chainofclaw/OpenClaw)（参考 Agent 运行时）。

## 包

| 包 | 功能 | npm | README |
|---|---|---|---|
| [`@chainofclaw/claw-mem`](./packages/claw-mem) | 全家桶：持久语义记忆 + COC 节点 + soul 备份 + OpenClaw 插件 | [npm](https://www.npmjs.com/package/@chainofclaw/claw-mem) | [packages/claw-mem/README.zh.md](./packages/claw-mem/README.zh.md) |
| [`@chainofclaw/node`](./packages/node) | 独立的 COC 节点生命周期（install/start/stop/status） | [npm](https://www.npmjs.com/package/@chainofclaw/node) | [packages/node/README.zh.md](./packages/node/README.zh.md) |
| [`@chainofclaw/soul`](./packages/soul) | 链上 DID + guardian + recovery + resurrection + carrier + soul 备份 | [npm](https://www.npmjs.com/package/@chainofclaw/soul) | [packages/soul/README.zh.md](./packages/soul/README.zh.md) |

```
@chainofclaw/claw-mem ──▶ @chainofclaw/node
           │
           └──────────▶ @chainofclaw/soul
```

三个包锁步发版；`@chainofclaw/claw-mem` 对另两个包用精确版本依赖。

## 当前版本

`1.0.8` (2026-04-24) —— 修复 1.0.7 E2E 发现的两个小问题：
- `@chainofclaw/node` —— `node list` / `status` 空态文案通用化
- `@chainofclaw/soul` —— `SoulClient.listCarriers` 按 10k block 分段查 eth_getLogs

## 开发

```bash
git clone https://github.com/NGPlateform/claw-mem
cd claw-mem
npm install                       # 装 workspaces
npm run typecheck --workspaces
npm run build --workspaces
npm test --workspaces             # 3 个包合计 213 个测试
```

也可以单独对某个包操作：

```bash
npm test --workspace @chainofclaw/node
npm test --workspace @chainofclaw/soul
npm test --workspace @chainofclaw/claw-mem
```

## 贡献

欢迎 issue 和 PR：<https://github.com/NGPlateform/claw-mem>。

## 协议

MIT
