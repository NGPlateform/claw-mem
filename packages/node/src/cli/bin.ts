// coc-node — standalone CLI for @chainofclaw/node.
//
// Loads config from ~/.chainofclaw/config.json (or falls back to schema
// defaults), constructs NodeManager + JsonNodeRegistry + console logger,
// and mounts registerNodeCommands at the top level. This is intentionally
// minimal — full bootstrap/memory/backup flows live in @chainofclaw/claw-mem.

import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { Command } from "commander"

import { JsonNodeRegistry } from "../json-registry.ts"
import { NodeManager } from "../node-manager.ts"
import { ProcessManager } from "../process-manager.ts"
import { StorageQuotaManager } from "../storage-quota-manager.ts"
import type { Logger, NodeLifecycleConfig } from "../types.ts"
import { registerNodeCommands } from "./node-commands.ts"

function createConsoleLogger(): Logger {
  const fmt = (level: string, msg: string) => `[coc-node ${level}] ${msg}`
  return {
    info: (msg) => console.error(fmt("info", msg)),
    warn: (msg) => console.error(fmt("warn", msg)),
    error: (msg) => console.error(fmt("error", msg)),
    debug: (msg) => (process.env.COC_NODE_DEBUG ? console.error(fmt("debug", msg)) : undefined),
  }
}

function defaultConfig(): NodeLifecycleConfig {
  return {
    node: {
      enabled: true,
      runtimeDir: undefined,
      defaultType: "dev",
      defaultNetwork: "local",
      port: 18780,
      bind: "127.0.0.1",
      agent: { enabled: true, intervalMs: 60_000, batchSize: 5, sampleSize: 2 },
      relayer: { enabled: false, intervalMs: 60_000 },
      autoAdvertiseStorage: true,
    },
    storage: {
      quotaBytes: 268_435_456,
      advertisedBytes: 268_435_456,
      reservedBytes: 268_435_456,
      enforceQuota: true,
      reserveFile: ".quota.reserved",
    },
    bootstrap: {},
    dataDir: join(homedir(), ".chainofclaw"),
  }
}

function loadConfig(): NodeLifecycleConfig {
  const candidates = [
    process.env.COC_NODE_CONFIG,
    join(homedir(), ".chainofclaw", "config.json"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0)

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const raw = readFileSync(path, "utf-8")
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const defaults = defaultConfig()
      // Shallow merge: config file keys override defaults at the top level; nested
      // sections (node/storage/bootstrap) merge via spread.
      return {
        ...defaults,
        ...parsed,
        node: { ...defaults.node, ...(parsed.node as object | undefined) } as NodeLifecycleConfig["node"],
        storage: { ...defaults.storage, ...(parsed.storage as object | undefined) } as NodeLifecycleConfig["storage"],
        bootstrap: { ...defaults.bootstrap, ...(parsed.bootstrap as object | undefined) } as NodeLifecycleConfig["bootstrap"],
      }
    } catch (err) {
      console.error(`[coc-node] Failed to load ${path}: ${String(err)}`)
    }
  }
  return defaultConfig()
}

function main(): void {
  const config = loadConfig()
  const logger = createConsoleLogger()
  const dataDir = config.dataDir ?? join(homedir(), ".chainofclaw")
  mkdirSync(dataDir, { recursive: true })

  const nodeRegistry = new JsonNodeRegistry({ baseDir: dataDir })
  const processManager = new ProcessManager(logger)
  const storageQuotaManager = new StorageQuotaManager({
    config: config.storage,
    logger,
    dataDir,
  })
  const nodeManager = new NodeManager({
    nodeRegistry,
    processManager,
    config,
    logger,
    baseDir: dataDir,
    storageQuotaManager,
  })

  const program = new Command()
  program
    .name("coc-node")
    .description("Manage COC blockchain nodes (standalone CLI for @chainofclaw/node).")
    .version("1.1.6")

  registerNodeCommands(program, { nodeManager, logger })

  program.parseAsync(process.argv).catch((err) => {
    logger.error(String(err))
    process.exit(1)
  })
}

main()
