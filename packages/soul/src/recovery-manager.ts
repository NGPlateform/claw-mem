// RecoveryManager — facade over the migrated coc-backup recovery pipeline.
// Delegates to the lifecycle helpers (restoreFromManifestCid, autoRestore)
// rather than re-implementing them.

import { resolveRestorePlan, buildDoctorReport } from "./lifecycle.ts"
import type { DoctorReport, RecoveryResult } from "./backup-types.ts"
import { restoreFromManifestCid } from "./recovery/state-restorer.ts"
import { autoRestore } from "./recovery/orchestrator.ts"
import { createCidResolver } from "./recovery/cid-resolver.ts"
import { searchMemories, type MemorySearchResult } from "./recovery/memory-search.ts"
import { resolveHomePath } from "./backup-utils.ts"
import type { BackupManager } from "./backup-manager.ts"
import type { Logger } from "./types.ts"

export interface RecoveryManagerOptions {
  backupManager: BackupManager
  logger: Logger
}

export interface RestoreParams {
  manifestCid?: string
  packagePath?: string
  latestLocal?: boolean
  targetDir?: string
  password?: string
}

export interface AutoRestoreParams {
  agentId?: string
  targetDir?: string
  password?: string
}

export class RecoveryManager {
  private readonly backupManager: BackupManager
  private readonly logger: Logger

  constructor(opts: RecoveryManagerOptions) {
    this.backupManager = opts.backupManager
    this.logger = opts.logger
  }

  async restore(params: RestoreParams): Promise<RecoveryResult> {
    const coc = this.backupManager.getCocConfig()
    const ipfs = this.backupManager.getIpfsClient()
    const soul = this.backupManager.getSoulClient()
    const plan = await resolveRestorePlan(coc, params)
    return restoreFromManifestCid(
      plan.manifestCid,
      plan.targetDir,
      ipfs,
      plan.key,
      plan.isPassword,
      this.logger,
      soul,
    )
  }

  async autoRestoreAgent(params: AutoRestoreParams) {
    const coc = this.backupManager.getCocConfig()
    const ipfs = this.backupManager.getIpfsClient()
    const soul = this.backupManager.getSoulClient()
    const dataDir = params.targetDir ? resolveHomePath(params.targetDir) : resolveHomePath(coc.dataDir)
    const agentId = params.agentId ?? await soul.getAgentIdForOwner()
    const key = params.password ?? coc.encryptionPassword ?? coc.privateKey
    const isPassword = params.password !== undefined || coc.encryptionPassword !== undefined

    const resolver = createCidResolver({ dataDir, agentId, ipfs, logger: this.logger })
    return autoRestore({
      agentId,
      targetDir: dataDir,
      soul,
      ipfs,
      cidResolver: resolver,
      privateKeyOrPassword: key,
      isPassword,
      logger: this.logger,
    })
  }

  async doctor(): Promise<DoctorReport> {
    const coc = this.backupManager.getCocConfig()
    const ipfs = this.backupManager.getIpfsClient()
    const soul = this.backupManager.getSoulClient()
    return buildDoctorReport(coc, soul, ipfs)
  }

  async searchMemories(opts: { query: string; limit?: number; type?: string }): Promise<MemorySearchResult> {
    const coc = this.backupManager.getCocConfig()
    return searchMemories({
      query: opts.query,
      limit: opts.limit,
      type: opts.type,
      dataDir: resolveHomePath(coc.dataDir),
    })
  }
}
