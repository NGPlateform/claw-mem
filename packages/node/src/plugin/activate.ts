// @chainofclaw/node OpenClaw plugin — activate() body.
//
// Constructs the NodeManager stack (registry + process manager + storage quota
// manager) from api.pluginConfig, registers agent tools (`coc-node-*`), mounts
// the CLI under `coc-node …`, and attaches a best-effort gateway_stop hook.

import { defaultDataDir, resolveWritableDataDir } from "../writable-dir.ts"
import { checkCocRepo } from "../paths.ts"

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
    // Lazy default — aligned with @chainofclaw/claw-mem and @chainofclaw/soul
    // so all three plugins share one operator-managed root by default.
    dataDir: defaultDataDir(),
  }
}

function humanBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GiB`
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(0)} MiB`
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KiB`
  return `${n} B`
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

  // Resolve the data dir EARLY so EACCES surfaces as an actionable error at
  // activate-time rather than mid-command. Aborts plugin load on failure
  // (the rest of the plugin is useless without a writable registry path).
  let dataDir: string
  try {
    dataDir = resolveWritableDataDir({ candidate: config.dataDir, logger })
  } catch (error) {
    logger.error(`[coc-node] data dir not writable: ${String(error)}`)
    return
  }
  // Reflect the resolved path back into config so downstream consumers
  // (NodeManager, JsonNodeRegistry, StorageQuotaManager) see the same
  // sandbox-safe path. Keeps the `config.dataDir` invariant truthful.
  config.dataDir = dataDir

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

  // ── Status banners — visible at gateway start AND at install probe-load ──
  // Goal: after install, the user can see at a glance what works without any
  // further config, and what they need to set up to unlock more.
  logger.info(`[coc-node] data dir: ${dataDir}`)
  logger.info(
    `[coc-node] storage quota: advertised=${humanBytes(config.storage.advertisedBytes)}, ` +
      `reserved=${humanBytes(config.storage.reservedBytes)}, enforce=${config.storage.enforceQuota}`,
  )

  const tracked = nodeManager.listNodes().length
  logger.info(`[coc-node] tracked nodes: ${tracked}`)

  // Probe for a usable COC source repo so the user knows whether install/start
  // commands will succeed. Read-only commands (list / status / coc-rpc-query
  // against an already-running node) work regardless.
  const cocRepo = checkCocRepo({ cocRepoPath: config.bootstrap.cocRepoPath })
  if (cocRepo.ok && cocRepo.root) {
    logger.info(
      `[coc-node] coc repo: detected at ${cocRepo.root} — install/start commands enabled`,
    )
  } else if (cocRepo.root && cocRepo.missing.length > 0) {
    logger.warn(
      `[coc-node] coc repo: incomplete at ${cocRepo.root} (missing: ${cocRepo.missing.join(", ")}) — ` +
        `run \`npm install\` in contracts/ and \`git submodule update --init\``,
    )
  } else {
    logger.info(
      `[coc-node] coc repo: not detected — read-only mode (list / status / coc-rpc-query work; ` +
        `install / start need bootstrap.cocRepoPath or $COC_REPO_PATH pointing at a COC source clone)`,
    )
  }

  logger.info(`[coc-node] Loaded — ${tracked === 0 ? "no nodes yet, run \`openclaw coc-node node install <name>\` to add one" : `managing ${tracked} node(s)`}`)
  logger.info(
    `[coc-node] CLI is mounted at \`openclaw coc-node ...\`. Standalone \`coc-node\` ` +
      `binary requires \`npm i -g @chainofclaw/node\` separately and is NOT installed by ` +
      `\`openclaw plugins install\`.`,
  )
}
