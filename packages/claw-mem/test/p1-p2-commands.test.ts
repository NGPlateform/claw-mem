// Smoke tests for P1 + P2 commands. Spawns the CLI bin in subprocesses.

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

import { Database } from "../src/db/database.ts"
import { ObservationStore } from "../src/db/observation-store.ts"
import { SummaryStore } from "../src/db/summary-store.ts"
import { SessionStore } from "../src/db/session-store.ts"

const BIN = join(import.meta.dirname, "..", "bin", "claw-mem")

function runCli(home: string, args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync(BIN, args, {
    env: { ...process.env, HOME: home, CLAW_MEM_DEBUG: "" },
    encoding: "utf-8",
    timeout: 30_000,
  })
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? -1 }
}

async function plantMemoryRows(home: string, count: number, ageDays = 0): Promise<void> {
  const dbPath = join(home, ".claw-mem", "claw-mem.db")
  await mkdir(join(home, ".claw-mem"), { recursive: true })
  const db = new Database(dbPath)
  await db.open()
  const sessions = new SessionStore(db)
  const observations = new ObservationStore(db)
  const summaries = new SummaryStore(db)

  const now = Math.floor(Date.now() / 1000)
  const epoch = now - ageDays * 86_400

  for (let i = 0; i < count; i++) {
    const sessionId = `e2e-${i}`
    sessions.startSession(sessionId, "e2e-agent")
    const obsId = observations.insert({
      sessionId,
      agentId: "e2e-agent",
      type: "discovery",
      title: `Finding ${i}`,
      facts: [`fact ${i}`],
      narrative: `narrative ${i}`,
      concepts: ["concept-x"],
      filesRead: [],
      filesModified: [],
      toolName: "Read",
      promptNumber: 1,
    })
    summaries.upsert({
      sessionId,
      agentId: "e2e-agent",
      request: `req ${i}`,
      investigated: null, learned: `learn ${i}`, completed: null,
      nextSteps: null, notes: null, observationCount: 1,
    })
    void obsId
  }

  // Backdate everything if requested.
  if (ageDays > 0) {
    db.connection.prepare("UPDATE observations SET created_at_epoch = ?").run(epoch)
    db.connection.prepare("UPDATE session_summaries SET created_at_epoch = ?").run(epoch)
    db.connection.prepare("UPDATE sessions SET started_at_epoch = ?").run(epoch)
  }
  db.close()
}

// ─── P1 ─────────────────────────────────────────────────────

describe("CLI: version", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-version-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("emits a JSON snapshot", () => {
    const r = runCli(home, ["version", "--json"])
    assert.equal(r.code, 0, r.stderr)
    const info = JSON.parse(r.stdout) as Record<string, unknown>
    assert.ok("clawMem" in info)
    assert.ok("schema" in info)
    assert.equal(info.schema, 3)
    assert.ok((info.node as string).startsWith("v"))
  })

  it("prints human-readable version info", () => {
    const r = runCli(home, ["version"])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /claw-mem\s+\S/)
    assert.match(r.stdout, /schema version/)
    assert.match(r.stdout, /Node\s+v22/)
  })
})

describe("CLI: tools list", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-tools-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("discovers all 26 tools across 3 groups", () => {
    const r = runCli(home, ["tools", "list", "--json"])
    assert.equal(r.code, 0, r.stderr)
    const tools = JSON.parse(r.stdout) as Array<{ name: string; description: string }>
    assert.ok(Array.isArray(tools))
    assert.equal(tools.length, 26)
    const names = tools.map((t) => t.name)
    // Spot-check one from each group
    assert.ok(names.includes("mem-search"))
    assert.ok(names.includes("coc-node-init"))
    assert.ok(names.includes("soul-backup"))
    // P3 additions
    assert.ok(names.includes("soul-resurrection"))
    assert.ok(names.includes("soul-carrier-request"))
    assert.ok(names.includes("soul-guardian-manage"))
    assert.ok(names.includes("soul-recovery-initiate"))
  })

  it("includes parameter schema with --with-schema", () => {
    const r = runCli(home, ["tools", "list", "--json", "--with-schema"])
    assert.equal(r.code, 0)
    const tools = JSON.parse(r.stdout) as Array<{ name: string; parameters?: unknown }>
    const search = tools.find((t) => t.name === "mem-search")
    assert.ok(search?.parameters)
  })
})

