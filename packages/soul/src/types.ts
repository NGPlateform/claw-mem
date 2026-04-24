// Port interfaces for @chainofclaw/soul.
//
// The package does not depend on claw-mem's SQLite stores; BackupManager and
// the backup CLI commands accept small port objects from the caller. The
// umbrella @chainofclaw/claw-mem package injects its SQLite-backed
// ArchiveStore as the BackupArchiveRepository.

// ──────────────────────────────────────────────────────────────────────────
// Logger — intentionally duplicated from @chainofclaw/node to avoid a
// soul→node dependency (soul never imports node code at runtime).
// ──────────────────────────────────────────────────────────────────────────

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
  debug?(msg: string): void
}

// ──────────────────────────────────────────────────────────────────────────
// BackupArchive record — shape mirrors claw-mem's SQLite archive-store.
// ──────────────────────────────────────────────────────────────────────────

export type BackupType = "full" | "incremental"

export interface BackupArchive {
  id: number
  agentId: string
  manifestCid: string
  backupType: BackupType
  fileCount: number
  totalBytes: number
  dataMerkleRoot: string
  txHash: string | null
  anchoredAt: string | null
  anchoredAtEpoch: number | null
  semanticSnapshotIncluded: boolean
  parentCid: string | null
  createdAt: string
  createdAtEpoch: number
}

export interface BackupArchiveInput {
  agentId: string
  manifestCid: string
  backupType: BackupType
  fileCount: number
  totalBytes: number
  dataMerkleRoot: string
  txHash?: string | null
  anchoredAt?: string | null
  semanticSnapshotIncluded?: boolean
  parentCid?: string | null
}

export interface BackupArchivePruneOptions {
  /** Rows with createdAtEpoch strictly less than this are eligible for deletion. */
  cutoffEpoch: number
  /** Per-agent retention floor — always keep at least this many most-recent rows. */
  keepLatest: number
  /** If set, only rows for this agent are considered. */
  agent?: string
  /** When true, return candidates without deleting. */
  dryRun?: boolean
}

export interface BackupArchivePruneCandidate {
  id: number
  agentId: string
  manifestCid: string
  createdAt: string
}

export interface BackupArchivePruneResult {
  candidates: BackupArchivePruneCandidate[]
  deleted: number
}

/**
 * Port for the archive index that records each successful backup. The umbrella
 * claw-mem package wires this to its SQLite ArchiveStore; standalone coc-soul
 * users may plumb in a no-op or in-memory implementation.
 */
export interface BackupArchiveRepository {
  insert(input: BackupArchiveInput): BackupArchive
  getByCid(manifestCid: string): BackupArchive | null
  listByAgent(agentId: string, limit?: number): BackupArchive[]
  listAll(limit?: number): BackupArchive[]
  getLatestByAgent(agentId: string): BackupArchive | null
  countIncrementalChain(agentId: string, fromCid: string): number
  /** Delete old archives per the retention policy. Soul's `backup prune` CLI delegates here. */
  prune(opts: BackupArchivePruneOptions): BackupArchivePruneResult
}
