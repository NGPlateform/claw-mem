import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { ClawMemConfigSchema, type StorageConfig } from "../src/config.ts"
import { Database } from "../src/db/database.ts"
import { NodeStore } from "../src/db/node-store.ts"
import { NodeManager } from "../src/services/node-manager.ts"
import { ProcessManager } from "../src/services/process-manager.ts"
import { QuotaExceededError, StorageQuotaManager } from "../src/services/storage-quota-manager.ts"
import type { PluginLogger } from "../src/types.ts"

function silentLogger(): PluginLogger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}

function makeConfig(overrides: Partial<StorageConfig>): StorageConfig {
  // Schema rejects advertisedBytes < 256 MiB; for unit tests we bypass that
  // by going through the type only — quota manager doesn't validate the field.
  return {
    quotaBytes: 1024,
    advertisedBytes: 268_435_456,
    reservedBytes: 0,
    enforceQuota: true,
    reserveFile: ".quota.reserved",
    ...overrides,
  }
}

describe("StorageQuotaManager — reservation", () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "claw-quota-test-"))
  })
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it("ensureReserved skips when reservedBytes=0", async () => {
    const m = new StorageQuotaManager({
      config: makeConfig({ reservedBytes: 0 }),
      logger: silentLogger(),
      dataDir,
    })
    const result = await m.ensureReserved()
    assert.equal(result.method, "skipped")
    assert.equal(result.reserved, 0)
  })

  it("ensureReserved creates a placeholder of the expected size", async () => {
    const target = 4096
    const m = new StorageQuotaManager({
      config: makeConfig({ reservedBytes: target }),
      logger: silentLogger(),
      dataDir,
    })
    const result = await m.ensureReserved()
    assert.ok(["fallocate", "truncate(1)", "fs.truncate"].includes(result.method))
    const st = await stat(result.path)
    assert.equal(st.size, target)
  })

  it("ensureReserved is idempotent (does not shrink existing reservation)", async () => {
    const m = new StorageQuotaManager({
      config: makeConfig({ reservedBytes: 4096 }),
      logger: silentLogger(),
      dataDir,
    })
    await m.ensureReserved()
    const second = await m.ensureReserved()
    assert.equal(second.method, "existing")
    assert.equal(second.reserved, 4096)
  })

  it("releaseReserved removes the placeholder", async () => {
    const m = new StorageQuotaManager({
      config: makeConfig({ reservedBytes: 4096 }),
      logger: silentLogger(),
      dataDir,
    })
    await m.ensureReserved()
    assert.equal(await m.releaseReserved(), true)
    assert.equal(await m.releaseReserved(), false)  // already gone
  })
})

describe("StorageQuotaManager — usage and quota", () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "claw-quota-test-"))
  })
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it("getUsage walks subdirectories", async () => {
    await mkdir(join(dataDir, "sub"), { recursive: true })
    await writeFile(join(dataDir, "a.bin"), Buffer.alloc(100))
    await writeFile(join(dataDir, "sub", "b.bin"), Buffer.alloc(200))

    const m = new StorageQuotaManager({
      config: makeConfig({ quotaBytes: 10_000, reservedBytes: 0 }),
      logger: silentLogger(),
      dataDir,
    })
    assert.equal(await m.getUsage(), 300)
  })

  it("getUsage excludes the reservation file from the total", async () => {
    await writeFile(join(dataDir, "real-data.bin"), Buffer.alloc(50))
    const m = new StorageQuotaManager({
      config: makeConfig({ reservedBytes: 4096 }),
      logger: silentLogger(),
      dataDir,
    })
    await m.ensureReserved()
    // Should NOT include the 4096-byte reservation in the usage
    assert.equal(await m.getUsage(), 50)
  })

  it("assertCanAdd allows additions within quota", async () => {
    await writeFile(join(dataDir, "x.bin"), Buffer.alloc(400))
    const m = new StorageQuotaManager({
      config: makeConfig({ quotaBytes: 1000 }),
      logger: silentLogger(),
      dataDir,
    })
    await m.assertCanAdd(400)  // 400 + 400 = 800 ≤ 1000 ✓
  })

  it("assertCanAdd throws QuotaExceededError when over quota", async () => {
    await writeFile(join(dataDir, "x.bin"), Buffer.alloc(900))
    const m = new StorageQuotaManager({
      config: makeConfig({ quotaBytes: 1000 }),
      logger: silentLogger(),
      dataDir,
    })
    await assert.rejects(
      m.assertCanAdd(200),  // 900 + 200 = 1100 > 1000
      QuotaExceededError,
    )
  })

  it("assertCanAdd is bypassed when enforceQuota=false", async () => {
    await writeFile(join(dataDir, "x.bin"), Buffer.alloc(900))
    const m = new StorageQuotaManager({
      config: makeConfig({ quotaBytes: 1000, enforceQuota: false }),
      logger: silentLogger(),
      dataDir,
    })
    await m.assertCanAdd(5000)  // would normally fail
  })

  it("invalidateCache forces fresh disk scan", async () => {
    await writeFile(join(dataDir, "x.bin"), Buffer.alloc(100))
    const m = new StorageQuotaManager({
      config: makeConfig({ quotaBytes: 10_000, reservedBytes: 0 }),
      logger: silentLogger(),
      dataDir,
    })
    assert.equal(await m.getUsage(), 100)

    // Add a file but don't invalidate yet — cache still says 100.
    await writeFile(join(dataDir, "y.bin"), Buffer.alloc(100))
    assert.equal(await m.getUsage(), 100)

    m.invalidateCache()
    assert.equal(await m.getUsage(), 200)
  })
})

