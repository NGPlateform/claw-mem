import { describe, it} from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { executeResurrectionFlow } from "../../src/services/carrier/resurrection-flow.ts"
import type { ResurrectionContext } from "../../src/services/carrier/resurrection-flow.ts"

const AGENT_ID = "0x" + "aa".repeat(32)
const CARRIER_ID = "0x" + "bb".repeat(32)
const REQUEST_ID = "0x" + "cc".repeat(32)
const MANIFEST_CID = "QmTestManifestCid12345678901234567890"
// keccak256(toUtf8Bytes(MANIFEST_CID))
const MANIFEST_CID_HASH = "0x6540fe83ead4eb480a429c4158c6ce325488750e525c376572636727c0f1a696"

const fakeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

function createFakeSoul(opts: {
  isOffline: boolean
  confirmFails?: boolean
  canComplete?: boolean
  requestExists?: boolean
}) {
  const calls: string[] = []
  return {
    _calls: calls,
    isOffline: async () => opts.isOffline,
    getResurrectionRequest: async (requestId: string) => ({
      requestId,
      agentId: AGENT_ID,
      carrierId: CARRIER_ID,
      initiator: "0x" + "11".repeat(20),
      initiatedAt: 1000,
      approvalCount: 2,
      guardianSnapshot: 3,
      executed: false,
      carrierConfirmed: false,
      trigger: "guardian-vote" as const,
    }),
    getResurrectionReadiness: async () => {
      calls.push("getResurrectionReadiness")
      return {
        exists: opts.requestExists !== false,
        trigger: "guardian-vote" as const,
        approvalCount: 2,
        approvalThreshold: 2,
        carrierConfirmed: true,
        offlineNow: true,
        readyAt: 1000,
        canComplete: opts.canComplete !== false,
      }
    },
    confirmCarrier: async () => {
      calls.push("confirmCarrier")
      if (opts.confirmFails) throw new Error("confirm rejected")
      return "0xtx"
    },
    completeResurrection: async () => {
      calls.push("completeResurrection")
      return "0xtx"
    },
    heartbeat: async () => {
      calls.push("heartbeat")
      return "0xtx"
    },
    getLatestBackup: async () => ({
      manifestCid: MANIFEST_CID_HASH,
      dataMerkleRoot: "0x" + "00".repeat(32),
      anchoredAt: 1000,
      fileCount: 0,
      totalBytes: 0,
      backupType: 0,
      parentManifestCid: "0x" + "00".repeat(32),
    }),
    getSoul: async () => ({
      agentId: AGENT_ID,
      owner: "0x" + "11".repeat(20),
      identityCid: "0x" + "22".repeat(32),
      latestSnapshotCid: "0x" + "33".repeat(32),
      registeredAt: 1000,
      lastBackupAt: 2000,
      backupCount: 1,
      version: 1,
      active: true,
    }),
    getResurrectionConfig: async () => ({
      resurrectionKeyHash: "0x" + "44".repeat(32),
      maxOfflineDuration: 86400,
      lastHeartbeat: 1000,
      configured: true,
    }),
  } as any
}

function createFakeIpfs() {
  return {
    catManifest: async () => ({
      version: 1,
      agentId: AGENT_ID,
      timestamp: "2026-04-05T00:00:00Z",
      parentCid: null,
      files: {},
      merkleRoot: "0x" + "00".repeat(32),
      totalBytes: 0,
      fileCount: 0,
    }),
    add: async () => "QmTest",
    cat: async () => new Uint8Array(),
    mfsMkdir: async () => {},
    mfsRead: async () => { throw new Error("not found") },
    mfsWrite: async () => {},
    mfsRm: async () => {},
    mfsCp: async () => {},
    ping: async () => true,
  } as any
}

function createFakeCidResolver() {
  return {
    resolve: async () => MANIFEST_CID,
    register: async () => {},
  }
}

function baseCtx(overrides: Partial<ResurrectionContext> & { soul: any }): ResurrectionContext {
  return {
    requestId: REQUEST_ID,
    agentId: AGENT_ID,
    carrierId: CARRIER_ID,
    ipfs: createFakeIpfs(),
    cidResolver: createFakeCidResolver(),
    privateKeyOrPassword: "testkey",
    isPassword: false,
    targetDir: "/tmp/test-resurrect",
    spawnConfig: {
      dataDir: "/tmp/test-resurrect",
      agentId: AGENT_ID,
      entryScript: "index.ts",
    },
    logger: fakeLogger,
    readinessPollMs: 10,
    readinessTimeoutMs: 100,
    ...overrides,
  }
}

