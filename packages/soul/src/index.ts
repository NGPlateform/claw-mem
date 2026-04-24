// @chainofclaw/soul — on-chain identity, guardian recovery, soul backup,
// and carrier operations for COC agents.
//
// Entry point for both the umbrella @chainofclaw/claw-mem package (which
// re-exports everything here) and standalone users who need just the DID
// / backup / recovery / carrier pipelines without the memory stack.

// ── Contract clients ───────────────────────────────────────────
export { SoulClient } from "./soul-client.ts"
export { DIDClient } from "./did-client.ts"
export { IpfsClient } from "./ipfs-client.ts"

// ── Managers ───────────────────────────────────────────────────
export { BackupManager, type BackupManagerOptions } from "./backup-manager.ts"
export { RecoveryManager, type RecoveryManagerOptions } from "./recovery-manager.ts"
export { CarrierManager, type CarrierManagerOptions } from "./carrier-manager.ts"

// ── Lifecycle helpers ──────────────────────────────────────────
export {
  resolveRestorePlan,
  buildDoctorReport,
  runInitFlow,
} from "./lifecycle.ts"

// ── Backup primitives ──────────────────────────────────────────
export type {
  BackupReceipt,
  DoctorReport,
  RecoveryResult,
  SnapshotManifest,
  ManifestFileEntry,
  BackupPersistenceState,
  BackupRecoveryPackage,
  OnChainBackup,
  FileCategory,
} from "./backup-types.ts"
export { CocBackupConfigSchema, type CocBackupConfig } from "./backup-config-schema.ts"
export {
  BackupConfigError,
  buildCocBackupConfig,
  isBackupConfigured,
} from "./backup-config-adapter.ts"
export {
  ZERO_BYTES32,
  deriveDefaultAgentId,
  formatBytes,
  resolveHomePath,
  pathExists,
} from "./backup-utils.ts"

// ── Config persistence (shared with claw-mem's bootstrap/config CLI) ──
export {
  DEFAULT_CONFIG_PATH,
  patchConfigFile,
  readConfigFile,
  writeConfigFile,
  getDotPath,
  setDotPath,
  coerceScalar,
} from "./config-persistence.ts"

// ── Local state (backup scheduler .coc-backup dir) ─────────────
export {
  patchBackupState,
  readBackupState,
} from "./local-state.ts"

// ── Config schemas ─────────────────────────────────────────────
export {
  soulConfigSchema,
  BackupConfigSchema,
  CarrierConfigSchema,
  BackupSemanticSnapshotSchema,
  BackupCategoriesSchema,
  CarrierPendingRequestSchema,
  type BackupConfig,
  type CarrierConfig,
  type BackupSemanticSnapshotConfig,
  type BackupCategoriesConfig,
} from "./config.ts"

// ── CLI ───────────────────────────────────────────────────────
export { registerBackupCommands } from "./cli/commands/backup.ts"
export { registerDidCommands } from "./cli/commands/did.ts"
export { registerGuardianCommands } from "./cli/commands/guardian.ts"
export { registerRecoveryCommands } from "./cli/commands/recovery.ts"
export { registerCarrierCommands } from "./cli/commands/carrier.ts"
export type { SoulCommandDeps } from "./cli/commands/deps.ts"

// ── Aggregated mount helper ────────────────────────────────────
export { registerSoulCommands } from "./cli/register.ts"

// ── Port types ─────────────────────────────────────────────────
export type {
  Logger,
  BackupArchive,
  BackupArchiveInput,
  BackupArchiveRepository,
  BackupArchivePruneOptions,
  BackupArchivePruneCandidate,
  BackupArchivePruneResult,
  BackupType,
} from "./types.ts"
