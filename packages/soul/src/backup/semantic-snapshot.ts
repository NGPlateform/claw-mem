// Semantic snapshot: extract structured observations and summaries from
// claw-mem's SQLite database. Writes a token-budgeted snapshot into the
// backup payload so an agent recovered on a different host can replay its
// memory context.
//
// claw-mem 2.1.0+ writes both tool-call observations (toolName != "chat")
// and chat-message observations (toolName == "chat", originating from the
// `message_received` / `message_sent` hooks). Both kinds land in the same
// `observations` table; we surface the split in the snapshot's counts so
// downstream tooling can tell at a glance whether the agent was a chat-only
// or tool-using session.

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

import { resolveClawMemDbPath } from "../data-dir.ts"

const CHARS_PER_TOKEN = 4

export interface SemanticSnapshot {
  version: 1
  capturedAt: string
  tokenBudget: number
  tokensUsed: number
  observations: ObservationEntry[]
  summaries: SummaryEntry[]
  /** Source DB path (where the snapshot was read from), or null if no DB found. */
  sourceDbPath: string | null
  /** Counts surfaced for quick at-a-glance: how many of each kind were available. */
  counts: {
    totalObservations: number
    chatObservations: number
    toolObservations: number
    summaries: number
  }
}

export interface ObservationEntry {
  id: number
  type: string
  title: string | null
  facts: string[]
  narrative: string | null
  concepts: string[]
  /** "chat" for chat-memory observations, tool name for tool-call observations, null for legacy rows. */
  toolName: string | null
  createdAt: string
}

export interface SummaryEntry {
  request: string | null
  learned: string | null
  completed: string | null
  next_steps: string | null
  createdAt: string
}

export interface SemanticSnapshotConfig {
  enabled: boolean
  tokenBudget: number
  maxObservations: number
  maxSummaries: number
  claudeMemDbPath: string
}

const DEFAULT_CONFIG: SemanticSnapshotConfig = {
  enabled: true,
  tokenBudget: 8000,
  maxObservations: 50,
  maxSummaries: 10,
  claudeMemDbPath: "",
}

