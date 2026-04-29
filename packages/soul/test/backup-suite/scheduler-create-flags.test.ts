import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { BackupScheduler } from "../../src/backup/scheduler.ts"
import { cidToBytes32 } from "../../src/backup/anchor.ts"
import type { CocBackupConfig, SnapshotManifest } from "../../src/backup-types.ts"

const AGENT_ID = "0x" + "ab".repeat(32)

function createConfig(dataDir: string): CocBackupConfig {
  return {
    enabled: true,
    rpcUrl: "http://127.0.0.1:18780",
    ipfsUrl: "http://127.0.0.1:18790",
    contractAddress: "0x1234567890123456789012345678901234567890",
    privateKey: "0x" + "11".repeat(32),
    dataDir,
    autoBackupEnabled: true,
    autoBackupIntervalMs: 3600000,
    encryptMemory: false,
    encryptionPassword: undefined,
    maxIncrementalChain: 10,
    backupOnSessionEnd: true,
    semanticSnapshot: {
      enabled: false,
      tokenBudget: 0,
      maxObservations: 0,
      maxSummaries: 0,
      claudeMemDbPath: "",
    },
    carrier: {
      enabled: false,
      workDir: "/tmp/coc-resurrections",
      watchedAgents: [],
      pendingRequestIds: [],
      pollIntervalMs: 60_000,
      readinessTimeoutMs: 86_400_000,
      readinessPollMs: 30_000,
    },
    categories: {
      identity: true,
      config: true,
      memory: true,
      chat: true,
      workspace: true,
      database: true,
    },
  }
}

class TrackingIpfs {
  counter = 0
  uploads: Array<{ kind: "file" | "manifest"; bytes?: number }> = []
  files = new Map<string, Uint8Array>()
  manifests = new Map<string, SnapshotManifest>()

  async add(data: Uint8Array) {
    const cid = `bafyfile${++this.counter}`
    this.files.set(cid, new Uint8Array(data))
    this.uploads.push({ kind: "file", bytes: data.byteLength })
    return cid
  }

  async addManifest(manifest: SnapshotManifest) {
    const cid = `bafymanifest${++this.counter}`
    this.manifests.set(cid, structuredClone(manifest))
    this.uploads.push({ kind: "manifest" })
    return cid
  }

  async cat(cid: string) {
    const data = this.files.get(cid)
    if (!data) throw new Error(`Missing file ${cid}`)
    return new Uint8Array(data)
  }

  async catManifest(cid: string) {
    const m = this.manifests.get(cid)
    if (!m) throw new Error(`Missing manifest ${cid}`)
    return structuredClone(m)
  }

  async mfsMkdir() {}
  async mfsCp() {}
}

class FakeSoul {
  anchorCalls = 0
  latestBackup = {
    manifestCid: cidToBytes32("bootstrap"),
    dataMerkleRoot: "0x" + "00".repeat(32),
    anchoredAt: 0,
    fileCount: 0,
    totalBytes: 0,
    backupType: 0,
    parentManifestCid: "0x" + "00".repeat(64),
  }

  async getAgentIdForOwner() { return AGENT_ID }

  async anchorBackup(_a: string, manifestCid: string, dataMerkleRoot: string, fileCount: number, totalBytes: number, backupType: 0 | 1, parentManifestCid: string) {
    this.anchorCalls++
    this.latestBackup = {
      manifestCid,
      dataMerkleRoot,
      anchoredAt: this.latestBackup.anchoredAt + 1,
      fileCount,
      totalBytes,
      backupType,
      parentManifestCid,
    }
    return `0xtx${this.anchorCalls}`
  }

  async getLatestBackup() { return this.latestBackup }
  async getResurrectionConfig() {
    return { resurrectionKeyHash: "0x" + "00".repeat(32), maxOfflineDuration: 0, lastHeartbeat: 0, configured: false }
  }
  async heartbeat() { return "0xheartbeat" }
}

const noopLogger = { info() {}, warn() {}, error() {} }

describe("scheduler create flags", () => {
  it("--dry-run reports a changeset and uploads nothing on-chain or to IPFS", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "coc-soul-dryrun-"))
    await writeFile(join(dataDir, "IDENTITY.md"), "v1")
    await writeFile(join(dataDir, "auth.json"), '{"k":"v"}')

    const ipfs = new TrackingIpfs()
    const soul = new FakeSoul()
    const scheduler = new BackupScheduler(createConfig(dataDir), soul as any, ipfs as any, noopLogger)

    const r = await scheduler.runBackup({ dryRun: true })
    assert.equal(r.status, "dry_run")
    assert.equal(r.backup, null)
    assert.ok(r.changeset)
    assert.equal(r.changeset!.added, 2)
    assert.equal(r.changeset!.modified, 0)
    assert.equal(r.changeset!.isFullBackup, true)
    assert.equal(ipfs.uploads.length, 0, "dry-run must not upload to IPFS")
    assert.equal(soul.anchorCalls, 0, "dry-run must not anchor on-chain")
  })

  it("categoryOverride drops files in the disabled category for that run only", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "coc-soul-catoverride-"))
    await writeFile(join(dataDir, "IDENTITY.md"), "v1")
    await writeFile(join(dataDir, "auth.json"), '{"k":"v"}')

    const ipfs = new TrackingIpfs()
    const soul = new FakeSoul()
    const config = createConfig(dataDir)
    const scheduler = new BackupScheduler(config, soul as any, ipfs as any, noopLogger)

    // Override: only config category. IDENTITY.md (category=identity) must be dropped.
    const r = await scheduler.runBackup({
      dryRun: true,
      categoryOverride: { identity: false, memory: false, chat: false, workspace: false, database: false },
    })
    assert.equal(r.status, "dry_run")
    assert.equal(r.changeset!.added, 1, "only auth.json (config) should remain")

    // Configuration should be unmutated — categories.identity is still true.
    assert.equal(config.categories.identity, true, "in-memory override must not persist into config object")
  })

  it("dry-run combined with categoryOverride yields a per-category byte breakdown", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "coc-soul-bycat-"))
    await writeFile(join(dataDir, "IDENTITY.md"), "abcdef")
    await writeFile(join(dataDir, "auth.json"), "12345")

    const ipfs = new TrackingIpfs()
    const soul = new FakeSoul()
    const scheduler = new BackupScheduler(createConfig(dataDir), soul as any, ipfs as any, noopLogger)

    const r = await scheduler.runBackup({ dryRun: true })
    assert.equal(r.status, "dry_run")
    const cs = r.changeset!
    assert.equal(cs.byCategory.identity?.added, 1)
    assert.equal(cs.byCategory.identity?.bytes, 6)
    assert.equal(cs.byCategory.config?.added, 1)
    assert.equal(cs.byCategory.config?.bytes, 5)
  })
})