describe("NodeManager + StorageQuotaManager integration", () => {
  let dataDir: string
  let db: Database
  let manager: NodeManager
  let quota: StorageQuotaManager

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "claw-nm-quota-test-"))
    db = new Database(join(dataDir, "claw-mem.db"))
    await db.open()

    const cfg = ClawMemConfigSchema.parse({
      // Narrow quota so we can trip it intentionally; reserve nothing.
      storage: { quotaBytes: 100, reservedBytes: 0, advertisedBytes: 268_435_456, enforceQuota: true, reserveFile: ".quota.reserved" },
    })
    quota = new StorageQuotaManager({ config: cfg.storage, logger: silentLogger(), dataDir })
    manager = new NodeManager({
      nodeStore: new NodeStore(db),
      processManager: new ProcessManager(silentLogger()),
      config: cfg,
      logger: silentLogger(),
      baseDir: dataDir,
      storageQuotaManager: quota,
    })
    await manager.init()
  })

  afterEach(async () => {
    db.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  it("install rejects when local quota already exceeded", async () => {
    // Fill the dir past the (tiny) quota
    await writeFile(join(dataDir, "filler.bin"), Buffer.alloc(200))
    quota.invalidateCache()

    await assert.rejects(
      manager.install({ type: "dev", network: "local", name: "should-fail" }),
      QuotaExceededError,
    )
  })

  it("install rejects when advertisedBytes < 256 MiB minimum", async () => {
    await assert.rejects(
      manager.install({
        type: "dev",
        network: "local",
        name: "tiny-storage",
        advertisedBytes: 1024,
      }),
      /below the COC P2P minimum/,
    )
  })

  it("install writes advertisedStorageBytes=256MiB into node-config.json", async () => {
    // The suite-level quota is intentionally tiny (100 B) for the rejection
    // tests; for this happy-path test rebuild a manager with the quota off.
    const cfg = ClawMemConfigSchema.parse({
      storage: {
        quotaBytes: 100, reservedBytes: 0, advertisedBytes: 268_435_456,
        enforceQuota: false, reserveFile: ".quota.reserved",
      },
    })
    const happyDir = await mkdtemp(join(tmpdir(), "claw-nm-happy-"))
    const happyDb = new Database(join(happyDir, "claw-mem.db"))
    await happyDb.open()
    const happyQuota = new StorageQuotaManager({ config: cfg.storage, logger: silentLogger(), dataDir: happyDir })
    const happyManager = new NodeManager({
      nodeStore: new NodeStore(happyDb),
      processManager: new ProcessManager(silentLogger()),
      config: cfg,
      logger: silentLogger(),
      baseDir: happyDir,
      storageQuotaManager: happyQuota,
    })
    await happyManager.init()

    try {
      const result = await happyManager.install({ type: "dev", network: "local", name: "ok-node" })
      assert.equal(result.advertisedBytes, 268_435_456)
      const nodeCfg = await happyManager.getNodeConfig("ok-node")
      assert.equal(nodeCfg.advertisedStorageBytes, 268_435_456)
    } finally {
      happyDb.close()
      await rm(happyDir, { recursive: true, force: true })
    }
  })
})
