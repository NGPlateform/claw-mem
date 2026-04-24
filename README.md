# chainofclaw claw-mem monorepo

This is the source tree for the `@chainofclaw/*` npm packages. The public API and docs live with each package — start there.

| Package | What it does | npm | README |
|---|---|---|---|
| [`@chainofclaw/claw-mem`](./packages/claw-mem) | Umbrella: persistent semantic memory + COC node + soul backup + OpenClaw plugin | [npm](https://www.npmjs.com/package/@chainofclaw/claw-mem) | [packages/claw-mem/README.md](./packages/claw-mem/README.md) |
| [`@chainofclaw/node`](./packages/node) | Standalone COC node lifecycle (install/start/stop/status) | [npm](https://www.npmjs.com/package/@chainofclaw/node) | [packages/node/README.md](./packages/node/README.md) |
| [`@chainofclaw/soul`](./packages/soul) | On-chain DID + guardian + recovery + resurrection + carrier + soul backup | [npm](https://www.npmjs.com/package/@chainofclaw/soul) | [packages/soul/README.md](./packages/soul/README.md) |

```
@chainofclaw/claw-mem ──▶ @chainofclaw/node
           │
           └──────────▶ @chainofclaw/soul
```

The three packages release in lockstep; `@chainofclaw/claw-mem` pins exact-version deps on the other two.

## Current release

`1.0.8` (2026-04-24) — bug fixes from 1.0.7 E2E:
- `@chainofclaw/node` — generic empty-state text for `node list` / `status`
- `@chainofclaw/soul` — chunked `SoulClient.listCarriers` eth_getLogs (10k-block windows)

## Development

```bash
git clone https://github.com/NGPlateform/claw-mem
cd claw-mem
npm install                       # installs workspaces
npm run typecheck --workspaces
npm run build --workspaces
npm test --workspaces             # 213 tests across 3 packages
```

Each package can be worked on independently:

```bash
npm test --workspace @chainofclaw/node
npm test --workspace @chainofclaw/soul
npm test --workspace @chainofclaw/claw-mem
```

## Contributing

Issues and PRs welcome at <https://github.com/NGPlateform/claw-mem>.

## License

MIT
