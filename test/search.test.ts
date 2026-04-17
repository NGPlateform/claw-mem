import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { Database } from "../src/db/database.ts"
import { ObservationStore } from "../src/db/observation-store.ts"
import { SessionStore } from "../src/db/session-store.ts"
import { SearchEngine } from "../src/search/search.ts"

describe("SearchEngine", () => {
  let tmpDir: string
  let db: Database
  let search: SearchEngine

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-search-test-"))
    db = new Database(join(tmpDir, "test.db"))
    await db.open()

    const sessions = new SessionStore(db)
    sessions.startSession("s1", "a1")
    sessions.startSession("s2", "a1")

    const obs = new ObservationStore(db)
    obs.insert({
      sessionId: "s1", agentId: "a1", type: "decision",
      title: "Implemented Redis caching layer",
      facts: ["Reduced queries by 60%"], narrative: "Added Redis to reduce DB load",
      concepts: ["redis", "caching"], filesRead: [], filesModified: ["src/cache.ts"],
      toolName: "Edit", promptNumber: 1,
    })
    obs.insert({
      sessionId: "s1", agentId: "a1", type: "discovery",
      title: "Found SQL injection vulnerability",
      facts: ["Unparameterized query in login"], narrative: "Login endpoint has raw SQL",
      concepts: ["security", "sql"], filesRead: ["src/auth.ts"], filesModified: [],
      toolName: "Read", promptNumber: 2,
    })
    obs.insert({
      sessionId: "s2", agentId: "a1", type: "pattern",
      title: "Repository pattern usage",
      facts: ["All services use repos"], narrative: "Consistent data access via repository",
      concepts: ["architecture"], filesRead: [], filesModified: [],
      toolName: "Grep", promptNumber: 1,
    })

    search = new SearchEngine(db)
  })

  after(async () => {
    db.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("searches via FTS5", () => {
    const result = search.search({ query: "Redis caching" })
    assert.equal(result.source, "fts")
    assert.ok(result.results.length > 0)
    assert.ok(result.results.some((r) => r.title.includes("Redis")))
  })

  it("filters by type", () => {
    const result = search.search({ query: "pattern repository", type: "pattern" })
    for (const r of result.results) {
      assert.equal(r.type, "pattern")
    }
  })

  it("respects limit", () => {
    const result = search.search({ query: "a", limit: 1 })
    assert.ok(result.results.length <= 1)
  })

  it("returns empty for no matches", () => {
    const result = search.search({ query: "zzzznonexistentzzzz" })
    assert.equal(result.results.length, 0)
  })

  it("filters by agentId", () => {
    const result = search.search({ query: "Redis", agentId: "nonexistent-agent" })
    assert.equal(result.results.length, 0)
  })
})
