// BackupManager — facade over the migrated coc-backup scheduler/uploader/
// manifest-builder pipeline.
//
// Owns: SoulClient + IpfsClient + BackupScheduler. Lazily constructed: nothing
// touches the chain or IPFS unless a backup-related call is made. Records each
// successful backup into BackupArchiveRepository so PR 5+ can list history without
// re-walking IPFS.

import type { BackupArchiveRepository, Logger } from "./types.ts"
import type { BackupConfig } from "./backup-config-adapter.ts"
import { SoulClient } from "./soul-client.ts"
import { IpfsClient } from "./ipfs-client.ts"
import { DIDClient } from "./did-client.ts"
import { BackupScheduler, type RunBackupOptions } from "./backup/scheduler.ts"
import type { BackupReceipt } from "./backup-types.ts"
import {
  BackupConfigError,
  buildCocBackupConfig,
  isBackupConfigured,
} from "./backup-config-adapter.ts"
import type { CocBackupConfig } from "./backup-config-schema.ts"
import { ensureAgentKey } from "./keystore.ts"
import { requestFaucetDrip } from "./faucet.ts"
import { Wallet } from "ethers"

export interface BackupManagerOptions {
  config: BackupConfig
  archiveStore: BackupArchiveRepository
  logger: Logger
  /**
   * If `config.privateKey` is empty, auto-create a local EOA via the
   * keystore. Default: true. Set false to opt out (e.g. during tests, or
   * when integrating with an external signer).
   */
  autoGenerateKey?: boolean
  /**
   * Override the keystore file path. Useful in sandboxed runtimes where
   * the default ~/.claw-mem/keys/agent.key location isn't writable.
   * Falls back to COC_SOUL_KEYSTORE_PATH env var, then writability probe,
   * then os.tmpdir() as last resort.
   */
  keystorePath?: string
}

/**
 * Where the active signing key came from. Surfaced to the CLI so a
 * post-backup summary can tell the user which file holds the key needed
 * to restore on another host. `keyPath` is null when the key came from
 * `backup.privateKey` in config (no on-disk file managed by soul).
 */
export interface KeyMaterialInfo {
  /** "config" — operator set backup.privateKey directly; "keystore" — auto-generated/loaded from disk */
  source: "config" | "keystore" | "missing"
  /** Absolute path to the keystore file, or null when source !== "keystore" */
  keyPath: string | null
  /** Ethereum address derived from the active key, or null when not available */
  address: string | null
}

export class BackupManager {
  private readonly config: BackupConfig
  private readonly archiveStore: BackupArchiveRepository
  private readonly logger: Logger
  private readonly keyMaterial: KeyMaterialInfo

  private cocConfig: CocBackupConfig | null = null
  private soul: SoulClient | null = null
  private ipfs: IpfsClient | null = null
  private scheduler: BackupScheduler | null = null

  constructor(opts: BackupManagerOptions) {
    let cfg = opts.config
    let keyMaterial: KeyMaterialInfo
    if (cfg.privateKey) {
      // Operator set the key explicitly; we don't track its on-disk location.
      let address: string | null = null
      try { address = new Wallet(cfg.privateKey).address } catch { /* ignore */ }
      keyMaterial = { source: "config", keyPath: null, address }
    } else if (opts.autoGenerateKey !== false) {
      try {
        const key = ensureAgentKey({ logger: opts.logger, keyPath: opts.keystorePath })
        cfg = { ...cfg, privateKey: key.privateKey }
        keyMaterial = { source: "keystore", keyPath: key.keyPath, address: key.address }
        if (key.generated) {
          opts.logger.info(
            `[coc-soul] using auto-generated agent address ${key.address} (override via backup.privateKey)`,
          )
          // Fire-and-forget faucet drip so the new EOA has gas the moment
          // the user runs a write command. Failures are logged, never thrown.
          if (cfg.faucetUrl) {
            void requestFaucetDrip({
              url: cfg.faucetUrl,
              address: key.address,
              logger: opts.logger,
            })
          }
        }
      } catch (err) {
        opts.logger.warn(`[coc-soul] keystore unavailable: ${String(err)}`)
        keyMaterial = { source: "missing", keyPath: null, address: null }
      }
    } else {
      keyMaterial = { source: "missing", keyPath: null, address: null }
    }
    this.config = cfg
    this.archiveStore = opts.archiveStore
    this.logger = opts.logger
    this.keyMaterial = keyMaterial
  }

