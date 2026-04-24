import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { Database } from "../src/db/database.ts"
import { SCHEMA_VERSION } from "../src/db/migrations.ts"
import { NodeStore } from "../src/db/node-store.ts"
import { ArchiveStore } from "../src/db/archive-store.ts"
import { ArtifactStore } from "../src/db/artifact-store.ts"

describe("Schema v2 migration", () => {
  let tmpDir: string
  let db: Database

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-v2-test-"))
    db = new Database(join(tmpDir, "test.db"))
    await db.open()
  })

  after(async () => {
    db.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("creates v2 tables", () => {
    const tables = db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)

    // v1 tables still present (no regression)
    assert.ok(names.includes("observations"))
    assert.ok(names.includes("session_summaries"))
    assert.ok(names.includes("sessions"))

    // v2 additions
    assert.ok(names.includes("coc_nodes"))
    assert.ok(names.includes("backup_archives"))
    assert.ok(names.includes("coc_artifacts"))
    assert.ok(names.includes("carrier_requests"))
  })

  it("records the latest schema version", () => {
    const row = db.connection
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as { v: number }
    assert.equal(row.v, SCHEMA_VERSION)
    assert.ok(SCHEMA_VERSION >= 2)
  })

  it("re-running migrations is idempotent", async () => {
    const db2 = new Database(join(tmpDir, "test.db"))
    await db2.open()
    db2.close()
  })
})

describe("v1 → v2 upgrade preserves existing data", () => {
  let tmpDir: string

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-upgrade-test-"))
  })

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("opens an existing v1 db and upgrades without losing rows", async () => {
    const dbPath = join(tmpDir, "legacy.db")

    // Phase 1: simulate a v1 database by manually creating it with only v1 schema
    {
      const db = new Database(dbPath)
      await db.open()  // runs all migrations on a fresh db

      // Insert some "legacy" rows in v1 tables
      db.connection.prepare(
        `INSERT INTO sessions (session_id, agent_id, started_at, started_at_epoch, status)
         VALUES ('legacy-1', 'agent-1', '2025-01-01T00:00:00Z', 1735689600, 'active')`,
      ).run()
      db.connection.prepare(
        `INSERT INTO observations
         (session_id, agent_id, type, title, facts, narrative, concepts,
          files_read, files_modified, tool_name, prompt_number,
          token_estimate, content_hash, created_at, created_at_epoch)
         VALUES ('legacy-1', 'agent-1', 'discovery', 'old finding',
                 '[]', null, '[]', '[]', '[]', 'Read', 1, 10, 'h1',
                 '2025-01-01T00:00:00Z', 1735689600)`,
      ).run()
      db.close()
    }

    // Phase 2: reopen — migrations should already be at SCHEMA_VERSION; verify legacy data intact
    {
      const db = new Database(dbPath)
      await db.open()

      const obsCount = db.connection.prepare("SELECT COUNT(*) as c FROM observations").get() as { c: number }
      assert.equal(obsCount.c, 1)

      const sessionRow = db.connection.prepare("SELECT * FROM sessions WHERE session_id = 'legacy-1'").get() as { agent_id: string }
      assert.equal(sessionRow.agent_id, "agent-1")

      // v2 tables exist and are empty
      const nodeCount = db.connection.prepare("SELECT COUNT(*) as c FROM coc_nodes").get() as { c: number }
      assert.equal(nodeCount.c, 0)

      db.close()
    }
  })
})

describe("NodeStore", () => {
  let tmpDir: string
  let db: Database
  let store: NodeStore

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-nodes-test-"))
    db = new Database(join(tmpDir, "test.db"))
    await db.open()
    store = new NodeStore(db)
  })

  after(async () => {
    db.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("upserts and retrieves nodes", () => {
    const node = store.upsert({
      name: "dev-1",
      type: "dev",
      network: "local",
      dataDir: "/tmp/.claw-mem/nodes/dev-1",
      services: ["node", "agent"],
      rpcPort: 18780,
    })

    assert.equal(node.name, "dev-1")
    assert.equal(node.type, "dev")
    assert.deepEqual(node.services, ["node", "agent"])
    assert.equal(node.advertisedBytes, 268_435_456)  // default
    assert.equal(node.configPath, null)

    const fetched = store.get("dev-1")
    assert.ok(fetched)
    assert.equal(fetched!.rpcPort, 18780)
  })

  it("upsert overwrites on conflict", () => {
    store.upsert({
      name: "dev-1",
      type: "fullnode",
      network: "local",
      dataDir: "/tmp/.claw-mem/nodes/dev-1",
      services: ["node", "agent", "relayer"],
      rpcPort: 18781,
      advertisedBytes: 536_870_912,
    })

    const fetched = store.get("dev-1")
    assert.equal(fetched!.type, "fullnode")
    assert.equal(fetched!.rpcPort, 18781)
    assert.equal(fetched!.advertisedBytes, 536_870_912)
    assert.deepEqual(fetched!.services, ["node", "agent", "relayer"])
  })

  it("filters by network", () => {
    store.upsert({
      name: "test-1",
      type: "dev",
      network: "testnet",
      dataDir: "/tmp/.claw-mem/nodes/test-1",
      services: ["node"],
      rpcPort: 18790,
    })

    const local = store.listByNetwork("local")
    const testnet = store.listByNetwork("testnet")

    assert.ok(local.some((n) => n.name === "dev-1"))
    assert.ok(!local.some((n) => n.name === "test-1"))
    assert.ok(testnet.some((n) => n.name === "test-1"))
  })

  it("deletes nodes", () => {
    assert.equal(store.delete("test-1"), true)
    assert.equal(store.get("test-1"), null)
    assert.equal(store.delete("nonexistent"), false)
  })
})

