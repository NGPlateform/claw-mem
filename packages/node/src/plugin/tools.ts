// Agent tools for COC node lifecycle.
//
// Migrated from packages/claw-mem/src/tools/node-tools.ts when the plugin
// surface moved out of the claw-mem super-skill. Takes NodeManager + logger
// directly instead of the umbrella CliServices object.

import type { NodeManager } from "../node-manager.ts"
import { runInitWizard } from "../cli/init-wizard.ts"
import { safeRpcQuery } from "../rpc-client.ts"
import type { Logger } from "../types.ts"
import type { PluginApi } from "./types.ts"

export interface NodeToolDeps {
  nodeManager: NodeManager
  logger: Logger
}

export function registerNodeTools(api: PluginApi, deps: NodeToolDeps): void {
  const { nodeManager, logger } = deps

  api.registerTool({
    name: "coc-node-init",
    description: "Initialize a new COC blockchain node instance with specified type and network",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["validator", "fullnode", "archive", "gateway", "dev"],
          description: "Node type",
        },
        network: {
          type: "string",
          enum: ["testnet", "mainnet", "local", "custom"],
          description: "Network to join",
        },
        name: { type: "string", description: "Node name (auto-generated if omitted)" },
        rpcPort: { type: "number", description: "RPC port (default 18780)" },
        dataDir: { type: "string", description: "Custom data directory" },
      },
      required: ["type", "network"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        await nodeManager.init()
        const result = await runInitWizard(nodeManager, {
          type: String(params.type),
          network: String(params.network),
          name: params.name ? String(params.name) : undefined,
          dataDir: params.dataDir ? String(params.dataDir) : undefined,
          rpcPort: params.rpcPort !== undefined ? Number(params.rpcPort) : undefined,
        })
        if (!result) return { success: false, error: "Init wizard returned no result" }
        return { success: true, ...result }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "coc-node-list",
    description: "List all managed COC node instances",
    parameters: { type: "object", properties: {} },
    async execute() {
      try {
        await nodeManager.init()
        const nodes = nodeManager.listNodes()
        return { success: true, nodes }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "coc-node-start",
    description: "Start a COC node (or all nodes if name is omitted)",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Node name (starts all if omitted)" },
      },
    },
    async execute(params: Record<string, unknown>) {
      try {
        await nodeManager.init()
        const started: string[] = []
        const name = params.name ? String(params.name) : undefined
        if (name) {
          await nodeManager.startNode(name)
          started.push(name)
        } else {
          for (const node of nodeManager.listNodes()) {
            await nodeManager.startNode(node.name)
            started.push(node.name)
          }
        }
        return { success: true, started }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "coc-node-stop",
    description: "Stop a COC node (or all nodes if name is omitted)",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Node name (stops all if omitted)" },
      },
    },
    async execute(params: Record<string, unknown>) {
      try {
        await nodeManager.init()
        const stopped: string[] = []
        const name = params.name ? String(params.name) : undefined
        if (name) {
          await nodeManager.stopNode(name)
          stopped.push(name)
        } else {
          const nodes = [...nodeManager.listNodes()].reverse()
          for (const node of nodes) {
            await nodeManager.stopNode(node.name).catch(() => {})
            stopped.push(node.name)
          }
        }
        return { success: true, stopped }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "coc-node-restart",
    description: "Restart a COC node (or all nodes if name is omitted)",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Node name (restarts all if omitted)" },
      },
    },
    async execute(params: Record<string, unknown>) {
      try {
        await nodeManager.init()
        const restarted: string[] = []
        const name = params.name ? String(params.name) : undefined
        if (name) {
          await nodeManager.restartNode(name)
          restarted.push(name)
        } else {
          for (const node of nodeManager.listNodes()) {
            await nodeManager.restartNode(node.name)
            restarted.push(node.name)
          }
        }
        return { success: true, restarted }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "coc-node-status",
    description:
      "Get detailed status for a COC node including block height, peer count, and BFT status from live RPC",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Node name (shows all if omitted)" },
      },
    },
    async execute(params: Record<string, unknown>) {
      try {
        await nodeManager.init()
        const name = params.name ? String(params.name) : undefined
        if (name) {
          const status = await nodeManager.getNodeStatus(name)
          return { success: true, statuses: [status] }
        }
        const nodes = nodeManager.listNodes()
        if (nodes.length === 0) return { success: true, statuses: [], message: "No nodes configured" }
        const statuses = await Promise.all(nodes.map((n) => nodeManager.getNodeStatus(n.name)))
        return { success: true, statuses }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "coc-node-remove",
    description: "Remove a COC node instance and optionally delete its data",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Node name to remove" },
        keepData: { type: "boolean", description: "Keep data directory (default false)", default: false },
      },
      required: ["name"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        await nodeManager.init()
        const name = String(params.name)
        const keepData = Boolean(params.keepData ?? false)
        const removed = await nodeManager.removeNode(name, !keepData)
        return { success: true, removed }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "coc-node-config",
    description: "View or patch a COC node's configuration. Provide patch object to update settings.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Node name" },
        patch: {
          type: "object",
          description: "Config fields to update (omit to view current config)",
          additionalProperties: true,
        },
      },
      required: ["name"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        await nodeManager.init()
        const name = String(params.name)
        const patch = params.patch as Record<string, unknown> | undefined
        if (patch && Object.keys(patch).length > 0) {
          await nodeManager.updateNodeConfig(name, patch)
        }
        const config = await nodeManager.getNodeConfig(name)
        return { success: true, config }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "coc-node-logs",
    description: "Retrieve recent log output from a COC node service",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Node name" },
        service: {
          type: "string",
          enum: ["node", "agent", "relayer"],
          description: "Service to read logs from (default node)",
          default: "node",
        },
        lines: { type: "number", description: "Number of log lines to return (default 50)", default: 50 },
      },
      required: ["name"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        await nodeManager.init()
        const name = String(params.name)
        const service = (params.service ? String(params.service) : "node") as "node" | "agent" | "relayer"
        const lines = Number(params.lines ?? 50)
        const logTail = await nodeManager.getNodeLogs(name, service, lines)
        return { success: true, service, logTail }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "coc-rpc-query",
    description:
      "Query a running COC node via JSON-RPC. Supports chain stats, block info, balances, peer count, BFT status, and more. Only read-only methods are allowed.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Node name (uses first node if omitted)" },
        method: {
          type: "string",
          description:
            "RPC method: eth_blockNumber, eth_getBlockByNumber, eth_getBlockByHash, net_peerCount, coc_chainStats, coc_getBftStatus, eth_getBalance, eth_syncing, eth_getTransactionByHash, eth_getTransactionReceipt, eth_chainId",
        },
        params: {
          type: "array",
          description: "RPC method parameters (e.g. [\"0x1\", true] for eth_getBlockByNumber)",
          items: {},
          default: [],
        },
      },
      required: ["method"],
    },
    async execute(toolParams: Record<string, unknown>) {
      try {
        await nodeManager.init()
        const name = toolParams.name ? String(toolParams.name) : undefined
        const method = String(toolParams.method)
        const rpcParams = (toolParams.params as unknown[]) ?? []

        let dataDir: string
        if (name) {
          const node = nodeManager.getNode(name)
          if (!node) return { success: false, error: `Node "${name}" not found` }
          dataDir = node.dataDir
        } else {
          const nodes = nodeManager.listNodes()
          if (nodes.length === 0) return { success: false, error: "No nodes configured" }
          dataDir = nodes[0].dataDir
        }
        const { result } = await safeRpcQuery(dataDir, method, rpcParams)
        return { success: true, method, result }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  // Touch unused-import lint when debug disabled.
  void logger
}
