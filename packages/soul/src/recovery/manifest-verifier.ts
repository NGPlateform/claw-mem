// Manifest verifier: lightweight integrity check for an existing backup.
// Walks the parent-CID chain, recomputes each manifest's Merkle root, and
// (when a SoulClient is available) confirms the latest manifest's root
// matches the on-chain anchor. Does NOT decrypt/re-hash file blobs — that
// happens during restore. Operators run this to answer "is the backup
// still recoverable?" without needing the decryption key.

import type { SoulClient } from "../soul-client.ts"
import type { IpfsClient } from "../ipfs-client.ts"
import type { SnapshotManifest } from "../backup-types.ts"
import { resolveChainFromCid } from "./chain-resolver.ts"
import {
  verifyManifestMerkleRoot,
  verifyOnChainAnchor,
} from "./integrity-checker.ts"
import { cidToBytes32 } from "../backup/anchor.ts"

interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface ManifestVerifyResult {
  ok: boolean
  manifestCid: string
  agentId: string | null
  chainResolved: boolean
  chainLength: number
  manifestRootsValid: boolean
  fileCount: number
  totalBytes: number
  anchorCheckAttempted: boolean
  anchorCheckPassed: boolean
  anchorCheckReason: string | null
  reason: string | null
}

function failure(
  manifestCid: string,
  reason: string,
  partial?: Partial<ManifestVerifyResult>,
): ManifestVerifyResult {
  return {
    ok: false,
    manifestCid,
    agentId: null,
    chainResolved: false,
    chainLength: 0,
    manifestRootsValid: false,
    fileCount: 0,
    totalBytes: 0,
    anchorCheckAttempted: false,
    anchorCheckPassed: false,
    anchorCheckReason: null,
    reason,
    ...partial,
  }
}

export async function verifyManifest(
  manifestCid: string,
  ipfs: IpfsClient,
  logger: Logger,
  soul?: SoulClient,
): Promise<ManifestVerifyResult> {
  // 1. Resolve the parent-CID chain.
  let chain: SnapshotManifest[]
  try {
    chain = await resolveChainFromCid(manifestCid, ipfs)
  } catch (error) {
    return failure(manifestCid, `chain_resolve_failed: ${String(error)}`)
  }

  if (chain.length === 0) {
    return failure(manifestCid, "empty_chain")
  }

  // 2. Recompute each manifest's Merkle root.
  let allRootsValid = true
  for (let i = 0; i < chain.length; i++) {
    if (!verifyManifestMerkleRoot(chain[i])) {
      logger.warn(`Manifest ${i} (${i === chain.length - 1 ? "latest" : "ancestor"}) failed Merkle root verification`)
      allRootsValid = false
    }
  }

  const latest = chain[chain.length - 1]
  const baseResult: ManifestVerifyResult = {
    ok: false,
    manifestCid,
    agentId: latest.agentId || null,
    chainResolved: true,
    chainLength: chain.length,
    manifestRootsValid: allRootsValid,
    fileCount: latest.fileCount,
    totalBytes: latest.totalBytes,
    anchorCheckAttempted: false,
    anchorCheckPassed: false,
    anchorCheckReason: null,
    reason: null,
  }

  if (!allRootsValid) {
    return { ...baseResult, reason: "merkle_root_mismatch" }
  }

  // 3. On-chain anchor check (only if SoulClient + agentId available).
  if (!soul) {
    return {
      ...baseResult,
      ok: true,
      anchorCheckReason: "no_soul_client",
    }
  }

  const zeroId = "0x" + "0".repeat(64)
  if (!latest.agentId || latest.agentId === zeroId) {
    return {
      ...baseResult,
      ok: true,
      anchorCheckReason: "missing_manifest_agent_id",
    }
  }

  try {
    const onChainBackup = await soul.getLatestBackup(latest.agentId)
    const manifestCidBytes32 = cidToBytes32(manifestCid)
    if (onChainBackup.manifestCid !== manifestCidBytes32) {
      return {
        ...baseResult,
        ok: true,
        anchorCheckAttempted: true,
        anchorCheckReason: "manifest_not_latest_on_chain",
      }
    }

    const onChainValid = verifyOnChainAnchor(
      latest.merkleRoot,
      onChainBackup.dataMerkleRoot,
    )
    if (!onChainValid) {
      return {
        ...baseResult,
        anchorCheckAttempted: true,
        anchorCheckReason: "anchor_root_mismatch",
        reason: "anchor_root_mismatch",
      }
    }

    return {
      ...baseResult,
      ok: true,
      anchorCheckAttempted: true,
      anchorCheckPassed: true,
      anchorCheckReason: "verified",
    }
  } catch (error) {
    logger.warn(`On-chain anchor check unavailable: ${String(error)}`)
    return {
      ...baseResult,
      ok: true,
      anchorCheckAttempted: true,
      anchorCheckReason: "verification_unavailable",
    }
  }
}
