// In-memory default archive store for the standalone bin and the OpenClaw
// plugin activate(). Umbrella claw-mem substitutes its SQLite-backed
// ArchiveStore in production.

import type {
  BackupArchive,
  BackupArchiveInput,
  BackupArchivePruneOptions,
  BackupArchivePruneResult,
  BackupArchiveRepository,
} from "../types.ts"

export class InMemoryArchiveRepository implements BackupArchiveRepository {
  private readonly byCid = new Map<string, BackupArchive>()
  private autoId = 0

  insert(input: BackupArchiveInput): BackupArchive {
    const now = new Date()
    const isoNow = now.toISOString()
    const epochNow = Math.floor(now.getTime() / 1000)
    const archive: BackupArchive = {
      id: ++this.autoId,
      agentId: input.agentId,
      manifestCid: input.manifestCid,
      backupType: input.backupType,
      fileCount: input.fileCount,
      totalBytes: input.totalBytes,
      dataMerkleRoot: input.dataMerkleRoot,
      txHash: input.txHash ?? null,
      anchoredAt: input.anchoredAt ?? null,
      anchoredAtEpoch: input.anchoredAt ? Math.floor(new Date(input.anchoredAt).getTime() / 1000) : null,
      semanticSnapshotIncluded: input.semanticSnapshotIncluded ?? true,
      parentCid: input.parentCid ?? null,
      createdAt: isoNow,
      createdAtEpoch: epochNow,
    }
    this.byCid.set(input.manifestCid, archive)
    return archive
  }

  getByCid(cid: string): BackupArchive | null {
    return this.byCid.get(cid) ?? null
  }

  listByAgent(agentId: string, limit = 10): BackupArchive[] {
    return [...this.byCid.values()]
      .filter((a) => a.agentId === agentId)
      .sort((a, b) => b.createdAtEpoch - a.createdAtEpoch)
      .slice(0, limit)
  }

  listAll(limit = 50): BackupArchive[] {
    return [...this.byCid.values()]
      .sort((a, b) => b.createdAtEpoch - a.createdAtEpoch)
      .slice(0, limit)
  }

  getLatestByAgent(agentId: string): BackupArchive | null {
    return this.listByAgent(agentId, 1)[0] ?? null
  }

  countIncrementalChain(): number { return 0 }

  prune(_opts: BackupArchivePruneOptions): BackupArchivePruneResult {
    return { candidates: [], deleted: 0 }
  }
}
