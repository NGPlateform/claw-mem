// Construct the full claw-mem service graph. Used by both the standalone CLI
// (`bin/claw-mem`) and by future programmatic entry points (e.g. tests).
//
// The OpenClaw plugin path uses a parallel constructor that takes the
// PluginApi-supplied logger and config; see `index.ts` for that wiring.

import { mkdir, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { ClawMemConfigSchema, resolveDataDir, resolveDbPath, type ClawMemConfig } from "../config.ts"
import type { PluginLogger } from "../types.ts"
import { Database } from "../db/database.ts"
import { ObservationStore } from "../db/observation-store.ts"
import { SummaryStore } from "../db/summary-store.ts"
import { SessionStore } from "../db/session-store.ts"
import { NodeStore } from "../db/node-store.ts"
import { ArchiveStore } from "../db/archive-store.ts"
import { ArtifactStore } from "../db/artifact-store.ts"
import { SearchEngine } from "../search/search.ts"
import { NodeManager } from "../services/node-manager.ts"
import { ProcessManager } from "../services/process-manager.ts"
import { StorageQuotaManager } from "../services/storage-quota-manager.ts"
import { BackupManager } from "../services/backup-manager.ts"
import { RecoveryManager } from "../services/recovery-manager.ts"
import { CarrierManager } from "../services/carrier-manager.ts"
import { BootstrapManager } from "../services/bootstrap-manager.ts"
import type { CliServices } from "./register-all.ts"

export interface BootstrapServicesOptions {
  configPath?: string
  configOverride?: Record<string, unknown>
  logger?: PluginLogger
}

export async function bootstrapServices(opts: BootstrapServicesOptions = {}): Promise<CliServices> {
  const logger = opts.logger ?? createConsoleLogger()
  const rawConfig = opts.configOverride ?? (await loadConfigFile(opts.configPath))
  const config = ClawMemConfigSchema.parse(rawConfig)

  const dataDir = resolveDataDir(config)
  await mkdir(dataDir, { recursive: true })

  const dbPath = resolveDbPath(config)
  const db = new Database(dbPath)
  await db.open()

  const observationStore = new ObservationStore(db)
  const summaryStore = new SummaryStore(db)
  const sessionStore = new SessionStore(db)
  const searchEngine = new SearchEngine(db)
  const nodeStore = new NodeStore(db)
  const archiveStore = new ArchiveStore(db)
  const artifactStore = new ArtifactStore(db)

  const processManager = new ProcessManager(logger)
  const storageQuotaManager = new StorageQuotaManager({
    config: config.storage,
    logger,
    dataDir,
  })
  const nodeManager = new NodeManager({
    nodeStore,
    processManager,
    config,
    logger,
    baseDir: dataDir,
    storageQuotaManager,
  })

  const backupManager = new BackupManager({
    config: config.backup,
    archiveStore,
    logger,
  })
  const recoveryManager = new RecoveryManager({
    backupManager,
    logger,
  })

  const carrierManager = new CarrierManager({
    config: config.backup,
    backupManager,
    logger,
  })

  const bootstrapManager = new BootstrapManager({
    config,
    nodeManager,
    processManager,
    artifactStore,
    storageQuotaManager,
    backupManager,
    logger,
    dataDir,
  })

  return {
    config,
    logger,
    db,
    dbPath,
    observationStore,
    summaryStore,
    sessionStore,
    searchEngine,
    nodeStore,
    archiveStore,
    artifactStore,
    nodeManager,
    processManager,
    storageQuotaManager,
    backupManager,
    recoveryManager,
    carrierManager,
    bootstrapManager,
  }
}

async function loadConfigFile(explicit?: string): Promise<Record<string, unknown>> {
  const candidates = explicit
    ? [explicit]
    : [
        join(homedir(), ".claw-mem", "config.json"),
        join(homedir(), ".clawdbot", "claw-mem.json"),
      ]

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const raw = await readFile(path, "utf-8")
      return JSON.parse(raw) as Record<string, unknown>
    } catch (error) {
      throw new Error(`Failed to read config ${path}: ${String(error)}`)
    }
  }
  return {}
}

function createConsoleLogger(): PluginLogger {
  const fmt = (level: string, msg: string) => `[claw-mem ${level}] ${msg}`
  return {
    info: (msg: string) => console.error(fmt("info", msg)),
    warn: (msg: string) => console.error(fmt("warn", msg)),
    error: (msg: string) => console.error(fmt("error", msg)),
    debug: (msg: string) => process.env.CLAW_MEM_DEBUG ? console.error(fmt("debug", msg)) : undefined,
  }
}