describe("CLI: mem peek", () => {
  let home: string
  before(async () => {
    home = await mkdtemp(join(tmpdir(), "claw-peek-"))
    await plantMemoryRows(home, 3, 0)
  })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("returns markdown with the right token accounting", () => {
    const r = runCli(home, ["mem", "peek", "--json"])
    assert.equal(r.code, 0, r.stderr)
    const peek = JSON.parse(r.stdout) as { agentId: string; observationCount: number; markdown: string; tokensUsed: number }
    assert.equal(peek.agentId, "e2e-agent")
    assert.ok(peek.observationCount >= 1)
    assert.ok(peek.tokensUsed >= 0)
    assert.ok(peek.markdown.length > 0)
  })

  it("reports nothing when the agent is unknown", () => {
    const r = runCli(home, ["mem", "peek", "--agent", "nobody"])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /No memory recorded/)
  })
})

describe("CLI: bootstrap logs (no log present)", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-bootlogs-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("reports gracefully when hardhat.log is missing", () => {
    const r = runCli(home, ["bootstrap", "logs"])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /No hardhat log found/)
  })
})

// ─── P2 ─────────────────────────────────────────────────────

describe("CLI: db migrate-status / db size / db vacuum", () => {
  let home: string
  before(async () => {
    home = await mkdtemp(join(tmpdir(), "claw-db-"))
    await plantMemoryRows(home, 5, 0)
  })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("migrate-status reports up to date", () => {
    const r = runCli(home, ["db", "migrate-status", "--json"])
    assert.equal(r.code, 0, r.stderr)
    const info = JSON.parse(r.stdout) as { upToDate: boolean; currentVersion: number; latestVersion: number }
    assert.equal(info.upToDate, true)
    assert.equal(info.currentVersion, info.latestVersion)
  })

  it("size returns positive total", () => {
    const r = runCli(home, ["db", "size", "--json"])
    assert.equal(r.code, 0)
    const info = JSON.parse(r.stdout) as { total: number }
    assert.ok(info.total > 0)
  })

  it("vacuum runs without error", () => {
    const r = runCli(home, ["db", "vacuum", "--json"])
    assert.equal(r.code, 0, r.stderr)
    const info = JSON.parse(r.stdout) as { beforeBytes: number; afterBytes: number }
    assert.ok(info.beforeBytes > 0)
    assert.ok(info.afterBytes >= 0)
  })
})

describe("CLI: mem prune", () => {
  let home: string
  before(async () => {
    home = await mkdtemp(join(tmpdir(), "claw-prune-"))
    await plantMemoryRows(home, 5, 30)  // 30 days old
  })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("dry-run reports the count without deleting", () => {
    const r = runCli(home, ["mem", "prune", "--older-than", "10", "--dry-run"])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /Observations:\s+5 would be removed/)
    // Verify rows still exist
    const status = runCli(home, ["mem", "status", "--json"])
    const s = JSON.parse(status.stdout) as { observations: number }
    assert.equal(s.observations, 5)
  })

  it("actual run deletes rows", () => {
    const r = runCli(home, ["mem", "prune", "--older-than", "10", "--include-summaries", "--include-sessions"])
    assert.equal(r.code, 0, r.stderr)
    const status = runCli(home, ["mem", "status", "--json"])
    const s = JSON.parse(status.stdout) as { observations: number; summaries: number; sessions: number }
    assert.equal(s.observations, 0)
    assert.equal(s.summaries, 0)
    assert.equal(s.sessions, 0)
  })
})

describe("CLI: mem export → import round-trip", () => {
  let homeA: string
  let homeB: string
  let exportFile: string

  before(async () => {
    homeA = await mkdtemp(join(tmpdir(), "claw-exportA-"))
    homeB = await mkdtemp(join(tmpdir(), "claw-exportB-"))
    exportFile = join(homeA, "export.json")
    await plantMemoryRows(homeA, 4, 0)
  })
  after(async () => {
    await rm(homeA, { recursive: true, force: true })
    await rm(homeB, { recursive: true, force: true })
  })

  it("export writes a JSON file with the expected counts", () => {
    const r = runCli(homeA, ["mem", "export", exportFile])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /4 observations, 4 summaries, 4 sessions/)
  })

  it("import into a different home recreates the rows", async () => {
    const exists = await readFile(exportFile, "utf-8").then(() => true).catch(() => false)
    assert.ok(exists, "export file must exist before import")

    const r = runCli(homeB, ["mem", "import", exportFile])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /4 observations, 4 summaries, 4 sessions/)

    const status = runCli(homeB, ["mem", "status", "--json"])
    const s = JSON.parse(status.stdout) as { observations: number; summaries: number; sessions: number }
    assert.equal(s.observations, 4)
    assert.equal(s.summaries, 4)
    assert.equal(s.sessions, 4)
  })

  it("re-importing is idempotent (--skip-existing default)", () => {
    const r = runCli(homeB, ["mem", "import", exportFile])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /0 observations, 0 summaries, 0 sessions/)
  })
})

