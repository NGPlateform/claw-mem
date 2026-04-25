// Construct the claw-mem service graph. Used by both the standalone CLI
// (`bin/claw-mem`) and by the OpenClaw plugin `activate()` path.
//
// `bootstrapServicesSync` is **synchronous** so it can run inside a plugin
// host that requires `activate()` to register hooks/tools before returning.
// The async wrapper is retained for API compatibility with callers that used
// to await it.
//
// The `memoryOnly` option returns a narrower `MemoryServices` shape — only
// the memory-layer stores, plus config + logger + db. The heavy node /
// backup / recovery / carrier stack is skipped entirely. This is what the
// thin claw-mem OpenClaw plugin uses; the coc-node and coc-soul plugins own
// those subsystems.

import { mkdirSync, existsSync, readFileSync } from "node:fs"
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
import { NodeManager, ProcessManager, StorageQuotaManager } from "@chainofclaw/node"
import { BackupManager, RecoveryManager, CarrierManager } from "@chainofclaw/soul"
import { BootstrapManager } from "../services/bootstrap-manager.ts"
import type { CliServices } from "./register-all.ts"

/**
 * Subset returned when `memoryOnly: true`. Contains only the SQLite-backed
 * memory layer stores plus configuration. No node manager, no backup stack.
 */
export interface MemoryServices {
  config: ClawMemConfig
  logger: PluginLogger
  db: Database
  dbPath: string
  dataDir: string
  observationStore: ObservationStore
  summaryStore: SummaryStore
  sessionStore: SessionStore
  searchEngine: SearchEngine
}

export interface BootstrapServicesOptions {
  configPath?: string
  configOverride?: Record<string, unknown>
  logger?: PluginLogger
  /**
   * When true, skip constructing the node / backup / recovery / carrier
   * managers and return a narrower `MemoryServices` object. Used by the
   * thin claw-mem OpenClaw plugin. Defaults to false.
   */
  memoryOnly?: boolean
}

export function bootstrapServicesSync(opts: BootstrapServicesOptions & { memoryOnly: true }): MemoryServices
export function bootstrapServicesSync(opts?: BootstrapServicesOptions & { memoryOnly?: false }): CliServices
export function bootstrapServicesSync(opts?: BootstrapServicesOptions): CliServices | MemoryServices
export function bootstrapServicesSync(opts: BootstrapServicesOptions = {}): CliServices | MemoryServices {
  const logger = opts.logger ?? createConsoleLogger()
  const diskConfig = loadConfigFileSync(opts.configPath)
  // Deep-merge so OpenClaw's pluginConfig (passed via configOverride) can layer
  // on top of user-persisted ~/.claw-mem/config.json. Prior behavior used `??`,
  // which skipped the disk file entirely whenever configOverride was defined
  // (even `{}`), so `coc config set` writes were invisible to the next process.
  const rawConfig = opts.configOverride
    ? deepMerge(diskConfig, opts.configOverride)
    : diskConfig
  const config = ClawMemConfigSchema.parse(rawConfig)

  const dataDir = resolveDataDir(config)
  try {
    mkdirSync(dataDir, { recursive: true })
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err)
    throw new Error(
      `[claw-mem] could not create data dir at ${dataDir} (${cause}). ` +
        `Fix: set one of:\n` +
        `  • config.dataDir (per-instance plugin config)\n` +
        `  • CLAW_MEM_DATA_DIR=<absolute writable dir> (operator override)\n` +
        `  • OPENCLAW_STATE_DIR=<writable dir> (OpenClaw's standard state-dir convention)\n` +
        `  • mount a writable filesystem at ~/.claw-mem`,
    )
  }

  const dbPath = resolveDbPath(config)
  const db = new Database(dbPath)
  db.openSync()

  const observationStore = new ObservationStore(db)
  const summaryStore = new SummaryStore(db)
  const sessionStore = new SessionStore(db)
  const searchEngine = new SearchEngine(db)

  if (opts.memoryOnly) {
    const memOnly: MemoryServices = {
      config,
      logger,
      db,
      dbPath,
      dataDir,
      observationStore,
      summaryStore,
      sessionStore,
      searchEngine,
    }
    return memOnly
  }

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
    nodeRegistry: nodeStore,
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
    dataDir,
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

/** Async wrapper for legacy callers. Prefer `bootstrapServicesSync`. */
export async function bootstrapServices(opts: BootstrapServicesOptions & { memoryOnly: true }): Promise<MemoryServices>
export async function bootstrapServices(opts?: BootstrapServicesOptions & { memoryOnly?: false }): Promise<CliServices>
export async function bootstrapServices(opts?: BootstrapServicesOptions): Promise<CliServices | MemoryServices>
// eslint-disable-next-line @typescript-eslint/require-await
export async function bootstrapServices(opts: BootstrapServicesOptions = {}): Promise<CliServices | MemoryServices> {
  return bootstrapServicesSync(opts)
}

function loadConfigFileSync(explicit?: string): Record<string, unknown> {
  const candidates = explicit
    ? [explicit]
    : [
        join(homedir(), ".claw-mem", "config.json"),
        join(homedir(), ".clawdbot", "claw-mem.json"),
      ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const raw = readFileSync(path, "utf-8")
      return JSON.parse(raw) as Record<string, unknown>
    } catch (error) {
      throw new Error(`Failed to read config ${path}: ${String(error)}`)
    }
  }
  return {}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value)
    } else {
      out[key] = value
    }
  }
  return out
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