/** Estimate token count for a string */
function estimateTokens(text: string | null): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Estimate tokens for an observation entry */
function observationTokens(obs: ObservationEntry): number {
  let chars = 0
  if (obs.title) chars += obs.title.length
  if (obs.narrative) chars += obs.narrative.length
  for (const fact of obs.facts) chars += fact.length
  for (const concept of obs.concepts) chars += concept.length
  chars += obs.type.length + (obs.createdAt?.length ?? 0)
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/** Estimate tokens for a summary entry */
function summaryTokens(summary: SummaryEntry): number {
  let chars = 0
  if (summary.request) chars += summary.request.length
  if (summary.learned) chars += summary.learned.length
  if (summary.completed) chars += summary.completed.length
  if (summary.next_steps) chars += summary.next_steps.length
  chars += summary.createdAt?.length ?? 0
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/** Parse JSON array field from SQLite (stored as JSON string) */
function parseJsonArray(value: unknown): string[] {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

/**
 * Try to find and open the claw-mem SQLite database.
 *
 * Priority:
 *   1. config.claudeMemDbPath (explicit, kept under the legacy field name
 *      for backward compatibility with older operator configs)
 *   2. shared chain via resolveClawMemDbPath: $CLAW_MEM_DATA_DIR →
 *      $OPENCLAW_STATE_DIR/claw-mem → ~/.claw-mem
 *
 * Returns null (not throws) if no DB is found — the snapshot then degrades
 * gracefully into an empty stub so the surrounding backup still proceeds.
 */
async function openClawMemDb(
  config: SemanticSnapshotConfig,
): Promise<{ db: InstanceType<typeof import("node:sqlite").DatabaseSync>; close: () => void; path: string } | null> {
  // Dynamic import node:sqlite (experimental in Node 22+)
  let DatabaseSync: typeof import("node:sqlite").DatabaseSync
  try {
    const sqliteModule = await import("node:sqlite")
    DatabaseSync = sqliteModule.DatabaseSync
  } catch {
    return null
  }

  const tryOpen = (path: string) => {
    try {
      const db = new DatabaseSync(path, { open: true, readOnly: true })
      return { db, close: () => db.close(), path }
    } catch {
      return null
    }
  }

  if (config.claudeMemDbPath) {
    return tryOpen(config.claudeMemDbPath)
  }
  const resolved = resolveClawMemDbPath()
  if (!resolved) return null
  return tryOpen(resolved)
}

/** Query observations from claw-mem database */
function queryObservations(
  db: InstanceType<typeof import("node:sqlite").DatabaseSync>,
  maxRows: number,
): ObservationEntry[] {
  const rows = db
    .prepare(
      `SELECT id, type, title, facts, narrative, concepts, tool_name, created_at
       FROM observations
       ORDER BY created_at_epoch DESC
       LIMIT ?`,
    )
    .all(maxRows) as Array<{
    id: number
    type: string
    title: string | null
    facts: string | null
    narrative: string | null
    concepts: string | null
    tool_name: string | null
    created_at: string
  }>

  return rows.map((row) => ({
    id: row.id,
    type: row.type ?? "unknown",
    title: row.title,
    facts: parseJsonArray(row.facts),
    narrative: row.narrative,
    concepts: parseJsonArray(row.concepts),
    toolName: row.tool_name,
    createdAt: row.created_at,
  }))
}

/** Total observation count in the table (independent of the LIMIT). */
function countObservations(
  db: InstanceType<typeof import("node:sqlite").DatabaseSync>,
): { total: number; chat: number; tool: number } {
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM observations`).get() as { n: number }
  // claw-mem 2.2.0+ writes role-specific tool_names (`message_received` for
  // user, `message_sent` for assistant). 2.1.0 wrote `chat` for both.
  // Counting all three keeps the chat tally correct across the upgrade.
  const chatRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM observations
       WHERE tool_name IN ('message_received', 'message_sent', 'chat')`,
    )
    .get() as { n: number }
  const total = Number(totalRow?.n ?? 0)
  const chat = Number(chatRow?.n ?? 0)
  return { total, chat, tool: Math.max(0, total - chat) }
}

/** Query session summaries from claw-mem database */
function querySummaries(
  db: InstanceType<typeof import("node:sqlite").DatabaseSync>,
  maxRows: number,
): SummaryEntry[] {
  const rows = db
    .prepare(
      `SELECT request, learned, completed, next_steps, created_at
       FROM session_summaries
       ORDER BY created_at_epoch DESC
       LIMIT ?`,
    )
    .all(maxRows) as Array<{
    request: string | null
    learned: string | null
    completed: string | null
    next_steps: string | null
    created_at: string
  }>

  return rows.map((row) => ({
    request: row.request,
    learned: row.learned,
    completed: row.completed,
    next_steps: row.next_steps,
    createdAt: row.created_at,
  }))
}

/**
 * Capture a semantic snapshot from claw-mem's database.
 * Greedily packs observations and summaries within the token budget.
 * Writes result to .coc-backup/semantic-snapshot.json.
 *
 * Graceful degradation: if claw-mem isn't installed (no DB found) or the
 * snapshot is disabled by config, writes a stub snapshot with sourceDbPath
 * = null so the rest of the backup pipeline still runs unchanged.
 */
export async function captureSemanticSnapshot(
  baseDir: string,
  config?: Partial<SemanticSnapshotConfig>,
): Promise<SemanticSnapshot> {
  const cfg: SemanticSnapshotConfig = { ...DEFAULT_CONFIG, ...config }

  const emptySnapshot = (sourceDbPath: string | null): SemanticSnapshot => ({
    version: 1,
    capturedAt: new Date().toISOString(),
    tokenBudget: cfg.tokenBudget,
    tokensUsed: 0,
    observations: [],
    summaries: [],
    sourceDbPath,
    counts: { totalObservations: 0, chatObservations: 0, toolObservations: 0, summaries: 0 },
  })

  if (!cfg.enabled) {
    const empty = emptySnapshot(null)
    await writeSnapshot(baseDir, empty)
    return empty
  }

  const connection = await openClawMemDb(cfg)
  if (!connection) {
    // claw-mem not installed — graceful degradation
    const empty = emptySnapshot(null)
    await writeSnapshot(baseDir, empty)
    return empty
  }

  try {
    const allObservations = queryObservations(connection.db, cfg.maxObservations)
    const allSummaries = querySummaries(connection.db, cfg.maxSummaries)
    const counts = countObservations(connection.db)

    // Greedy packing: summaries first (higher information density), then observations
    let tokensUsed = 0
    const packedSummaries: SummaryEntry[] = []
    const packedObservations: ObservationEntry[] = []

    for (const summary of allSummaries) {
      const tokens = summaryTokens(summary)
      if (tokensUsed + tokens > cfg.tokenBudget) break
      packedSummaries.push(summary)
      tokensUsed += tokens
    }

    for (const obs of allObservations) {
      const tokens = observationTokens(obs)
      if (tokensUsed + tokens > cfg.tokenBudget) break
      packedObservations.push(obs)
      tokensUsed += tokens
    }

    const snapshot: SemanticSnapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      tokenBudget: cfg.tokenBudget,
      tokensUsed,
      observations: packedObservations,
      summaries: packedSummaries,
      sourceDbPath: connection.path,
      counts: {
        totalObservations: counts.total,
        chatObservations: counts.chat,
        toolObservations: counts.tool,
        summaries: packedSummaries.length,
      },
    }

    await writeSnapshot(baseDir, snapshot)
    return snapshot
  } finally {
    connection.close()
  }
}

async function writeSnapshot(baseDir: string, snapshot: SemanticSnapshot): Promise<void> {
  const snapshotDir = join(baseDir, ".coc-backup")
  await mkdir(snapshotDir, { recursive: true })
  const snapshotPath = join(snapshotDir, "semantic-snapshot.json")
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2))
}

/**
 * Read a previously written semantic snapshot from disk.
 * Returns null if file doesn't exist or is malformed.
 */
export async function readSemanticSnapshot(baseDir: string): Promise<SemanticSnapshot | null> {
  const snapshotPath = join(baseDir, ".coc-backup", "semantic-snapshot.json")
  try {
    const content = await readFile(snapshotPath, "utf8")
    const parsed = JSON.parse(content)
    if (parsed.version !== 1) return null
    return parsed as SemanticSnapshot
  } catch {
    return null
  }
}
