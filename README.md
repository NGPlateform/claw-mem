# claw-mem

Persistent cross-session semantic memory for [OpenClaw](https://github.com/openclaw/openclaw) AI agents.

claw-mem silently observes what your agent does — reading files, editing code, running commands, searching the web — and distills each action into a structured **observation**. At the end of every session it compresses those observations into a **summary**. On the next session start it **injects** the most relevant memories back into the agent's prompt, so the agent picks up where it left off without you having to explain the context again.

## How it works

```
Session N                                      Session N+1
─────────                                      ───────────
User prompt                                    User prompt
    │                                              │
    ▼                                              ▼
┌─────────────────┐                         ┌─────────────────┐
│ before_prompt_   │◄── inject context ──── │ SQLite DB       │
│ build hook       │    (token-budgeted)    │ observations +  │
└────────┬────────┘                         │ summaries       │
         │                                  └────────▲────────┘
    Agent works...                                   │
         │                                      on agent_end:
    ┌────▼────┐                                 compress into
    │ after_  │── extract observation ──►        session summary
    │ tool_   │   (heuristic, no LLM)
    │ call    │
    └─────────┘
```

**Zero configuration required.** Install it, and memory just works.

## Install

### As an OpenClaw workspace extension

```bash
# From your OpenClaw workspace root
cd extensions
git clone https://github.com/NGPlateform/claw-mem.git
cd claw-mem && npm install
```

Then add to your `openclaw.json`:

```jsonc
{
  "extensions": {
    "claw-mem": {
      "enabled": true
      // all other options are optional — see Configuration below
    }
  }
}
```

### As an npm package (when published)

```bash
npm install @openclaw/claw-mem
```

## What it captures

Every time the agent calls a tool, claw-mem extracts a lightweight **observation**:

| Tool | Observation type | What's captured |
|------|-----------------|-----------------|
| `Read` | discovery | File name, line count, path, language |
| `Write` | change | File name, lines written |
| `Edit` | change | File name, lines added/removed |
| `Bash` | change | Command, error/pass detection, domain concepts |
| `Grep` | discovery | Search pattern, match count |
| `WebSearch` | discovery | Query, result summary |
| Any other | discovery | Tool name, parameter keys, output excerpt |

Each observation is a structured record:

```json
{
  "type": "decision",
  "title": "Added Redis caching layer",
  "facts": ["Reduced DB queries by 60%"],
  "narrative": "Implemented Redis to reduce database load...",
  "concepts": ["redis", "performance", "caching"],
  "filesModified": ["src/cache.ts"]
}
```

Observations are **deduplicated** within a 30-second window (same title + narrative = same observation).

Tools that produce no meaningful signal (`TodoWrite`, `AskUserQuestion`, `Skill`) are skipped by default.

## What it injects

On every `before_prompt_build` event, claw-mem assembles a **token-budgeted context block** from recent summaries and observations, formatted as Markdown:

```xml
<claw-mem-context>
Agent: main | 3 summaries, 12 observations | 2400/8000 tokens

## Recent Sessions

### Apr 17, 2026
- **Request**: Optimize database performance
- **Learned**: Redis + connection pool reduced latency 40%
- **Completed**: Implemented caching in production
- **Next Steps**: Monitor metrics, consider distributed caching

## Recent Observations

| Time  | Type      | Title                           | Facts                  |
|-------|-----------|---------------------------------|------------------------|
| 09:30 | decision  | Added Redis caching layer       | Reduced queries by 60% |
| 08:15 | discovery | Found N+1 query in dashboard    | 200 queries per page   |

</claw-mem-context>
```

**Packing strategy:** Summaries first (higher information density per token), then observations. Stops when the token budget is exhausted.

## Agent tools

claw-mem registers three tools that the agent can call:

### `mem-search`

Search past observations by keyword or concept.

```
query:  "Redis caching"          # required
limit:  10                       # optional, default 10
type:   "decision"               # optional filter
```

Uses SQLite FTS5 full-text search. Falls back to LIKE queries if FTS is unavailable.

### `mem-status`

View memory statistics.

```json
{
  "observations": 142,
  "summaries": 12,
  "sessions": 15,
  "agents": ["main", "helper"],
  "database": "/home/user/.claw-mem/claw-mem.db",
  "tokenBudget": 8000
}
```

### `mem-forget`

Delete all observations from a specific session.

```
sessionId: "abc-123-def"         # required
```

## Configuration

All settings go in `openclaw.json` under the `claw-mem` extension key:

```jsonc
{
  "extensions": {
    "claw-mem": {
      "enabled": true,                    // default: true
      "dataDir": "",                      // default: ~/.claw-mem
      "tokenBudget": 8000,               // max tokens for context injection
      "maxObservations": 50,             // max observations to consider
      "maxSummaries": 10,                // max summaries to consider
      "dedupWindowMs": 30000,            // dedup window (ms)
      "skipTools": [                     // tools to ignore
        "TodoWrite",
        "AskUserQuestion",
        "Skill"
      ]
    }
  }
}
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `enabled` | `true` | Enable/disable the extension |
| `dataDir` | `~/.claw-mem` | Where to store the SQLite database |
| `tokenBudget` | `8000` | Max tokens injected into the agent's prompt |
| `maxObservations` | `50` | Recent observations to read from DB |
| `maxSummaries` | `10` | Recent summaries to read from DB |
| `dedupWindowMs` | `30000` | Time window for duplicate detection (ms) |
| `skipTools` | `["TodoWrite", ...]` | Tool names that don't generate observations |

## Lifecycle hooks

claw-mem registers five OpenClaw lifecycle hooks:

| Hook | When | What it does |
|------|------|-------------|
| `session_start` | New session begins | Creates session record in DB |
| `before_prompt_build` | Before each LLM call | Injects token-budgeted memory context |
| `after_tool_call` | After every tool execution | Extracts and stores observation |
| `agent_end` | Agent run completes | Generates session summary from observations |
| `session_end` | Session closes | Marks session as completed |

All hooks are **non-blocking** — errors are logged but never interrupt the agent's workflow.

## Observation types

| Type | Meaning | Typical source |
|------|---------|---------------|
| `discovery` | New information learned | Read, Grep, WebSearch |
| `decision` | Architecture or approach choice | *(LLM-powered extractors)* |
| `pattern` | Recurring code/design pattern | *(LLM-powered extractors)* |
| `learning` | Lesson or insight | *(LLM-powered extractors)* |
| `issue` | Bug found or problem diagnosed | *(LLM-powered extractors)* |
| `change` | Code or file modification | Write, Edit, Bash |
| `explanation` | How something works | *(LLM-powered extractors)* |

The built-in heuristic extractor produces `discovery` and `change` types. The `decision`, `pattern`, `learning`, `issue`, and `explanation` types are available for LLM-powered extractors or manual insertion.

## Database

claw-mem uses a single SQLite database (via Node.js 22+ built-in `node:sqlite`):

- **Location**: `~/.claw-mem/claw-mem.db` (configurable)
- **Mode**: WAL (Write-Ahead Logging) for concurrent read/write
- **Search**: FTS5 full-text index on `title`, `narrative`, `facts`, `concepts`
- **Migrations**: Automatic, versioned, idempotent

### Tables

| Table | Purpose |
|-------|---------|
| `observations` | Structured observations from tool calls |
| `session_summaries` | Compressed session summaries |
| `sessions` | Session lifecycle tracking |
| `observations_fts` | FTS5 full-text search index |
| `schema_version` | Migration tracking |

## Integration with coc-backup

claw-mem is designed to work with the [COC coc-backup](https://github.com/NGPlateform/coc-dev) extension's semantic memory layer. The coc-backup `semantic-snapshot.ts` module reads claw-mem's SQLite database to capture observations and summaries before each backup, enabling semantic context injection after agent resurrection.

claw-mem re-exports all core modules for programmatic access:

```typescript
import {
  Database,
  ObservationStore,
  SummaryStore,
  SearchEngine,
  buildContext,
  extractObservation,
} from "@openclaw/claw-mem"
```

## Requirements

- **Node.js 22+** (uses `node:sqlite` built-in module)
- **OpenClaw** with plugin API support

## Development

```bash
git clone https://github.com/NGPlateform/claw-mem.git
cd claw-mem
npm install
npm test                    # 27 tests
```

## License

MIT
