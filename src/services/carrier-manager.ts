// CarrierManager — facade over the migrated CarrierDaemon. Lazily constructed
// like BackupManager: nothing touches the network unless carrier mode is
// actually enabled in config.backup.carrier.

import type { BackupConfig } from "../config.ts"
import type { PluginLogger } from "../types.ts"
import type { BackupManager } from "./backup-manager.ts"
import { CarrierDaemon, CarrierDaemonConfigSchema, type AddRequestResult } from "./carrier/carrier-daemon.ts"
import { createCidResolver } from "./recovery/cid-resolver.ts"
import { resolveHomePath } from "./backup-utils.ts"

export interface CarrierManagerOptions {
  config: BackupConfig
  backupManager: BackupManager
  logger: PluginLogger
}

export class CarrierManager {
  private readonly config: BackupConfig
  private readonly backupManager: BackupManager
  private readonly logger: PluginLogger
  private daemon: CarrierDaemon | null = null

  constructor(opts: CarrierManagerOptions) {
    this.config = opts.config
    this.backupManager = opts.backupManager
    this.logger = opts.logger
  }

  isEnabled(): boolean {
    return Boolean(
      this.config.enabled &&
      this.config.carrier.enabled &&
      this.config.carrier.carrierId &&
      this.config.carrier.agentEntryScript,
    )
  }

  isRunning(): boolean {
    return this.daemon !== null
  }

  start(): void {
    if (!this.isEnabled()) {
      this.logger.info("[carrier] not enabled (config.backup.carrier.enabled=false or carrierId/agentEntryScript missing)")
      return
    }
    if (this.daemon) return  // already running

    if (!this.backupManager.isConfigured()) {
      this.logger.warn("[carrier] cannot start — backup not configured (need rpcUrl + contractAddress + privateKey)")
      return
    }

    const coc = this.backupManager.getCocConfig()
    const soul = this.backupManager.getSoulClient()
    const ipfs = this.backupManager.getIpfsClient()

    const daemonConfig = CarrierDaemonConfigSchema.parse({
      carrierId: this.config.carrier.carrierId!,
      watchedAgents: this.config.carrier.watchedAgents,
      pendingRequestIds: this.config.carrier.pendingRequestIds,
      pollIntervalMs: this.config.carrier.pollIntervalMs,
      readinessTimeoutMs: this.config.carrier.readinessTimeoutMs,
      readinessPollMs: this.config.carrier.readinessPollMs,
      agentEntryScript: this.config.carrier.agentEntryScript!,
      workDir: this.config.carrier.workDir,
      privateKeyOrPassword: this.config.encryptionPassword ?? coc.privateKey,
      isPassword: this.config.encryptionPassword !== undefined,
    })

    const cidResolver = createCidResolver({
      dataDir: resolveHomePath(coc.dataDir),
      agentId: "",
      ipfs,
      logger: this.logger,
    })

    this.daemon = new CarrierDaemon(daemonConfig, soul, ipfs, cidResolver, this.logger)
    this.daemon.start()
    this.logger.info(`[carrier] daemon started (carrierId ${this.config.carrier.carrierId})`)
  }

  async stop(): Promise<void> {
    if (this.daemon) {
      await this.daemon.stop()
      this.daemon = null
      this.logger.info("[carrier] daemon stopped")
    }
  }

  addRequest(requestId: string, agentId: string): AddRequestResult {
    if (!this.daemon) return { accepted: false, reason: "not_running" }
    return this.daemon.addRequest(requestId, agentId)
  }
}
