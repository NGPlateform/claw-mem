import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { verifyManifest } from "../../src/recovery/manifest-verifier.ts"
import { buildManifest } from "../../src/backup/manifest-builder.ts"
import { cidToBytes32 } from "../../src/backup/anchor.ts"
import type { SnapshotManifest } from "../../src/backup-types.ts"

const AGENT_ID = "0x" + "ab".repeat(32)

const noopLogger = { info() {}, warn() {}, error() {} }

function fakeIpfs(manifests: Map<string, SnapshotManifest>) {
  return {
    async catManifest(cid: string) {
      const m = manifests.get(cid)
      if (!m) throw new Error(`Missing manifest ${cid}`)
      return structuredClone(m)
    },
  }
}

describe("verifyManifest", () => {
  it("returns ok=true when manifest roots are valid and anchor matches on-chain", async () => {
    const baseEntry = {
      cid: "bafyfile1",
      hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      sizeBytes: 5,
      encrypted: false,
      category: "identity" as const,
    }
    const m = buildManifest(AGENT_ID, { "IDENTITY.md": baseEntry }, null)
    const manifests = new Map([["bafylatest", m]])
    const ipfs = fakeIpfs(manifests)
    const soul = {
      async getLatestBackup() {
        return {
          manifestCid: cidToBytes32("bafylatest"),
          dataMerkleRoot: m.merkleRoot,
          anchoredAt: 1,
          fileCount: 1,
          totalBytes: 5,
          backupType: 0,
          parentManifestCid: "0x" + "00".repeat(32),
        }
      },
    }

    const result = await verifyManifest("bafylatest", ipfs as any, noopLogger, soul as any)
    assert.equal(result.ok, true)
    assert.equal(result.chainResolved, true)
    assert.equal(result.chainLength, 1)
    assert.equal(result.manifestRootsValid, true)
    assert.equal(result.fileCount, 1)
    assert.equal(result.anchorCheckAttempted, true)
    assert.equal(result.anchorCheckPassed, true)
    assert.equal(result.anchorCheckReason, "verified")
  })

  it("returns ok=false with anchor_root_mismatch when on-chain root differs", async () => {
    const baseEntry = {
      cid: "bafyfile1",
      hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      sizeBytes: 5,
      encrypted: false,
      category: "identity" as const,
    }
    const m = buildManifest(AGENT_ID, { "IDENTITY.md": baseEntry }, null)
    const manifests = new Map([["bafylatest", m]])
    const soul = {
      async getLatestBackup() {
        return {
          manifestCid: cidToBytes32("bafylatest"),
          dataMerkleRoot: "0x" + "ff".repeat(32),
          anchoredAt: 1,
          fileCount: 1,
          totalBytes: 5,
          backupType: 0,
          parentManifestCid: "0x" + "00".repeat(32),
        }
      },
    }

    const result = await verifyManifest("bafylatest", fakeIpfs(manifests) as any, noopLogger, soul as any)
    assert.equal(result.ok, false)
    assert.equal(result.reason, "anchor_root_mismatch")
    assert.equal(result.anchorCheckAttempted, true)
    assert.equal(result.anchorCheckPassed, false)
  })

  it("returns ok=false when manifest's merkle root has been tampered with", async () => {
    const baseEntry = {
      cid: "bafyfile1",
      hash: "aaa",
      sizeBytes: 5,
      encrypted: false,
      category: "identity" as const,
    }
    const m = buildManifest(AGENT_ID, { "IDENTITY.md": baseEntry }, null)
    // Mutate the stored merkleRoot so it no longer matches the recomputed one.
    const tampered = { ...m, merkleRoot: "0x" + "ff".repeat(32) }
    const manifests = new Map([["bafytampered", tampered]])

    const result = await verifyManifest("bafytampered", fakeIpfs(manifests) as any, noopLogger)
    assert.equal(result.ok, false)
    assert.equal(result.manifestRootsValid, false)
    assert.equal(result.reason, "merkle_root_mismatch")
  })

  it("returns chain_resolve_failed when manifest CID is unreachable", async () => {
    const ipfs = {
      async catManifest() {
        throw new Error("manifest not found")
      },
    }
    const result = await verifyManifest("bafyDOESNOTEXIST", ipfs as any, noopLogger)
    assert.equal(result.ok, false)
    assert.equal(result.chainResolved, false)
    assert(result.reason?.startsWith("chain_resolve_failed:"))
  })

  it("returns ok=true with no_soul_client when invoked without on-chain client", async () => {
    const baseEntry = {
      cid: "bafyfile1",
      hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      sizeBytes: 5,
      encrypted: false,
      category: "identity" as const,
    }
    const m = buildManifest(AGENT_ID, { "IDENTITY.md": baseEntry }, null)
    const manifests = new Map([["bafylatest", m]])

    const result = await verifyManifest("bafylatest", fakeIpfs(manifests) as any, noopLogger)
    assert.equal(result.ok, true)
    assert.equal(result.anchorCheckAttempted, false)
    assert.equal(result.anchorCheckReason, "no_soul_client")
  })
})
