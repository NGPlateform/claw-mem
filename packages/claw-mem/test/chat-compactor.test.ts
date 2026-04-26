import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { Database } from "../src/db/database.ts"
import { ObservationStore } from "../src/db/observation-store.ts"
import { SessionStore } from "../src/db/session-store.ts"
import { runChatCompaction, CompactionTrigger } from "../src/observer/chat-compactor.ts"
import { ClawMemConfigSchema } from "../src/config.ts"
import type { SessionSummarizer } from "../src/observer/index.ts"

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

// Stub summarizer: returns a deterministic summary so tests don't depend
// on heuristic / LLM behavior.
const stubSummarizer: SessionSummarizer = async (sessionId, agentId, observations) => ({
  sessionId,
  agentId,
  request: "compact request",
  investigated: null,
  learned: `compacted ${observations.length} chat observations`,
  completed: null,
  nextSteps: null,
  notes: null,
  observationCount: observations.length,
})

let tmpDir: string
let db: Database
let observations: ObservationStore
let sessions: SessionStore

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-compactor-test-"))
  db = new Database(join(tmpDir, "test.db"))
  await db.open()
  observations = new ObservationStore(db)
  sessions = new SessionStore(db)
  sessions.startSession("s1", "alice")
})

afterEach(async () => {
  db.close()
  await rm(tmpDir, { recursive: true, force: true })
})

function insertChat(role: "user" | "assistant", text: string, importance: number) {
  return observations.insert({
    sessionId: "s1",
    agentId: "alice",
    type: "discovery",
    title: `${role}: ${text.slice(0, 60)}`,
    facts: [`role: ${role}`],
    narrative: text,
    concepts: [],
    filesRead: [],
    filesModified: [],
    toolName: role === "user" ? "message_received" : "message_sent",
    promptNumber: 0,
    importance,
  })
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return ClawMemConfigSchema.parse({
    chatMemory: {
      enabled: true,
      compaction: {
        enabled: true,
        triggerEvery: 5,
        keepRecentRaw: 2,
        deleteCompactedLowValue: true,
        minImportanceToKeep: 0.7,
        ...overrides,
      },
    },
  })
}

describe("runChatCompaction", () => {
  it("returns zero result when no chat rows exist", async () => {
    const config = makeConfig()
    const result = await runChatCompaction(
      { db, observations, summarizer: stubSummarizer, config, logger: silentLogger },
      "alice",
    )
    assert.equal(result.batchSize, 0)
    assert.equal(result.compactionId, null)
    assert.equal(result.prunedCount, 0)
  })

  it("rolls a batch into a chat_compaction observation, marks originals", async () => {
    const ids: number[] = []
    for (let i = 0; i < 8; i++) ids.push(insertChat("user", `msg ${i}`, 0.4))

    const config = makeConfig({ keepRecentRaw: 2, deleteCompactedLowValue: false })
    const result = await runChatCompaction(
      { db, observations, summarizer: stubSummarizer, config, logger: silentLogger },
      "alice",
    )

    // 8 inserted, keepRecentRaw=2 → 6 compactable.
    assert.equal(result.batchSize, 6)
    assert.ok(result.compactionId !== null)

    // Compaction observation exists with the right shape.
    const compaction = db.connection
      .prepare("SELECT * FROM observations WHERE id = ?")
      .get(result.compactionId) as { tool_name: string; type: string; concepts: string }
    assert.equal(compaction.tool_name, "chat_compaction")
    assert.equal(compaction.type, "learning")
    assert.ok((compaction.concepts as string).includes("chat-memory"))

    // Originals are marked compacted.
    const compactedCount = db.connection
      .prepare("SELECT COUNT(*) AS n FROM observations WHERE compacted = 1 AND compacted_into = ?")
      .get(result.compactionId) as { n: number }
    assert.equal(compactedCount.n, 6)

    // Last 2 (keepRecentRaw) stay uncompacted.
    const uncompactedCount = db.connection
      .prepare(`SELECT COUNT(*) AS n FROM observations WHERE compacted = 0 AND tool_name IN ('message_received')`)
      .get() as { n: number }
    assert.equal(uncompactedCount.n, 2)
  })

  it("hard-prunes low-importance compacted rows when deleteCompactedLowValue=true", async () => {
    // 4 low-importance + 4 high-importance, keepRecentRaw=0 so prune can touch everything compacted
    for (let i = 0; i < 4; i++) insertChat("user", `chitchat ${i}`, 0.3)
    for (let i = 0; i < 4; i++) insertChat("user", `important ${i}`, 0.85)

    const config = makeConfig({ keepRecentRaw: 0, minImportanceToKeep: 0.7, deleteCompactedLowValue: true })
    const result = await runChatCompaction(
      { db, observations, summarizer: stubSummarizer, config, logger: silentLogger },
      "alice",
    )

    assert.equal(result.batchSize, 8)
    // Low-importance (0.3) all eligible for prune; high-importance (0.85) preserved.
    assert.equal(result.prunedCount, 4)

    // Surviving compacted rows are the high-importance ones.
    const remaining = db.connection
      .prepare(`SELECT importance FROM observations WHERE compacted = 1`)
      .all() as Array<{ importance: number }>
    assert.equal(remaining.length, 4)
    for (const r of remaining) assert.ok(r.importance >= 0.7)
  })

  it("keepRecentRaw protects the latest N from compaction even when batch is small", async () => {
    for (let i = 0; i < 3; i++) insertChat("user", `msg ${i}`, 0.4)
    const config = makeConfig({ keepRecentRaw: 5 }) // keep 5 but only 3 exist
    const result = await runChatCompaction(
      { db, observations, summarizer: stubSummarizer, config, logger: silentLogger },
      "alice",
    )
    assert.equal(result.batchSize, 0, "nothing should compact when keepRecentRaw >= total")
    assert.equal(result.compactionId, null)
  })

  it("returns zero when chat-memory or compaction is disabled", async () => {
    for (let i = 0; i < 8; i++) insertChat("user", `msg ${i}`, 0.4)
    const off = makeConfig({ enabled: false })
    const result = await runChatCompaction(
      { db, observations, summarizer: stubSummarizer, config: off, logger: silentLogger },
      "alice",
    )
    assert.equal(result.batchSize, 0)
  })
})

describe("CompactionTrigger", () => {
  it("ticks return false until the threshold is hit, then resets", () => {
    const t = new CompactionTrigger({ enabled: true, triggerEvery: 3 })
    assert.equal(t.tick(), false)
    assert.equal(t.tick(), false)
    assert.equal(t.tick(), true)  // reset
    assert.equal(t.tick(), false)
    assert.equal(t.tick(), false)
    assert.equal(t.tick(), true)
  })

  it("never fires when disabled", () => {
    const t = new CompactionTrigger({ enabled: false, triggerEvery: 1 })
    for (let i = 0; i < 10; i++) assert.equal(t.tick(), false)
  })

  it("reset() clears the counter mid-cycle", () => {
    const t = new CompactionTrigger({ enabled: true, triggerEvery: 5 })
    t.tick(); t.tick(); t.tick(); t.tick() // 4/5
    t.reset()
    assert.equal(t.tick(), false) // 1/5 again, not 5/5
  })
})
