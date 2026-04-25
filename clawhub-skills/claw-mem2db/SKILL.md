---
name: claw-mem2db
description: Give an AI agent persistent semantic memory that survives restarts and compaction. Captures structured observations from tool calls, summarizes sessions, and injects a token-budgeted memory context into the next prompt. Use when the user wants long-lived agent memory, wants to search past observations, wants to export / import memory across machines, wants to see what memory would be injected before the next turn, or is assembling the full COC agent stack (memory + node + soul).
version: 1.1.11
metadata:
  openclaw:
    homepage: https://www.npmjs.com/package/@chainofclaw/claw-mem
    primaryEnv: CLAW_MEM_DATA_DIR
    requires:
      bins:
        - node
      anyBins:
        - claw-mem
        - openclaw
    install:
      - kind: node
        package: "@chainofclaw/claw-mem"
        version: "1.1.11"
        bins:
          - claw-mem
---

# claw-mem2db — persistent semantic memory for agents

The **memory layer** for AI agents on COC.

> **Naming note.** This ClawHub skill is published as **`claw-mem2db`** because the bare `claw-mem` slug was taken. The underlying artifacts keep the original names:
>
> - **npm package:** [`@chainofclaw/claw-mem`](https://www.npmjs.com/package/@chainofclaw/claw-mem)
> - **CLI binary:** `claw-mem`
> - **OpenClaw plugin id:** `claw-mem`
>
> Only the ClawHub slug differs.

## Mental model

Every tool call the agent makes becomes a candidate **observation** (a typed, structured record: discovery / decision / pattern / learning / issue / change / explanation). Observations are stored in a local SQLite database with FTS5 full-text search. At the start of each new prompt, claw-mem builds a **memory context** — a token-budgeted summary of recent relevant observations — and injects it into the prompt. Sessions are summarized on close.

What the agent gets in return:
- No more "I forgot what we were doing" between sessions
- Searchable history of decisions and their rationale
- Structured snapshots for soul-backup (via the [coc-soul](https://clawhub.ai/ngplateform/coc-soul) skill)

## Full-stack role

claw-mem is the **memory third** of the three COC agent-side skills:

| Skill | Owns |
|---|---|
| [coc-node](https://clawhub.ai/ngplateform/coc-node) | Running a COC blockchain node |
| [coc-soul](https://clawhub.ai/ngplateform/coc-soul) | On-chain identity, backup, recovery, resurrection |
| **claw-mem** | Local persistent memory, observation capture, session hooks |

Installing all three gives an agent that: runs its own infrastructure, remembers across restarts, and can resurrect on a different device if the current host dies.

## How to invoke

```bash
# Standalone
claw-mem mem search "checkpoint"
claw-mem mem status

# Inside OpenClaw
openclaw coc mem search "checkpoint"
openclaw coc mem status
```

## Typical flows

1. **First-time setup** — `claw-mem init` (interactive wizard writes `~/.claw-mem/config.json`); `claw-mem doctor` verifies environment.
2. **Search past observations** — `claw-mem mem search "..."` with FTS5 syntax; `--json` for machine-readable output.
3. **Peek at memory injection** — `claw-mem mem peek` shows exactly the context that would be injected on the next prompt.
4. **Forget a session** — `claw-mem mem forget <sessionId>` removes its observations (useful for noisy sessions that distort search).
5. **Prune** — `claw-mem mem prune --days 90` drops observations older than N days; `--before <ISO>` for explicit cutoff.
6. **Export / import** — `claw-mem mem export memory.json` for cross-machine migration; `claw-mem mem import memory.json` on the target.

## Configuration knobs worth knowing

- `tokenBudget` (default 8000) — how much of the next prompt goes to memory context
- `maxObservations` / `maxSummaries` (50 / 10) — hard caps on what's considered for injection
- `skipTools` — tools the observer skips entirely (defaults exclude `TodoWrite`, `AskUserQuestion`, `Skill` because they're usually noisy meta-tools)
- `dedupWindowMs` (30000) — de-duplicate observations with the same content hash within this window

Edit with `claw-mem config set <path> <value>`.

## When NOT to use this skill

- You want ephemeral agent sessions with no persistent history — don't install claw-mem; OpenClaw's in-session context is enough.
- You want memory-like search *only for code* — tools like grep / ripgrep / `codebase_search` serve that need without the persistence overhead.
- You want on-chain / cross-device backup — add [coc-soul](https://clawhub.ai/ngplateform/coc-soul) on top; claw-mem only persists locally.

## Reference

- `references/cli.md` — every `claw-mem` subcommand
- `references/config.md` — complete config schema (memory + umbrella composition)
- `references/observer.md` — how observations are extracted, when hooks fire
- `references/programmatic-api.md` — using `Database` / `ObservationStore` / `SearchEngine` as library

Source and issue tracker: <https://github.com/NGPlateform/claw-mem>.
