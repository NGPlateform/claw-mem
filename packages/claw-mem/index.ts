// claw-mem: thin OpenClaw skill for persistent semantic memory.
//
// After the 1.1.0 reshape, this plugin's activate() covers ONLY the memory
// layer. COC node lifecycle lives in @chainofclaw/node's activate() and
// soul backup/recovery in @chainofclaw/soul's activate(). Users who install
// all three skills get the full experience without any double-registration.
//
// The standalone `bin/claw-mem` binary still mounts the full CLI tree
// (node / backup / guardian / recovery / carrier / did / bootstrap / doctor
// / status) via registerAllCommands — only the OpenClaw plugin path goes
// thin.

import type { Command } from "commander"

import { bootstrapServicesSync } from "./src/cli/bootstrap-services.ts"
import { registerMemOnlyCommands } from "./src/cli/register-mem.ts"
import { registerHooks } from "./src/hooks/index.ts"
import { registerMemTools } from "./src/tools/mem-tools.ts"
import type { PluginApi } from "./src/types.ts"

// OpenClaw requires `activate()` to register hooks/tools synchronously, so
// we use the sync bootstrap path and let errors bubble into the plugin host.
export function activate(api: PluginApi): void {
  const logger = api.logger
  logger.info("[claw-mem] Loading (memory-only plugin)...")

  let services
  try {
    services = bootstrapServicesSync({
      configOverride: api.pluginConfig ?? {},
      logger,
      memoryOnly: true,
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

  // Register memory-only agent tools (mem-*). Node and soul tools are
  // registered by their respective plugins.
  registerMemTools(api, services)

  // Register a narrow CLI subtree under `openclaw coc …` — only memory-layer
  // commands. Node / backup / bootstrap commands live in the coc-node /
  // coc-soul plugins' registerCli callbacks, or in the standalone bin.
  if (api.registerCli) {
    api.registerCli(
      async ({ program }) => {
        const coc = (program as Command)
          .command("coc")
          .description("claw-mem — persistent memory CLI")
        registerMemOnlyCommands(coc, services)
      },
      { commands: ["coc"] },
    )
  }

  // Graceful shutdown — close the SQLite handle on gateway_stop. No backup
  // scheduler, no carrier daemon, no node shutdown: those are owned by their
  // own plugins now.
  if (api.registerHook) {
    api.registerHook("gateway_stop", async () => {
      logger.info("[claw-mem] Shutting down...")
      services.db.close()
    })
  }

  logger.info("[claw-mem] Loaded (memory layer only)")
  logger.info(
    "[claw-mem] CLI is mounted at `openclaw coc ...`. Standalone `claw-mem` " +
      "binary requires `npm i -g @chainofclaw/claw-mem` separately and is NOT installed by " +
      "`openclaw plugins install`.",
  )
}

// Re-export core modules for external use (e.g. programmatic library users).
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
export {
  summarizeSessionWithLLM,
  createSummarizer,
  type SessionSummarizer,
  type LLMSummarizerDeps,
} from "./src/observer/index.ts"
export { NodeManager, ProcessManager, StorageQuotaManager } from "@chainofclaw/node"
export { BackupManager, RecoveryManager, SoulClient, IpfsClient } from "@chainofclaw/soul"
export { bootstrapServices, bootstrapServicesSync, type MemoryServices } from "./src/cli/bootstrap-services.ts"
export { registerAllCommands } from "./src/cli/register-all.ts"
export { registerMemOnlyCommands } from "./src/cli/register-mem.ts"
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
  SummarizerConfig,
  SummarizerLLMConfig,
} from "./src/config.ts"
export type * from "./src/types.ts"
