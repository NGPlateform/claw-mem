// Shared dependency bundle for @chainofclaw/soul CLI commands.
//
// Defined once here so each command file can accept a single typed `deps`
// argument. The umbrella @chainofclaw/claw-mem package fills this in from
// its full service graph; the standalone coc-soul CLI constructs a trimmed
// version with only the resource-light managers wired up.

import type { BackupManager } from "../../backup-manager.ts"
import type { RecoveryManager } from "../../recovery-manager.ts"
import type { CarrierManager } from "../../carrier-manager.ts"
import type { BackupArchiveRepository, Logger } from "../../types.ts"
import type { BackupConfig } from "../../config.ts"

export interface SoulCommandDeps {
  backupManager: BackupManager
  recoveryManager: RecoveryManager
  carrierManager: CarrierManager
  archiveStore: BackupArchiveRepository
  /** Current in-memory backup config slice; CLI commands reading `config.backup.*` go through here. */
  backupConfig: BackupConfig
  logger: Logger
}