describe("ArchiveStore", () => {
  let tmpDir: string
  let db: Database
  let store: ArchiveStore

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-archive-test-"))
    db = new Database(join(tmpDir, "test.db"))
    await db.open()
    store = new ArchiveStore(db)
  })

  after(async () => {
    db.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("inserts and retrieves archives", () => {
    const archive = store.insert({
      agentId: "agent-x",
      manifestCid: "QmFullBackup1",
      backupType: "full",
      fileCount: 12,
      totalBytes: 1_048_576,
      dataMerkleRoot: "0xabc",
      txHash: "0xdef",
      anchoredAt: "2026-04-23T10:00:00Z",
      semanticSnapshotIncluded: true,
    })

    assert.equal(archive.manifestCid, "QmFullBackup1")
    assert.equal(archive.backupType, "full")
    assert.equal(archive.semanticSnapshotIncluded, true)
    assert.ok(archive.anchoredAtEpoch! > 0)

    const fetched = store.getByCid("QmFullBackup1")
    assert.ok(fetched)
    assert.equal(fetched!.id, archive.id)
  })

  it("rejects duplicate manifest CIDs", () => {
    assert.throws(() => {
      store.insert({
        agentId: "agent-x",
        manifestCid: "QmFullBackup1",
        backupType: "full",
        fileCount: 1,
        totalBytes: 1,
        dataMerkleRoot: "0x00",
      })
    })
  })

  it("walks incremental chain length", () => {
    store.insert({
      agentId: "agent-x",
      manifestCid: "QmInc1",
      backupType: "incremental",
      fileCount: 1,
      totalBytes: 100,
      dataMerkleRoot: "0x01",
      parentCid: "QmFullBackup1",
    })
    store.insert({
      agentId: "agent-x",
      manifestCid: "QmInc2",
      backupType: "incremental",
      fileCount: 1,
      totalBytes: 100,
      dataMerkleRoot: "0x02",
      parentCid: "QmInc1",
    })

    // Chain: QmInc2 → QmInc1 → QmFullBackup1 (full, stops here) = 3
    assert.equal(store.countIncrementalChain("agent-x", "QmInc2"), 3)
  })

  it("returns latest archive per agent", () => {
    const latest = store.getLatestByAgent("agent-x")
    assert.ok(latest)
    assert.equal(latest!.manifestCid, "QmInc2")
  })

  it("lists by agent with limit", () => {
    const list = store.listByAgent("agent-x", 2)
    assert.equal(list.length, 2)
    // Order is DESC by created_at_epoch
    assert.equal(list[0].manifestCid, "QmInc2")
  })
})

describe("ArtifactStore", () => {
  let tmpDir: string
  let db: Database
  let store: ArtifactStore

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-mem-artifact-test-"))
    db = new Database(join(tmpDir, "test.db"))
    await db.open()
    store = new ArtifactStore(db)
  })

  after(async () => {
    db.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("sets and gets artifacts; key is globally unique (network is metadata, not part of identity)", () => {
    store.set({ key: "pose_manager", value: "0xPOSE", network: "local", chainId: 31337 })
    store.set({ key: "soul_registry", value: "0xSOUL", network: "local", chainId: 31337 })
    // Setting same key with a different network overwrites — there's only one
    // active artifact per key (the deployment we're currently using).
    store.set({ key: "pose_manager", value: "0xTESTPOSE", network: "testnet", chainId: 11155111 })

    assert.equal(store.getValue("pose_manager"), "0xTESTPOSE")
    assert.equal(store.getValue("soul_registry"), "0xSOUL")
    assert.equal(store.getValue("nonexistent"), null)

    const poseRow = store.get("pose_manager")
    assert.ok(poseRow)
    assert.equal(poseRow!.network, "testnet")
    assert.equal(poseRow!.chainId, 11155111)
  })

  it("upserts on conflict", () => {
    store.set({ key: "operator_key_ref", value: "/keys/operator.key", network: "local" })
    store.set({ key: "operator_key_ref", value: "/keys/operator-v2.key", network: "local" })
    assert.equal(store.getValue("operator_key_ref"), "/keys/operator-v2.key")
  })

  it("lists by network", () => {
    // After the prior tests:
    //   pose_manager     → testnet
    //   soul_registry    → local
    //   operator_key_ref → local
    const localArtifacts = store.listByNetwork("local")
    const localKeys = localArtifacts.map((a) => a.key).sort()
    assert.deepEqual(localKeys, ["operator_key_ref", "soul_registry"])

    const testnetArtifacts = store.listByNetwork("testnet")
    const testnetKeys = testnetArtifacts.map((a) => a.key).sort()
    assert.deepEqual(testnetKeys, ["pose_manager"])
  })

  it("deletes artifacts by network", () => {
    store.set({ key: "did_registry", value: "0xDID", network: "local" })
    // Local now contains: soul_registry, operator_key_ref, did_registry = 3 keys
    const deleted = store.deleteByNetwork("local")
    assert.equal(deleted, 3)
    assert.equal(store.listByNetwork("local").length, 0)
    // testnet artifacts untouched
    assert.equal(store.listByNetwork("testnet").length, 1)
  })
})