describe("resurrection-flow (carrier role model)", () => {
  it("aborts when agent is not offline", async () => {
    const result = await executeResurrectionFlow(
      baseCtx({ soul: createFakeSoul({ isOffline: false }) }),
    )
    assert.equal(result.state, "failed")
    assert.ok((result.error ?? "").includes("not offline"))
  })

  it("fails when carrier confirmation is rejected", async () => {
    const result = await executeResurrectionFlow(
      baseCtx({ soul: createFakeSoul({ isOffline: true, confirmFails: true }) }),
    )
    assert.equal(result.state, "failed")
    assert.ok((result.error ?? "").includes("confirm rejected"))
  })

  it("times out when readiness never satisfied", async () => {
    const result = await executeResurrectionFlow(
      baseCtx({
        soul: createFakeSoul({ isOffline: true, canComplete: false }),
        readinessTimeoutMs: 80,
        readinessPollMs: 20,
      }),
    )
    assert.equal(result.state, "failed")
    assert.ok((result.error ?? "").includes("timed out"))
  })

  it("success path: confirm → waitReady → restore → spawn → health → complete → heartbeat", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "coc-resurrect-success-"))
    await mkdir(join(targetDir, ".coc-backup"), { recursive: true })

    const soul = createFakeSoul({ isOffline: true })
    let spawnCalled = false
    let healthCalled = false

    const result = await executeResurrectionFlow({
      ...baseCtx({ soul }),
      targetDir,
      spawnConfig: { dataDir: targetDir, agentId: AGENT_ID, entryScript: "index.ts" },
      overrides: {
        spawnAgent: () => {
          spawnCalled = true
          return { pid: 99999, process: {} }
        },
        waitForHealthy: async () => {
          healthCalled = true
          return true
        },
        stopAgent: () => {},
      },
    })

    // Verify success
    assert.equal(result.state, "resurrection_complete")
    assert.equal(result.error, null)
    assert.equal(result.requestId, REQUEST_ID)
    assert.equal(result.agentPid, 99999)

    // Verify carrier-only call chain (no initiateGuardianResurrection or approveResurrection)
    assert.deepEqual(soul._calls, [
      "confirmCarrier",
      "getResurrectionReadiness",
      "completeResurrection",
      "heartbeat",
    ])

    assert.equal(spawnCalled, true)
    assert.equal(healthCalled, true)

    await rm(targetDir, { recursive: true, force: true })
  })

  it("stops agent when health check fails", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "coc-resurrect-health-fail-"))
    await mkdir(join(targetDir, ".coc-backup"), { recursive: true })

    let stopCalled = false

    const result = await executeResurrectionFlow({
      ...baseCtx({ soul: createFakeSoul({ isOffline: true }) }),
      targetDir,
      spawnConfig: { dataDir: targetDir, agentId: AGENT_ID, entryScript: "index.ts" },
      overrides: {
        spawnAgent: () => ({ pid: 88888, process: {} }),
        waitForHealthy: async () => false,
        stopAgent: (pid) => {
          stopCalled = true
          assert.equal(pid, 88888)
        },
      },
    })

    assert.equal(result.state, "failed")
    assert.ok((result.error ?? "").includes("health check"))
    assert.equal(result.agentPid, null)
    assert.equal(stopCalled, true)

    await rm(targetDir, { recursive: true, force: true })
  })

  it("returns correct identifiers on all outcomes", async () => {
    const result = await executeResurrectionFlow(
      baseCtx({ soul: createFakeSoul({ isOffline: false }) }),
    )
    assert.equal(result.agentId, AGENT_ID)
    assert.equal(result.carrierId, CARRIER_ID)
    assert.equal(result.requestId, REQUEST_ID)
  })

  it("aborts when shutdownSignal fires during readiness wait", async () => {
    const abort = new AbortController()

    // canComplete always false → would normally timeout, but we abort first
    const soul = createFakeSoul({ isOffline: true, canComplete: false })

    // Abort after 50ms
    setTimeout(() => abort.abort(), 50)

    const result = await executeResurrectionFlow({
      ...baseCtx({ soul }),
      shutdownSignal: abort.signal,
      readinessPollMs: 10,
      readinessTimeoutMs: 60_000, // long timeout, should be interrupted
    })

    assert.equal(result.state, "failed")
    assert.ok((result.error ?? "").includes("shutting down"))
  })

  it("distinguishes shutdown from health failure during health check", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "coc-resurrect-shutdown-health-"))
    await mkdir(join(targetDir, ".coc-backup"), { recursive: true })

    const abort = new AbortController()
    let stopReason = ""

    const result = await executeResurrectionFlow({
      ...baseCtx({ soul: createFakeSoul({ isOffline: true }) }),
      targetDir,
      spawnConfig: { dataDir: targetDir, agentId: AGENT_ID, entryScript: "index.ts" },
      shutdownSignal: abort.signal,
      overrides: {
        spawnAgent: () => ({ pid: 77777, process: {} }),
        waitForHealthy: async (_config, _logger, signal) => {
          // Simulate shutdown arriving during health check
          abort.abort()
          return false
        },
        stopAgent: () => { stopReason = "stopped" },
      },
    })

    assert.equal(result.state, "failed")
    assert.ok((result.error ?? "").includes("shutting down"))
    assert.ok((result.error ?? "").includes("health check"))
    assert.equal(stopReason, "stopped")

    await rm(targetDir, { recursive: true, force: true })
  })

  it("aborts when shutdownSignal fires before download", async () => {
    const abort = new AbortController()
    abort.abort() // already aborted

    const result = await executeResurrectionFlow({
      ...baseCtx({ soul: createFakeSoul({ isOffline: true }) }),
      shutdownSignal: abort.signal,
    })

    assert.equal(result.state, "failed")
    assert.ok((result.error ?? "").includes("shutting down"))
  })
})
