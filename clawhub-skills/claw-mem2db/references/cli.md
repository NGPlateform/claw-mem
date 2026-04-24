# `claw-mem` CLI reference

The standalone `claw-mem` binary mounts the full command tree; `openclaw coc` (the OpenClaw skill) mounts a narrower memory-only subset (`mem`, `db`, `config`, `version`).

## Memory commands (`claw-mem mem …`)

| Command | Purpose |
|---|---|
| `mem search <query>` | FTS5 full-text search over observations. Flags: `--limit <n>`, `--agent <id>`, `--json`. |
| `mem status` | Counts of observations / summaries / sessions / agents. Used for quick sanity check. |
| `mem forget <sessionId>` | Delete all observations for a specific session. |
| `mem peek` | Dump the memory context that would be injected on the next prompt (respects `tokenBudget`). |
| `mem prune` | Delete old observations. `--days <n>` keeps the last N days; `--before <iso>` for explicit cutoff. |
| `mem export <file>` | Dump all observations + summaries + sessions to a JSON file. |
| `mem import <file>` | Load a previously exported file. Uses snake_case field names (matches SQLite schema). |

## DB commands (`claw-mem db …`)

| Command | Purpose |
|---|---|
| `db size` | On-disk size of the SQLite DB + FTS index |
| `db vacuum` | Reclaim space after large deletes |
| `db migrate-status` | Check schema version against code's expected version |

## Config commands (`claw-mem config …`)

| Command | Purpose |
|---|---|
| `config list` | Print the full merged config |
| `config get <path>` | Read a dotted key (e.g. `tokenBudget`, `backup.rpcUrl`) |
| `config set <path> <value>` | Write a key. String-coercion is careful not to stringify hex keys or URLs. |
| `config path` | Print the config file location |

## Umbrella commands

These only exist in the `claw-mem` standalone bin (not when running as an OpenClaw plugin, because the plugin is memory-only):

- `claw-mem node …` — transparent re-mount of `coc-node node …` (delegated to `@chainofclaw/node`)
- `claw-mem backup …` / `did …` / `guardian …` / `recovery …` / `carrier …` — re-mount of `coc-soul …`
- `claw-mem bootstrap …` — one-shot dev / prod bootstrap pipeline (starts hardhat, deploys contracts, installs a node, runs first backup)
- `claw-mem status` / `doctor` / `init` / `tools` / `uninstall` — cross-layer health + management

For pure memory workflows, prefer `openclaw coc mem …` under the OpenClaw skill.
