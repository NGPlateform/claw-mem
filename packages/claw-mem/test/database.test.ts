import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { Database } from "../src/db/database.ts"
import { ObservationStore } from "../src/db/observation-store.ts"
import { SummaryStore } from "../src/db/summary-store.ts"
import { SessionStore } from "../src/db/session-store.ts"

describe("Database", () => {
  let tmpDir: string
  let db: Database

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-db-test-"))
    db = new Database(join(tmpDir, "test.db"))
    await db.open()
  })

  after(async () => {
    db.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("creates tables on open", () => {
    const tables = db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)

    assert.ok(names.includes("observations"))
    assert.ok(names.includes("session_summaries"))
    assert.ok(names.includes("sessions"))
    assert.ok(names.includes("schema_version"))
  })

  it("runs migrations idempotently", async () => {
    // Opening again should not fail
    const db2 = new Database(join(tmpDir, "test.db"))
    await db2.open()
    db2.close()
  })
})

describe("ObservationStore", () => {
  let tmpDir: string
  let db: Database
  let store: ObservationStore

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-obs-test-"))
    db = new Database(join(tmpDir, "test.db"))
    await db.open()
    store = new ObservationStore(db)

    // Create session for foreign key
    new SessionStore(db).startSession("session-1", "agent-1")
  })

  after(async () => {
    db.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("inserts and retrieves observations", () => {
    const id = store.insert({
      sessionId: "session-1",
      agentId: "agent-1",
      type: "decision",
      title: "Added Redis caching",
      facts: ["Reduced queries by 60%"],
      narrative: "Implemented Redis to reduce DB load",
      concepts: ["redis", "performance"],
      filesRead: [],
      filesModified: ["src/cache.ts"],
      toolName: "Edit",
      promptNumber: 1,
    })

    assert.ok(id > 0)

    const recent = store.getRecent("agent-1", 10)
    assert.equal(recent.length, 1)
    assert.equal(recent[0].title, "Added Redis caching")
    assert.deepEqual(recent[0].facts, ["Reduced queries by 60%"])
    assert.deepEqual(recent[0].concepts, ["redis", "performance"])
  })

  it("detects duplicates within dedup window", () => {
    const input = {
      sessionId: "session-1",
      agentId: "agent-1",
      type: "discovery" as const,
      title: "Found N+1 query",
      facts: [],
      narrative: null,
      concepts: [],
      filesRead: [],
      filesModified: [],
      toolName: "Grep",
      promptNumber: 2,
    }

    store.insert(input)
    assert.ok(store.isDuplicate(input, 30_000))
  })

  it("counts observations by agent", () => {
    const count = store.countByAgent("agent-1")
    assert.ok(count >= 2)
  })

  it("deletes observations by session", () => {
    // Insert into a different session
    new SessionStore(db).startSession("session-del", "agent-1")
    store.insert({
      sessionId: "session-del",
      agentId: "agent-1",
      type: "change",
      title: "Temp change",
      facts: [],
      narrative: null,
      concepts: [],
      filesRead: [],
      filesModified: [],
      toolName: "Write",
      promptNumber: 1,
    })

    const deleted = store.deleteBySession("session-del")
    assert.equal(deleted, 1)

    const remaining = store.getBySession("session-del")
    assert.equal(remaining.length, 0)
  })
})

describe("SummaryStore", () => {
  let tmpDir: string
  let db: Database
  let store: SummaryStore

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-sum-test-"))
    db = new Database(join(tmpDir, "test.db"))
    await db.open()
    store = new SummaryStore(db)
  })

  after(async () => {
    db.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("inserts and retrieves summaries", () => {
    store.upsert({
      sessionId: "session-1",
      agentId: "agent-1",
      request: "Optimize database",
      investigated: "Query patterns",
      learned: "Redis reduces latency 40%",
      completed: "Implemented caching",
      nextSteps: "Monitor metrics",
      notes: null,
      observationCount: 5,
    })

    const recent = store.getRecent("agent-1", 10)
    assert.equal(recent.length, 1)
    assert.equal(recent[0].request, "Optimize database")
    assert.equal(recent[0].learned, "Redis reduces latency 40%")
  })

  it("upserts on conflict (same session_id)", () => {
    store.upsert({
      sessionId: "session-1",
      agentId: "agent-1",
      request: "Updated request",
      investigated: null,
      learned: "Updated learning",
      completed: null,
      nextSteps: null,
      notes: null,
      observationCount: 10,
    })

    const summary = store.getBySession("session-1")
    assert.ok(summary)
    assert.equal(summary!.request, "Updated request")
    assert.equal(summary!.observationCount, 10)

    // Should still be only 1 summary for agent-1
    assert.equal(store.countByAgent("agent-1"), 1)
  })
})

describe("SessionStore", () => {
  let tmpDir: string
  let db: Database
  let store: SessionStore

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-sess-test-"))
    db = new Database(join(tmpDir, "test.db"))
    await db.open()
    store = new SessionStore(db)
  })

  after(async () => {
    db.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("starts and retrieves sessions", () => {
    store.startSession("s1", "a1")
    const session = store.getSession("s1")
    assert.ok(session)
    assert.equal(session!.sessionId, "s1")
    assert.equal(session!.agentId, "a1")
    assert.equal(session!.promptCount, 0)
  })

  it("increments prompt count", () => {
    const count = store.incrementPrompt("s1")
    assert.equal(count, 1)

    const count2 = store.incrementPrompt("s1")
    assert.equal(count2, 2)
  })

  it("ends sessions", () => {
    store.endSession("s1")
    // Session should still be retrievable
    const session = store.getSession("s1")
    assert.ok(session)
  })
})
