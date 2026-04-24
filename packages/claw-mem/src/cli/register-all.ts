// Single source of truth for CLI command registration.
// Both `bin/claw-mem` and the OpenClaw `registerCli()` callback go through
// this function so commands are not duplicated.

import type { Command } from "commander"

import type { NodeStore } from "../db/node-store.ts"
import type { ArchiveStore } from "../db/archive-store.ts"
import type { ArtifactStore } from "../db/artifact-store.ts"
import type { NodeManager, ProcessManager, StorageQuotaManager } from "@chainofclaw/node"
import type { BackupManager, RecoveryManager, CarrierManager } from "@chainofclaw/soul"
import type { BootstrapManager } from "../services/bootstrap-manager.ts"
import type { MemoryServices } from "./bootstrap-services.ts"
import { registerMemCommands } from "./commands/mem.ts"
import { registerNodeCommands } from "@chainofclaw/node"
import {
  registerBackupCommands,
  registerCarrierCommands,
  registerGuardianCommands,
  registerRecoveryCommands,
  registerDidCommands,
} from "@chainofclaw/soul"
import { registerBootstrapCommands } from "./commands/bootstrap.ts"
import { registerConfigCommands } from "./commands/config.ts"
import { registerStatusCommand } from "./commands/status.ts"
import { registerDoctorCommand } from "./commands/doctor.ts"
import { registerInitCommand } from "./commands/init.ts"
import { registerVersionCommand } from "./commands/version.ts"
import { registerToolsCommand } from "./commands/tools.ts"
import { registerDbCommands } from "./commands/db.ts"
import { registerUninstallCommand } from "./commands/uninstall.ts"

/**
 * Full service graph for the standalone `claw-mem` bin. Extends
 * `MemoryServices` with the node + backup + bootstrap managers.
 */
export interface CliServices extends MemoryServices {
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

  const soulDeps = {
    backupManager: services.backupManager,
    recoveryManager: services.recoveryManager,
    carrierManager: services.carrierManager,
    archiveStore: services.archiveStore,
    backupConfig: services.config.backup,
    logger: services.logger,
  }
  registerBackupCommands(program, soulDeps)
  registerCarrierCommands(program, soulDeps)
  registerGuardianCommands(program, soulDeps)
  registerRecoveryCommands(program, soulDeps)
  registerDidCommands(program, soulDeps)

  registerBootstrapCommands(program, services)
  registerDbCommands(program, services)
  registerConfigCommands(program, services)
}
