// Single source of truth for CLI command registration.
// Both `bin/claw-mem` and the OpenClaw `registerCli()` callback go through
// this function so commands are not duplicated.

import type { Command } from "commander"

import type { ClawMemConfig } from "../config.ts"
import type { Database } from "../db/database.ts"
import type { ObservationStore } from "../db/observation-store.ts"
import type { SummaryStore } from "../db/summary-store.ts"
import type { SessionStore } from "../db/session-store.ts"
import type { NodeStore } from "../db/node-store.ts"
import type { ArchiveStore } from "../db/archive-store.ts"
import type { ArtifactStore } from "../db/artifact-store.ts"
import type { SearchEngine } from "../search/search.ts"
import type { NodeManager, ProcessManager, StorageQuotaManager } from "@chainofclaw/node"
import type { BackupManager } from "../services/backup-manager.ts"
import type { RecoveryManager } from "../services/recovery-manager.ts"
import type { CarrierManager } from "../services/carrier-manager.ts"
import type { BootstrapManager } from "../services/bootstrap-manager.ts"
import type { PluginLogger } from "../types.ts"
import { registerMemCommands } from "./commands/mem.ts"
import { registerNodeCommands } from "@chainofclaw/node"
import { registerBackupCommands } from "./commands/backup.ts"
import { registerBootstrapCommands } from "./commands/bootstrap.ts"
import { registerConfigCommands } from "./commands/config.ts"
import { registerStatusCommand } from "./commands/status.ts"
import { registerDoctorCommand } from "./commands/doctor.ts"
import { registerInitCommand } from "./commands/init.ts"
import { registerVersionCommand } from "./commands/version.ts"
import { registerToolsCommand } from "./commands/tools.ts"
import { registerDbCommands } from "./commands/db.ts"
import { registerUninstallCommand } from "./commands/uninstall.ts"
import { registerCarrierCommands } from "./commands/carrier.ts"
import { registerGuardianCommands } from "./commands/guardian.ts"
import { registerRecoveryCommands } from "./commands/recovery.ts"
import { registerDidCommands } from "./commands/did.ts"

export interface CliServices {
  config: ClawMemConfig
  logger: PluginLogger
  db: Database
  dbPath: string

  // Memory layer
  observationStore: ObservationStore
  summaryStore: SummaryStore
  sessionStore: SessionStore
  searchEngine: SearchEngine

  // Node layer
  nodeStore: NodeStore
  archiveStore: ArchiveStore
  artifactStore: ArtifactStore
  nodeManager: NodeManager
  processManager: ProcessManager
  storageQuotaManager: StorageQuotaManager

  // Backup layer
  backupManager: BackupManager
  recoveryManager: RecoveryManager
  carrierManager: CarrierManager

  // Bootstrap
  bootstrapManager: BootstrapManager
}

export function registerAllCommands(program: Command, services: CliServices): void {
  // Top-level convenience commands first so they show up at the top of `--help`.
  registerStatusCommand(program, services)
  registerDoctorCommand(program, services)
  registerInitCommand(program, services)
  registerVersionCommand(program, services)
  registerToolsCommand(program, services)
  registerUninstallCommand(program, services)

  registerMemCommands(program, services)
  registerNodeCommands(program, { nodeManager: services.nodeManager, logger: services.logger })
  registerBackupCommands(program, services)
  registerCarrierCommands(program, services)
  registerGuardianCommands(program, services)
  registerRecoveryCommands(program, services)
  registerDidCommands(program, services)
  registerBootstrapCommands(program, services)
  registerDbCommands(program, services)
  registerConfigCommands(program, services)
}
