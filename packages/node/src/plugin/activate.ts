// @chainofclaw/node OpenClaw plugin — activate() body.
//
// Constructs the NodeManager stack (registry + process manager + storage quota
// manager) from api.pluginConfig, registers agent tools (`coc-node-*`), mounts
// the CLI under `coc-node …`, and attaches a best-effort gateway_stop hook.

import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { Command } from "commander"

import { JsonNodeRegistry } from "../json-registry.ts"
import { NodeManager } from "../node-manager.ts"
import { ProcessManager } from "../process-manager.ts"
import { StorageQuotaManager } from "../storage-quota-manager.ts"
import type { NodeLifecycleConfig } from "../types.ts"
import { registerNodeCommands } from "../cli/node-commands.ts"
import { registerNodeTools } from "./tools.ts"
import type { PluginApi } from "./types.ts"

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function mergeConfig(
  defaults: NodeLifecycleConfig,
  override: Record<string, unknown>,
): NodeLifecycleConfig {
  // Shallow-layer merge of the three nested sections that NodeLifecycleConfig
  // owns; preserves the invariant that NodeManager always sees fully-populated
  // `node` and `storage` blocks even when the host passes sparse overrides.
  const nodeSection = isPlainObject(override.node)
    ? { ...defaults.node, ...override.node } as NodeLifecycleConfig["node"]
    : defaults.node
  const storageSection = isPlainObject(override.storage)
    ? { ...defaults.storage, ...override.storage } as NodeLifecycleConfig["storage"]
    : defaults.storage
  const bootstrapSection = isPlainObject(override.bootstrap)
    ? { ...defaults.bootstrap, ...override.bootstrap } as NodeLifecycleConfig["bootstrap"]
    : defaults.bootstrap
  const dataDir = typeof override.dataDir === "string" && override.dataDir.length > 0
    ? override.dataDir
    : defaults.dataDir

  return {
    node: nodeSection,
    storage: storageSection,
    bootstrap: bootstrapSection,
    dataDir,
  }
}

export function activate(api: PluginApi): void {
  const logger = api.logger
  logger.info("[coc-node] Loading...")

  const config = mergeConfig(defaultConfig(), (api.pluginConfig ?? {}) as Record<string, unknown>)
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

  registerNodeTools(api, { nodeManager, logger })

  if (api.registerCli) {
    api.registerCli(
      async ({ program }) => {
        const node = (program as Command)
          .command("coc-node")
          .description("COC node lifecycle")
        registerNodeCommands(node, { nodeManager, logger })
      },
      { commands: ["coc-node"] },
    )
  }

  if (api.registerHook) {
    // Deliberately minimal: users control node lifecycle explicitly via the
    // CLI / tools. We record the list of tracked nodes on shutdown so logs
    // explain the handoff but we never stop running nodes automatically.
    api.registerHook("gateway_stop", async () => {
      try {
        const nodes = nodeManager.listNodes()
        logger.info(
          `[coc-node] gateway_stop: leaving ${nodes.length} node(s) as-is; stop them explicitly with "coc-node node stop"`,
        )
      } catch (error) {
        logger.warn(`[coc-node] gateway_stop log failed: ${String(error)}`)
      }
    })
  }

  logger.info(`[coc-node] Loaded (${nodeManager.listNodes().length} node(s) tracked)`)
}