  /** Where the active signing key lives — surfaced post-backup so users know what to copy off-host for restore. */
  getKeyMaterial(): KeyMaterialInfo { return this.keyMaterial }

  isConfigured(): boolean {
    return isBackupConfigured(this.config)
  }

  /** Build (or return cached) clients. Throws if required fields are missing. */
  private build(): {
    coc: CocBackupConfig
    soul: SoulClient
    ipfs: IpfsClient
    scheduler: BackupScheduler
  } {
    if (this.scheduler && this.cocConfig && this.soul && this.ipfs) {
      return { coc: this.cocConfig, soul: this.soul, ipfs: this.ipfs, scheduler: this.scheduler }
    }
    const coc = buildCocBackupConfig(this.config, { strict: true })
    const soul = new SoulClient(coc.rpcUrl, coc.contractAddress, coc.privateKey, coc.rpcAuthToken)
    const ipfs = new IpfsClient(coc.ipfsUrl)
    const scheduler = new BackupScheduler(coc, soul, ipfs, this.logger)
    this.cocConfig = coc
    this.soul = soul
    this.ipfs = ipfs
    this.scheduler = scheduler
    return { coc, soul, ipfs, scheduler }
  }

  /**
   * Run a backup once. `full=true` forces a full backup; otherwise the
   * scheduler decides incremental vs full based on its own policy.
   * Pass an options object instead of a boolean to opt into dry-run /
   * category-override flows used by the new CLI flags.
   */
  async runBackup(arg: boolean | RunBackupOptions = false): Promise<BackupReceipt> {
    const { scheduler, soul } = this.build()
    const receipt = await scheduler.runBackup(arg)
    const b = receipt.backup
    if (b) {
      let agentId = ""
      try { agentId = await soul.getAgentIdForOwner() } catch { /* ignore */ }
      const anchoredAt = b.anchoredAt
        ? new Date(b.anchoredAt * 1000).toISOString()
        : null
      try {
        this.archiveStore.insert({
          agentId,
          manifestCid: b.manifestCid,
          backupType: b.backupType === 0 ? "full" : "incremental",
          fileCount: b.fileCount,
          totalBytes: b.totalBytes,
          dataMerkleRoot: b.dataMerkleRoot,
          txHash: b.txHash,
          anchoredAt,
          // The scheduler passes a semanticDigest into the manifest, but that
          // detail isn't surfaced on BackupResult. Default to true since the
          // scheduler invokes captureSemanticSnapshot before each backup.
          semanticSnapshotIncluded: true,
          parentCid: b.parentManifestCid,
        })
      } catch (error) {
        this.logger.warn(`Failed to record backup in archive store: ${String(error)}`)
      }
    }
    return receipt
  }

  /** Start the auto-backup timer (every `autoBackupIntervalMs`). */
  start(): void {
    if (!this.config.enabled || !this.config.autoBackup) return
    if (!this.isConfigured()) {
      this.logger.warn("[claw-mem backup] auto-backup disabled — backup not configured (no contract/key)")
      return
    }
    try {
      this.build().scheduler.start()
    } catch (error) {
      if (error instanceof BackupConfigError) {
        this.logger.warn(`[claw-mem backup] ${error.message}`)
        return
      }
      throw error
    }
  }

  stop(): void {
    this.scheduler?.stop()
  }

  /** Get the underlying SoulClient — built lazily. Throws if not configured. */
  getSoulClient(): SoulClient { return this.build().soul }
  getIpfsClient(): IpfsClient { return this.build().ipfs }
  getCocConfig(): CocBackupConfig { return this.build().coc }
  getScheduler(): BackupScheduler { return this.build().scheduler }

  /**
   * Build a DIDClient if the user has set didRegistryAddress; returns null
   * otherwise. DID operations are opt-in and shouldn't break the rest of the
   * backup flow when DIDRegistry hasn't been deployed yet.
   */
  getDidClient(): DIDClient | null {
    if (!this.config.didRegistryAddress) return null
    if (this.didClient) return this.didClient
    const coc = this.build().coc
    if (!coc.didRegistryAddress) return null
    this.didClient = new DIDClient(coc.rpcUrl, coc.didRegistryAddress, coc.privateKey, coc.rpcAuthToken)
    return this.didClient
  }

  private didClient: DIDClient | null = null
}
