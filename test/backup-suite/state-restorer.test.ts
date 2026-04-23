import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { restoreFromManifestCid } from "../../src/services/recovery/state-restorer.ts"
import { buildManifest } from "../../src/services/backup/manifest-builder.ts"
import { cidToBytes32 } from "../../src/services/backup/anchor.ts"
import type { SnapshotManifest } from "../../src/services/backup-types.ts"

const AGENT_ID = "0x" + "ab".repeat(32)

describe("state restorer", () => {
  it("reports skipped anchor verification when restoring a historical manifest", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "coc-backup-restore-history-"))
    const fileBytes = new TextEncoder().encode("hello")
    const baseEntry = {
      cid: "bafyfile1",
      hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      sizeBytes: fileBytes.length,
      encrypted: false,
      category: "identity" as const,
    }

    const fullManifest = buildManifest(AGENT_ID, { "IDENTITY.md": baseEntry }, null)
    const latestManifest = buildManifest(AGENT_ID, { "IDENTITY.md": baseEntry }, "bafyfull")

    const manifests = new Map<string, SnapshotManifest>([
      ["bafyfull", fullManifest],
      ["bafylatest", latestManifest],
    ])
    const files = new Map<string, Uint8Array>([["bafyfile1", fileBytes]])

    const ipfs = {
      async catManifest(cid: string) {
        const manifest = manifests.get(cid)
        if (!manifest) throw new Error(`Missing manifest ${cid}`)
        return structuredClone(manifest)
      },
      async cat(cid: string) {
        const file = files.get(cid)
        if (!file) throw new Error(`Missing file ${cid}`)
        return new Uint8Array(file)
      },
    }

    const soul = {
      async getLatestBackup() {
        return {
          manifestCid: cidToBytes32("bafylatest"),
          dataMerkleRoot: latestManifest.merkleRoot,
          anchoredAt: 123,
          fileCount: 1,
          totalBytes: fileBytes.length,
          backupType: 1,
          parentManifestCid: cidToBytes32("bafyfull"),
        }
      },
    }

    const result = await restoreFromManifestCid(
      "bafyfull",
      targetDir,
      ipfs as any,
      "0x" + "11".repeat(32),
      false,
      { info() {}, warn() {}, error() {} },
      soul as any,
    )

    assert.equal(result.anchorCheckAttempted, true)
    assert.equal(result.anchorCheckPassed, false)
    assert.equal(result.anchorCheckReason, "manifest_not_latest_on_chain")
  })

  it("fails early when encrypted files exist but no decryption material is provided", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "coc-backup-restore-encrypted-"))
    const encryptedManifest = buildManifest(AGENT_ID, {
      "auth.json": {
        cid: "bafysecret",
        hash: "abcd",
        sizeBytes: 10,
        encrypted: true,
        category: "config",
      },
    }, null)

    const ipfs = {
      async catManifest() {
        return structuredClone(encryptedManifest)
      },
      async cat() {
        return new Uint8Array([1, 2, 3, 4])
      },
    }

    await assert.rejects(
      restoreFromManifestCid(
        "bafysecretmanifest",
        targetDir,
        ipfs as any,
        "",
        false,
        { info() {}, warn() {}, error() {} },
      ),
      /encrypted backup requires a decryption password or private key/,
    )
  })
})
