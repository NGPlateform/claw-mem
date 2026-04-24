// Adapter: claw-mem BackupConfig → legacy CocBackupConfig.
//
// The downstream backup/recovery/carrier code (migrated from coc-backup)
// expects the original CocBackupConfig shape. We keep that shape internal and
// adapt only at construction time so the rest of the code is untouched.

import { z } from "zod"
import { CocBackupConfigSchema, type CocBackupConfig } from "./backup-config-schema.ts"
import type { BackupConfig } from "./config.ts"

export type { BackupConfig } from "./config.ts"

export class BackupConfigError extends Error {}

const BACKUP_LIFECYCLE_KEYS = [
  "rpcUrl",
  "ipfsUrl",
  "contractAddress",
  "privateKey",
] as const

const _BackupCoreSchema = z.object({
  contractAddress: z.string(),
  privateKey: z.string(),
})

/**
 * Build a CocBackupConfig from the user-facing claw-mem config.
 *
 * Throws {@link BackupConfigError} if backup-required fields are missing
 * (contractAddress / privateKey) — backup is opt-in and these only matter
 * when the user is actually trying to back something up.
 */
export function buildCocBackupConfig(
  config: BackupConfig,
  opts: { strict?: boolean } = {},
): CocBackupConfig {
  const { strict = false } = opts

  if (strict) {
    const missing = BACKUP_LIFECYCLE_KEYS.filter((k) => !config[k as keyof BackupConfig])
    if (missing.length > 0) {
      throw new BackupConfigError(
        `Backup not configured. Missing required fields: ${missing.join(", ")}.\n\n` +
          `Set them via:\n` +
          `  claw-mem backup configure        (interactive)\n` +
          `  claw-mem config set backup.<field> <value>\n\n` +
          `Example endpoints:\n` +
          `  rpcUrl   COC testnet: http://199.192.16.79:28780  |  Local node: http://localhost:18780\n` +
          `  ipfsUrl  Local IPFS:  http://localhost:5001       |  Public gateway: see https://docs.ipfs.tech/concepts/public-utilities/\n` +
          `  contractAddress / didRegistryAddress: deployed SoulRegistry / DIDRegistry on your target network\n` +
          `  privateKey: hex EOA key with funds on the target network (chmod 600 the config file)`,
      )
    }
  }

  // Provide test-safe placeholders when fields are missing in non-strict mode.
  // Downstream code that *uses* these will fail on bad addresses; that's the
  // signal to the user to configure properly before invoking backup actions.
  const placeholderAddr = "0x0000000000000000000000000000000000000000"
  const placeholderKey = "0x" + "0".repeat(64)

  const cocConfig = {
    enabled: config.enabled,
    rpcUrl: config.rpcUrl,
    ipfsUrl: config.ipfsUrl,
    contractAddress: config.contractAddress ?? placeholderAddr,
    rpcAuthToken: config.rpcAuthToken,
    privateKey: config.privateKey ?? placeholderKey,
    dataDir: config.sourceDir,
    autoBackupEnabled: config.autoBackup,
    autoBackupIntervalMs: config.autoBackupIntervalMs,
    encryptMemory: config.encryptMemory,
    encryptionPassword: config.encryptionPassword,
    maxIncrementalChain: config.maxIncrementalChain,
    didRegistryAddress: config.didRegistryAddress,
    backupOnSessionEnd: config.backupOnSessionEnd,
    semanticSnapshot: {
      enabled: config.semanticSnapshot.enabled,
      tokenBudget: config.semanticSnapshot.tokenBudget,
      maxObservations: config.semanticSnapshot.maxObservations,
      maxSummaries: config.semanticSnapshot.maxSummaries,
      claudeMemDbPath: "",  // claw-mem manages its DB path itself
    },
    carrier: {
      enabled: config.carrier.enabled,
      carrierId: config.carrier.carrierId,
      agentEntryScript: config.carrier.agentEntryScript,
      workDir: config.carrier.workDir,
      watchedAgents: config.carrier.watchedAgents,
      pendingRequestIds: config.carrier.pendingRequestIds,
      pollIntervalMs: config.carrier.pollIntervalMs,
      readinessTimeoutMs: config.carrier.readinessTimeoutMs,
      readinessPollMs: config.carrier.readinessPollMs,
    },
    categories: {
      identity: config.categories.identity,
      config: config.categories.config,
      memory: config.categories.memory,
      chat: config.categories.chat,
      workspace: config.categories.workspace,
      database: config.categories.database,
    },
  }

  return CocBackupConfigSchema.parse(cocConfig)
}

export function isBackupConfigured(config: BackupConfig): boolean {
  return Boolean(config.contractAddress && config.privateKey && config.rpcUrl && config.ipfsUrl)
}
