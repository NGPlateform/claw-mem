// @chainofclaw/soul OpenClaw plugin — activate() body.
//
// Parses api.pluginConfig.backup through BackupConfigSchema, constructs the
// three soul managers against an in-memory archive store (claw-mem's SQLite
// archive is not available when soul runs as a standalone skill), registers
// agent tools, mounts the `coc-soul` CLI subtree, starts schedulers if
// configured, and attaches session_end + gateway_stop hooks.

import type { Command } from "commander"

import { BackupConfigSchema, type BackupConfig } from "../config.ts"
import { BackupManager } from "../backup-manager.ts"
import { RecoveryManager } from "../recovery-manager.ts"
import { CarrierManager } from "../carrier-manager.ts"
import { registerSoulCommands } from "../cli/register.ts"
import { resolveClawMemDbPath, resolveSoulDataDir } from "../data-dir.ts"
import { InMemoryArchiveRepository } from "./in-memory-archive-repository.ts"
import { registerSoulTools } from "./tools.ts"
import type { PluginApi } from "./types.ts"

function parseBackupConfig(pluginConfig: Record<string, unknown> | undefined): BackupConfig {
  const raw = (pluginConfig?.backup as Record<string, unknown> | undefined) ?? {}
  return BackupConfigSchema.parse(raw)
}

export function activate(api: PluginApi): void {
  const logger = api.logger
  logger.info("[coc-soul] Loading...")

  const backupConfig = parseBackupConfig(api.pluginConfig)

  if (!backupConfig.enabled) {
    logger.info("[coc-soul] Disabled via config")
    return
  }

  // Probe writability of soul's data root early — fail fast with an actionable
  // error instead of letting the keystore write fail mid-backup. The resolver
  // throws an EACCES-style error with concrete fix instructions.
  let dataDir: string
  try {
    dataDir = resolveSoulDataDir({ logger })
  } catch (error) {
    logger.error(`[coc-soul] data dir not writable: ${String(error)}`)
    return
  }
  logger.info(`[coc-soul] data dir: ${dataDir}`)

  // Detect a co-installed @chainofclaw/claw-mem and announce whether the
  // semantic snapshot will have anything to capture. This is the only
  // integration point with claw-mem — soul still runs fine standalone.
  const clawMemDbPath = resolveClawMemDbPath({ logger })
  if (clawMemDbPath) {
    logger.info(
      `[coc-soul] claw-mem detected at ${clawMemDbPath} — semantic snapshot ` +
        `(chat + tool observations + session summaries) will be included in each backup`,
    )
  } else {
    logger.info(
      `[coc-soul] claw-mem not detected — backups will skip the semantic snapshot ` +
        `(install @chainofclaw/claw-mem alongside soul to enable memory replay on recovery)`,
    )
  }

  const archiveStore = new InMemoryArchiveRepository()
  const backupManager = new BackupManager({ config: backupConfig, archiveStore, logger })
  const recoveryManager = new RecoveryManager({ backupManager, logger })
  const carrierManager = new CarrierManager({ config: backupConfig, backupManager, logger })

  registerSoulTools(api, { backupManager, recoveryManager, carrierManager, logger })

  if (api.registerCli) {
    api.registerCli(
      async ({ program }) => {
        const soul = (program as Command)
          .command("coc-soul")
          .description("COC soul backup, recovery, carrier, guardian, DID")
        registerSoulCommands(soul, {
          backupManager,
          recoveryManager,
          carrierManager,
          archiveStore,
          backupConfig,
          logger,
        })
      },
      { commands: ["coc-soul"] },
    )
  }

  // Auto-backup scheduler (no-op unless backup.autoBackup).
  try {
    if (backupConfig.autoBackup) backupManager.start()
  } catch (error) {
    logger.warn(`[coc-soul] backup auto-start failed: ${String(error)}`)
  }

  // Carrier daemon (no-op unless backup.carrier.enabled).
  try {
    if (backupConfig.carrier?.enabled) carrierManager.start()
  } catch (error) {
    logger.warn(`[coc-soul] carrier auto-start failed: ${String(error)}`)
  }

  // Session-end backup hook.
  if (backupConfig.backupOnSessionEnd && api.registerHook) {
    api.registerHook("session_end", async () => {
      if (!backupManager.isConfigured()) return
      try {
        await backupManager.runBackup(false)
      } catch (error) {
        logger.error(`[coc-soul] session_end backup failed: ${String(error)}`)
      }
    })
  }

  // Graceful shutdown.
  if (api.registerHook) {
    api.registerHook("gateway_stop", async () => {
      logger.info("[coc-soul] Shutting down...")
      try { backupManager.stop() } catch (error) { logger.warn(`[coc-soul] backup stop: ${String(error)}`) }
      try { await carrierManager.stop() } catch (error) { logger.warn(`[coc-soul] carrier stop: ${String(error)}`) }
    })
  }

  logger.info(
    `[coc-soul] Loaded (backup ${backupManager.isConfigured() ? "configured" : "not configured"}, ` +
      `carrier ${backupConfig.carrier?.enabled ? "enabled" : "disabled"})`,
  )
  logger.info(
    `[coc-soul] CLI is mounted at \`openclaw coc-soul ...\`. Standalone \`coc-soul\` ` +
      `binary requires \`npm i -g @chainofclaw/soul\` separately and is NOT installed by ` +
      `\`openclaw plugins install\`.`,
  )
}
