// coc-soul — standalone CLI for @chainofclaw/soul.
//
// Constructs BackupManager + RecoveryManager + CarrierManager from
// ~/.chainofclaw/config.json (or schema defaults) and mounts every soul
// subcommand. Note: this bin supports the one-shot operations
// (did / guardian / recovery / carrier + most `backup` subcommands) but
// does NOT keep the BackupManager scheduler running as a daemon — that is
// an umbrella concern exposed via @chainofclaw/claw-mem's plugin activate().

import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { Command } from "commander"

import { BackupConfigSchema, type BackupConfig } from "../config.ts"
import { BackupManager } from "../backup-manager.ts"
import { RecoveryManager } from "../recovery-manager.ts"
import { CarrierManager } from "../carrier-manager.ts"
import type { Logger } from "../types.ts"
import { InMemoryArchiveRepository } from "../plugin/in-memory-archive-repository.ts"
import { registerSoulCommands } from "./register.ts"

function createConsoleLogger(): Logger {
  const fmt = (level: string, msg: string) => `[coc-soul ${level}] ${msg}`
  return {
    info: (msg) => console.error(fmt("info", msg)),
    warn: (msg) => console.error(fmt("warn", msg)),
    error: (msg) => console.error(fmt("error", msg)),
    debug: (msg) => (process.env.COC_SOUL_DEBUG ? console.error(fmt("debug", msg)) : undefined),
  }
}

function loadBackupConfig(): BackupConfig {
  const candidates = [
    process.env.COC_SOUL_CONFIG,
    join(homedir(), ".chainofclaw", "config.json"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0)

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const raw = readFileSync(path, "utf-8")
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const backup = (parsed.backup as Record<string, unknown> | undefined) ?? {}
      return BackupConfigSchema.parse(backup)
    } catch (err) {
      console.error(`[coc-soul] Failed to load ${path}: ${String(err)}`)
    }
  }
  return BackupConfigSchema.parse({})
}

function main(): void {
  const backupConfig = loadBackupConfig()
  const logger = createConsoleLogger()
  const archiveStore = new InMemoryArchiveRepository()
  const backupManager = new BackupManager({ config: backupConfig, archiveStore, logger })
  const recoveryManager = new RecoveryManager({ backupManager, logger })
  const carrierManager = new CarrierManager({ config: backupConfig, backupManager, logger })

  const program = new Command()
  program
    .name("coc-soul")
    .description("Standalone CLI for @chainofclaw/soul: DID, guardian, recovery, carrier, backup.")
    .version("1.1.8")

  registerSoulCommands(program, {
    backupManager,
    recoveryManager,
    carrierManager,
    archiveStore,
    backupConfig,
    logger,
  })

  program.parseAsync(process.argv).catch((err) => {
    logger.error(String(err))
    process.exit(1)
  })
}

main()
