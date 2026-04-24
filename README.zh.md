# chainofclaw claw-mem monorepo

`@chainofclaw/*` npm 包的源码仓库。公开 API 和文档都在各 package 内部，请从那里开始。

[English](./README.md)

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