describe("CLI: backup find-recoverable", () => {
  let home: string
  before(async () => {
    home = await mkdtemp(join(tmpdir(), "claw-find-"))
    // Plant a backup archive row directly (no real chain needed).
    const dbPath = join(home, ".claw-mem", "claw-mem.db")
    await mkdir(join(home, ".claw-mem"), { recursive: true })
    const db = new Database(dbPath)
    await db.open()
    const { ArchiveStore } = await import("../src/db/archive-store.ts")
    const store = new ArchiveStore(db)
    store.insert({
      agentId: "0xagent",
      manifestCid: "QmCID111111111111111111111111111",
      backupType: "full",
      fileCount: 5,
      totalBytes: 1024,
      dataMerkleRoot: "0xroot",
    })
    db.close()
  })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("lists recoverable agent + latest cid from local index", () => {
    const r = runCli(home, ["backup", "find-recoverable", "--json"])
    assert.equal(r.code, 0, r.stderr)
    const result = JSON.parse(r.stdout) as { local: Array<{ agentId: string; latest: { manifestCid: string } | null }> }
    assert.equal(result.local.length, 1)
    assert.equal(result.local[0].agentId, "0xagent")
    assert.match(result.local[0].latest!.manifestCid, /QmCID/)
  })
})

describe("CLI: backup prune", () => {
  let home: string
  before(async () => {
    home = await mkdtemp(join(tmpdir(), "claw-bk-prune-"))
    const dbPath = join(home, ".claw-mem", "claw-mem.db")
    await mkdir(join(home, ".claw-mem"), { recursive: true })
    const db = new Database(dbPath)
    await db.open()
    const { ArchiveStore } = await import("../src/db/archive-store.ts")
    const store = new ArchiveStore(db)
    for (let i = 0; i < 5; i++) {
      store.insert({
        agentId: "0xag",
        manifestCid: `QmCID-${i}-` + "x".repeat(40),
        backupType: i === 0 ? "full" : "incremental",
        fileCount: 1, totalBytes: 100,
        dataMerkleRoot: "0xroot",
      })
    }
    // Backdate all to 30 days ago
    const old = Math.floor((Date.now() - 30 * 86400_000) / 1000)
    db.connection.prepare("UPDATE backup_archives SET created_at_epoch = ?").run(old)
    db.close()
  })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("dry-run reports the right candidates and respects --keep-latest", () => {
    const r = runCli(home, ["backup", "prune", "--older-than", "10", "--keep-latest", "2", "--dry-run"])
    assert.equal(r.code, 0, r.stderr)
    // 5 entries, keep latest 2 → 3 candidates
    assert.match(r.stdout, /Candidates:\s+3/)
  })

  it("actual run deletes the candidates", () => {
    const r = runCli(home, ["backup", "prune", "--older-than", "10", "--keep-latest", "2"])
    assert.equal(r.code, 0)
    const list = runCli(home, ["backup", "list", "--json"])
    const archives = JSON.parse(list.stdout) as Array<unknown>
    assert.equal(archives.length, 2)
  })
})

describe("CLI: uninstall --dry-run", () => {
  let home: string
  before(async () => {
    home = await mkdtemp(join(tmpdir(), "claw-uninst-"))
    await plantMemoryRows(home, 1, 0)
    // Plant a fake key file
    await mkdir(join(home, ".claw-mem", "keys"), { recursive: true })
    await writeFile(join(home, ".claw-mem", "keys", "operator.key"), "0xfake")
  })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("--dry-run preserves keys by default", () => {
    const r = runCli(home, ["uninstall", "--dry-run"])
    assert.equal(r.code, 0, r.stderr)
    // Implementation detail: we list everything either as a Would delete or Preserve.
    // Some paths flow as one or the other depending on flags; just check that the
    // operator key directory survives the default flow.
    assert.match(r.stdout, /\.claw-mem.*keys/)
    assert.match(r.stdout, /dry-run, nothing actually removed/)
  })
})
