// Smoke tests for BootstrapManager helpers — does not actually spawn hardhat
// or touch contracts. Full end-to-end is exercised by the e2e script
// described in the plan file.

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { ClawMemConfigSchema } from "../src/config.ts"
import { Database } from "../src/db/database.ts"
import { NodeStore } from "../src/db/node-store.ts"
import { ArchiveStore } from "../src/db/archive-store.ts"
import { ArtifactStore } from "../src/db/artifact-store.ts"
import { NodeManager, ProcessManager, StorageQuotaManager } from "@chainofclaw/node"
import { BackupManager } from "../src/services/backup-manager.ts"
import { BootstrapManager } from "../src/services/bootstrap-manager.ts"
import type { PluginLogger } from "../src/types.ts"

function silentLogger(): PluginLogger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}

interface Harness {
  dataDir: string
  db: Database
  bootstrapManager: BootstrapManager
  artifactStore: ArtifactStore
  nodeManager: NodeManager
}

async function buildHarness(): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), "claw-bootstrap-test-"))
  const db = new Database(join(dataDir, "claw-mem.db"))
  await db.open()
  const config = ClawMemConfigSchema.parse({
    storage: { quotaBytes: 100_000_000, reservedBytes: 0, advertisedBytes: 268_435_456, enforceQuota: false, reserveFile: ".quota.reserved" },
    bootstrap: { mode: "none", hardhatPort: 18545, autoFundEther: "0.1", skipIfReady: true, hardhatNetworkName: "claw-mem-local" },
  })
  const logger = silentLogger()
  const nodeStore = new NodeStore(db)
  const archiveStore = new ArchiveStore(db)
  const artifactStore = new ArtifactStore(db)
  const processManager = new ProcessManager(logger)
  const storageQuotaManager = new StorageQuotaManager({ config: config.storage, logger, dataDir })
  const nodeManager = new NodeManager({
    nodeRegistry: nodeStore, processManager, config, logger, baseDir: dataDir, storageQuotaManager,
  })
  await nodeManager.init()
  const backupManager = new BackupManager({ config: config.backup, archiveStore, logger })
  const bootstrapManager = new BootstrapManager({
    config, nodeManager, processManager, artifactStore, storageQuotaManager,
    backupManager, logger, dataDir,
  })
  return { dataDir, db, bootstrapManager, artifactStore, nodeManager }
}

async function teardown(h: Harness): Promise<void> {
  h.db.close()
  await rm(h.dataDir, { recursive: true, force: true })
}

describe("BootstrapManager.status — empty state", () => {
  let h: Harness
  beforeEach(async () => { h = await buildHarness() })
  afterEach(async () => { await teardown(h) })

  it("reports nothing running on a fresh harness", async () => {
    const status = await h.bootstrapManager.status()
    assert.equal(status.hardhatRunning, false)
    assert.equal(status.hardhatPid, null)
    assert.equal(status.nodeRunning, false)
    assert.equal(status.operatorAddress, null)
    assert.deepEqual(status.contracts, {})
  })

  it("reports recorded contract artifacts", async () => {
    h.artifactStore.set({ key: "pose_manager", value: "0xPOSE", network: "local", chainId: 31337 })
    h.artifactStore.set({ key: "soul_registry", value: "0xSOUL", network: "local", chainId: 31337 })
    const status = await h.bootstrapManager.status()
    assert.equal(status.contracts.pose_manager, "0xPOSE")
    assert.equal(status.contracts.soul_registry, "0xSOUL")
  })
})

describe("BootstrapManager.teardown — cleans artifacts", () => {
  let h: Harness
  beforeEach(async () => { h = await buildHarness() })
  afterEach(async () => { await teardown(h) })

  it("removes local-network artifacts but leaves keys", async () => {
    h.artifactStore.set({ key: "pose_manager", value: "0xPOSE", network: "local", chainId: 31337 })
    h.artifactStore.set({ key: "operator_key_ref", value: "/keys/op.key", network: "local", chainId: 31337 })
    h.artifactStore.set({ key: "pose_manager_testnet", value: "0xPOSEN", network: "testnet", chainId: 11155111 })

    await h.bootstrapManager.teardown()

    // Local network artifacts cleared
    assert.equal(h.artifactStore.listByNetwork("local").length, 0)
    // Other-network artifacts untouched
    assert.equal(h.artifactStore.listByNetwork("testnet").length, 1)
  })
})
