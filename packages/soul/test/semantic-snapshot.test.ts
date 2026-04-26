// Verifies the v1.2.0 semantic-snapshot behavior:
//   - schema reads from the real claw-mem table layout (observations +
//     session_summaries, with tool_name and created_at_epoch columns)
//   - graceful degradation when the DB is missing
//   - chat vs tool observations counted distinctly
//   - sourceDbPath surfaces the resolved DB location
//
// Builds a minimal fixture DB that mirrors claw-mem's schema (the columns we
// actually query, not every column in the live migrations) so the test stays
// independent of @chainofclaw/claw-mem.

import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { captureSemanticSnapshot } from "../src/backup/semantic-snapshot.ts"

let scratch: string
let backupDir: string
let originalHome: string | undefined

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "coc-soul-snapshot-"))
  backupDir = join(scratch, "agent-home")
  mkdirSync(backupDir, { recursive: true })
  delete process.env.CLAW_MEM_DATA_DIR
  delete process.env.OPENCLAW_STATE_DIR
  originalHome = process.env.HOME
  process.env.HOME = scratch
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  delete process.env.CLAW_MEM_DATA_DIR
  delete process.env.OPENCLAW_STATE_DIR
  if (originalHome !== undefined) process.env.HOME = originalHome
  else delete process.env.HOME
})

function buildClawMemFixture(): string {
  const dataDir = join(scratch, "claw-mem")
  mkdirSync(dataDir, { recursive: true })
  const dbPath = join(dataDir, "claw-mem.db")
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      facts TEXT NOT NULL DEFAULT '[]',
      narrative TEXT,
      concepts TEXT NOT NULL DEFAULT '[]',
      tool_name TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );
    CREATE TABLE session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      agent_id TEXT NOT NULL DEFAULT '',
      request TEXT,
      learned TEXT,
      completed TEXT,
      next_steps TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );
  `)

  const insertObs = db.prepare(`
    INSERT INTO observations (session_id, type, title, facts, narrative, concepts, tool_name, created_at, created_at_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  // Two chat observations (toolName=chat) and three tool observations.
  insertObs.run("s1", "decision", "User [记一下]: deploy to staging", '["cue: 记一下"]', "deploy to staging not prod", '["staging","deploy"]', "chat", "2026-04-26T00:00:00Z", 1745625600)
  insertObs.run("s1", "learning", "User [我喜欢]: prefer tabs", '["cue: 我喜欢"]', "use tabs not spaces", '["tabs"]', "chat", "2026-04-26T00:01:00Z", 1745625660)
  insertObs.run("s1", "discovery", "Read foo.ts", '["120 lines"]', null, '["typescript"]', "Read", "2026-04-26T00:02:00Z", 1745625720)
  insertObs.run("s1", "change", "Edited bar.ts", '["+5/-2 lines"]', null, '["typescript"]', "Edit", "2026-04-26T00:03:00Z", 1745625780)
  insertObs.run("s1", "discovery", "Searched 'foo'", '["3 matches"]', null, "[]", "Grep", "2026-04-26T00:04:00Z", 1745625840)

  const insertSum = db.prepare(`
    INSERT INTO session_summaries (session_id, request, learned, completed, next_steps, created_at, created_at_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  insertSum.run("s1", "deploy refactor", "tabs vs spaces decided", "shipped staging", "watch for regressions", "2026-04-26T00:05:00Z", 1745625900)

  db.close()
  return dataDir
}

test("captureSemanticSnapshot — empty stub when no claw-mem DB present", async () => {
  process.env.CLAW_MEM_DATA_DIR = join(scratch, "nonexistent")
  const snap = await captureSemanticSnapshot(backupDir)
  assert.equal(snap.sourceDbPath, null)
  assert.equal(snap.observations.length, 0)
  assert.equal(snap.summaries.length, 0)
  assert.equal(snap.counts.totalObservations, 0)
  assert.equal(snap.counts.chatObservations, 0)
})

test("captureSemanticSnapshot — opens claw-mem DB via $CLAW_MEM_DATA_DIR", async () => {
  const dataDir = buildClawMemFixture()
  process.env.CLAW_MEM_DATA_DIR = dataDir
  const snap = await captureSemanticSnapshot(backupDir, { tokenBudget: 8000, maxObservations: 50, maxSummaries: 10 })
  assert.equal(snap.sourceDbPath, join(dataDir, "claw-mem.db"))
  assert.ok(snap.observations.length >= 5, `observations packed: ${snap.observations.length}`)
  assert.equal(snap.summaries.length, 1)
})

test("captureSemanticSnapshot — counts chat observations distinctly from tool", async () => {
  const dataDir = buildClawMemFixture()
  process.env.CLAW_MEM_DATA_DIR = dataDir
  const snap = await captureSemanticSnapshot(backupDir)
  assert.equal(snap.counts.totalObservations, 5)
  assert.equal(snap.counts.chatObservations, 2)
  assert.equal(snap.counts.toolObservations, 3)
  assert.equal(snap.counts.summaries, 1)
})

test("captureSemanticSnapshot — observation rows surface toolName field", async () => {
  const dataDir = buildClawMemFixture()
  process.env.CLAW_MEM_DATA_DIR = dataDir
  const snap = await captureSemanticSnapshot(backupDir)
  const chatRow = snap.observations.find((o) => o.toolName === "chat")
  const toolRow = snap.observations.find((o) => o.toolName !== "chat" && o.toolName !== null)
  assert.ok(chatRow, "expected at least one chat observation")
  assert.ok(toolRow, "expected at least one tool observation")
})

test("captureSemanticSnapshot — disabled config writes empty stub without opening DB", async () => {
  // Even with a valid DB present, disabled=true must skip everything.
  const dataDir = buildClawMemFixture()
  process.env.CLAW_MEM_DATA_DIR = dataDir
  const snap = await captureSemanticSnapshot(backupDir, { enabled: false })
  assert.equal(snap.sourceDbPath, null)
  assert.equal(snap.observations.length, 0)
})
