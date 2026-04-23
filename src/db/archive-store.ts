// Archive storage: backup history (manifest CIDs, sizes, anchoring tx)

import type { Database } from "./database.ts"

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

interface RawArchiveRow {
  id: number
  agent_id: string
  manifest_cid: string
  backup_type: number
  file_count: number
  total_bytes: number
  data_merkle_root: string
  tx_hash: string | null
  anchored_at: string | null
  anchored_at_epoch: number | null
  semantic_snapshot_included: number
  parent_cid: string | null
  created_at: string
  created_at_epoch: number
}

export class ArchiveStore {
  private readonly db: Database
  constructor(db: Database) { this.db = db }

  insert(input: BackupArchiveInput): BackupArchive {
    const now = new Date()
    const isoNow = now.toISOString()
    const epochNow = Math.floor(now.getTime() / 1000)
    const typeInt = input.backupType === "incremental" ? 1 : 0
    const anchoredAtEpoch = input.anchoredAt
      ? Math.floor(new Date(input.anchoredAt).getTime() / 1000)
      : null

    this.db.connection
      .prepare(
        `INSERT INTO backup_archives
         (agent_id, manifest_cid, backup_type, file_count, total_bytes,
          data_merkle_root, tx_hash, anchored_at, anchored_at_epoch,
          semantic_snapshot_included, parent_cid, created_at, created_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.agentId,
        input.manifestCid,
        typeInt,
        input.fileCount,
        input.totalBytes,
        input.dataMerkleRoot,
        input.txHash ?? null,
        input.anchoredAt ?? null,
        anchoredAtEpoch,
        input.semanticSnapshotIncluded ? 1 : 0,
        input.parentCid ?? null,
        isoNow,
        epochNow,
      )

    const row = this.getByCid(input.manifestCid)
    if (!row) throw new Error(`Failed to insert archive ${input.manifestCid}`)
    return row
  }

  getByCid(manifestCid: string): BackupArchive | null {
    const row = this.db.connection
      .prepare("SELECT * FROM backup_archives WHERE manifest_cid = ?")
      .get(manifestCid) as unknown as RawArchiveRow | undefined
    return row ? mapRow(row) : null
  }

  listByAgent(agentId: string, limit = 10): BackupArchive[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM backup_archives
         WHERE agent_id = ?
         ORDER BY created_at_epoch DESC, id DESC
         LIMIT ?`,
      )
      .all(agentId, limit) as unknown as RawArchiveRow[]
    return rows.map(mapRow)
  }

  listAll(limit = 50): BackupArchive[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM backup_archives
         ORDER BY created_at_epoch DESC, id DESC
         LIMIT ?`,
      )
      .all(limit) as unknown as RawArchiveRow[]
    return rows.map(mapRow)
  }

  getLatestByAgent(agentId: string): BackupArchive | null {
    const row = this.db.connection
      .prepare(
        `SELECT * FROM backup_archives
         WHERE agent_id = ?
         ORDER BY created_at_epoch DESC, id DESC
         LIMIT 1`,
      )
      .get(agentId) as unknown as RawArchiveRow | undefined
    return row ? mapRow(row) : null
  }

  countIncrementalChain(agentId: string, fromCid: string): number {
    let count = 0
    let cursor: string | null = fromCid
    while (cursor) {
      const row = this.db.connection
        .prepare(
          "SELECT parent_cid, backup_type FROM backup_archives WHERE manifest_cid = ? AND agent_id = ?",
        )
        .get(cursor, agentId) as { parent_cid: string | null; backup_type: number } | undefined
      if (!row) break
      count++
      if (row.backup_type === 0) break
      cursor = row.parent_cid
    }
    return count
  }

  count(): number {
    const row = this.db.connection
      .prepare("SELECT COUNT(*) as c FROM backup_archives")
      .get() as { c: number }
    return row.c
  }
}

function mapRow(row: RawArchiveRow): BackupArchive {
  return {
    id: row.id,
    agentId: row.agent_id,
    manifestCid: row.manifest_cid,
    backupType: row.backup_type === 1 ? "incremental" : "full",
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    dataMerkleRoot: row.data_merkle_root,
    txHash: row.tx_hash,
    anchoredAt: row.anchored_at,
    anchoredAtEpoch: row.anchored_at_epoch,
    semanticSnapshotIncluded: row.semantic_snapshot_included === 1,
    parentCid: row.parent_cid,
    createdAt: row.created_at,
    createdAtEpoch: row.created_at_epoch,
  }
}
