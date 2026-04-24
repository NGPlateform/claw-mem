// claw-mem: OpenClaw super-skill = persistent semantic memory + COC node
// lifecycle + (PR 4) soul backup/recovery.
//
// activate() is now a thin assembly layer:
//   1. bootstrapServices(api.pluginConfig, api.logger) — builds the full
//      service graph (db + stores + node manager + ...).
//   2. registerHooks(api, db, config, logger) — session lifecycle hooks.
//   3. registerAllTools(api, services) — agent-callable tools.
//   4. api.registerCli(...)  — same commander commands as `bin/claw-mem`.
//   5. gateway_stop hook for graceful shutdown.

import type { Command } from "commander"

import { bootstrapServicesSync } from "./src/cli/bootstrap-services.ts"
import { registerAllCommands } from "./src/cli/register-all.ts"
import { registerHooks } from "./src/hooks/index.ts"
import { registerAllTools } from "./src/tools/index.ts"
import type { PluginApi } from "./src/types.ts"

// OpenClaw requires `activate()` to register hooks/tools synchronously, so
// we use the sync bootstrap path and let errors bubble into the plugin host.
export function activate(api: PluginApi): void {
  const logger = api.logger
  logger.info("[claw-mem] Loading...")

  let services
  try {
    services = bootstrapServicesSync({
      configOverride: api.pluginConfig ?? {},
      logger,
    })
  } catch (error) {
    logger.error(`[claw-mem] Bootstrap failed: ${String(error)}`)
    return
  }

  if (!services.config.enabled) {
    logger.info("[claw-mem] Disabled via config")
    services.db.close()
    return
  }

  logger.info(`[claw-mem] Database opened: ${services.dbPath}`)

  // Register session lifecycle hooks (memory capture/injection).
  registerHooks(api, services.db, services.config, logger)

  // Register agent-callable tools.
  registerAllTools(api, services)

  // Register CLI subcommands inside OpenClaw.
  //
  // To avoid clashes with OpenClaw's built-in `node` / `backup` / `doctor` /
  // `status` / `init` / `bootstrap` / `uninstall` top-level commands, we
  // nest **all** of our subcommands under one `openclaw coc …` prefix. The
  // standalone `claw-mem` binary keeps the flat top-level layout — there's
  // no collision outside of OpenClaw.
  if (api.registerCli) {
    api.registerCli(
      async ({ program }) => {
        const coc = (program as Command)
          .command("coc")
          .description(
            "claw-mem — persistent memory + COC node lifecycle + soul backup",
          )
        registerAllCommands(coc, services)
      },
      { commands: ["coc"] },
    )
  }

  // Auto-backup scheduler (no-op when not configured).
  try {
    services.backupManager.start()
  } catch (error) {
    logger.warn(`[claw-mem] backup auto-start failed: ${String(error)}`)
  }

  // Carrier daemon (no-op when carrier mode not enabled).
  try {
    services.carrierManager.start()
  } catch (error) {
    logger.warn(`[claw-mem] carrier auto-start failed: ${String(error)}`)
  }

  // Session-end backup hook.
  if (services.config.backup.enabled && services.config.backup.backupOnSessionEnd && api.registerHook) {
    api.registerHook("session_end", async () => {
      if (!services.backupManager.isConfigured()) return
      try {
        await services.backupManager.runBackup(false)
      } catch (error) {
        logger.error(`[claw-mem] session_end backup failed: ${String(error)}`)
      }
    })
  }

  // Graceful shutdown.
  if (api.registerHook) {
    api.registerHook("gateway_stop", async () => {
      logger.info("[claw-mem] Shutting down...")
      services.backupManager.stop()
      await services.carrierManager.stop()
      services.db.close()
    })
  }

  logger.info(
    `[claw-mem] Loaded successfully ` +
      `(memory + ${services.nodeStore.count()} node(s) tracked + ` +
      `backup ${services.backupManager.isConfigured() ? "configured" : "not configured"})`,
  )
}

// Re-export core modules for external use (e.g. coc-backup integration shim).
export { Database } from "./src/db/database.ts"
export { ObservationStore } from "./src/db/observation-store.ts"
export { SummaryStore } from "./src/db/summary-store.ts"
export { SessionStore } from "./src/db/session-store.ts"
export { NodeStore } from "./src/db/node-store.ts"
export { ArchiveStore } from "./src/db/archive-store.ts"
export { ArtifactStore } from "./src/db/artifact-store.ts"
export { SearchEngine } from "./src/search/search.ts"
export { buildContext } from "./src/context/builder.ts"
export { extractObservation } from "./src/observer/extractor.ts"
export { summarizeSession } from "./src/observer/summarizer.ts"
export { NodeManager, ProcessManager, StorageQuotaManager } from "@chainofclaw/node"
export { BackupManager, RecoveryManager, SoulClient, IpfsClient } from "@chainofclaw/soul"
export { bootstrapServices } from "./src/cli/bootstrap-services.ts"
export { registerAllCommands } from "./src/cli/register-all.ts"
export {
  ClawMemConfigSchema,
  resolveDbPath,
  resolveDataDir,
  resolveNodesDir,
  resolveBackupDir,
  resolveArchivesDir,
  resolveLogsDir,
  resolveKeysDir,
} from "./src/config.ts"
export type {
  ClawMemConfig,
  StorageConfig,
  NodeConfig,
  BackupConfig,
  BootstrapConfig,
  CarrierConfig,
} from "./src/config.ts"
export type * from "./src/types.ts"
