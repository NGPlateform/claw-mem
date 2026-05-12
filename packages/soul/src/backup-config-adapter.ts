// Adapter: claw-mem BackupConfig → legacy CocBackupConfig.
//
// The downstream backup/recovery/carrier code (migrated from coc-backup)
// expects the original CocBackupConfig shape. We keep that shape internal and
// adapt only at construction time so the rest of the code is untouched.

import { z } from "zod"
import { CocBackupConfigSchema, type CocBackupConfig } from "./backup-config-schema.ts"
import type { BackupConfig } from "./config.ts"
import { getDeployedContracts } from "./manifests/index.ts"

export type { BackupConfig } from "./config.ts"

export class BackupConfigError extends Error {}

const _BackupCoreSchema = z.object({
  contractAddress: z.string(),
  privateKey: z.string(),
})

/**
 * Resolve `contractAddress` / `didRegistryAddress` for a config. When the user
 * has not overridden these, fall back to the deployed-contracts manifest for
 * the selected chainId. Returns `{ contractAddress, didRegistryAddress }`
 * where either may still be undefined if the manifest has no entry (manifests
 * include all known governance contracts so this is mostly a defensive guard).
 */
function resolveContractAddresses(config: BackupConfig): {
  contractAddress: string | undefined
  didRegistryAddress: string | undefined
} {
  if (config.contractAddress && config.didRegistryAddress) {
    return {
      contractAddress: config.contractAddress,
      didRegistryAddress: config.didRegistryAddress,
    }
  }
  try {
    const manifest = getDeployedContracts(config.chainId)
    return {
      contractAddress: config.contractAddress ?? manifest.contracts.SoulRegistry,
      didRegistryAddress: config.didRegistryAddress ?? manifest.contracts.DIDRegistry,
    }
  } catch {
    // Unknown chainId — return whatever the user passed; downstream will error
    // with a clearer message when it actually tries to use the address.
    return {
      contractAddress: config.contractAddress,
      didRegistryAddress: config.didRegistryAddress,
    }
  }
}

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
  const resolved = resolveContractAddresses(config)

  if (strict) {
    const missing: string[] = []
    if (!config.rpcUrl) missing.push("rpcUrl")
    if (!resolved.contractAddress) missing.push("contractAddress")
    if (!config.privateKey) missing.push("privateKey")
    if (missing.length > 0) {
      throw new BackupConfigError(
        `Backup not configured. Missing required fields: ${missing.join(", ")}.\n\n` +
          `Run \`claw-mem backup configure\` (interactive) or \`claw-mem config set backup.<field> <value>\` to fix.\n` +
          `Hint: contractAddress is normally auto-resolved from chainId (currently ${config.chainId}); ` +
          `set it explicitly only when targeting a custom deployment. ` +
          `privateKey is auto-generated to ~/.claw-mem/keys/agent.key on first use. ` +
          `ipfsUrl is only required for backup create / restore.`,
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
    contractAddress: resolved.contractAddress ?? placeholderAddr,
    rpcAuthToken: config.rpcAuthToken,
    privateKey: config.privateKey ?? placeholderKey,
    dataDir: config.sourceDir,
    autoBackupEnabled: config.autoBackup,
    autoBackupIntervalMs: config.autoBackupIntervalMs,
    encryptMemory: config.encryptMemory,
    encryptionPassword: config.encryptionPassword,
    maxIncrementalChain: config.maxIncrementalChain,
    didRegistryAddress: resolved.didRegistryAddress,
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
  const { contractAddress } = resolveContractAddresses(config)
  return Boolean(contractAddress && config.privateKey && config.rpcUrl && config.ipfsUrl)
}
