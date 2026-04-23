// Interactive `claw-mem node install` wizard.
// Migrated from COC/extensions/coc-nodeops/src/cli/init-wizard.ts and reduced
// to a thin layer over NodeManager.install — all prompting happens here, all
// disk side-effects happen in NodeManager.

import * as p from "@clack/prompts"

import {
  NETWORK_LABELS,
  NETWORK_PRESETS,
  NODE_TYPE_LABELS,
  NODE_TYPE_PRESETS,
  isValidNetworkId,
  isValidNodeType,
  type NetworkId,
  type NodeType,
} from "../shared/presets.ts"
import type { InstallOptions, InstallResult, NodeManager } from "../services/node-manager.ts"

export interface InitWizardOptions {
  type?: string
  network?: string
  name?: string
  dataDir?: string
  rpcPort?: number
  /** Extra config fields to merge into node-config.json. */
  configOverrides?: Record<string, unknown>
}

export async function runInitWizard(
  manager: NodeManager,
  opts: InitWizardOptions,
): Promise<InstallResult | undefined> {
  const interactive = !opts.type
  if (interactive) p.intro("COC Node Setup")

  const nodeType = await resolveNodeType(opts.type, interactive)
  if (!nodeType) return undefined

  const network = await resolveNetwork(opts.network, interactive)
  if (!network) return undefined

  const name = await resolveName(opts.name, nodeType, manager, interactive)
  if (!name) return undefined

  const networkPreset = network !== "custom" ? NETWORK_PRESETS[network] : undefined
  const defaultRpcPort = opts.rpcPort ?? networkPreset?.rpcPort ?? 18780
  const rpcPort = await resolveRpcPort(opts.rpcPort, defaultRpcPort, interactive)
  if (rpcPort === undefined) return undefined

  let customChainId: number | undefined
  let customBootstrapPeers: string[] | undefined
  if (network === "custom" && interactive) {
    const customs = await collectCustomNetworkParams()
    if (!customs) return undefined
    customChainId = customs.chainId
    customBootstrapPeers = customs.peers
  }

  const installOpts: InstallOptions = {
    type: nodeType,
    network,
    name,
    rpcPort,
    dataDir: opts.dataDir,
    customChainId,
    customBootstrapPeers,
    configOverrides: opts.configOverrides,
  }

  let result: InstallResult
  try {
    result = await manager.install(installOpts)
  } catch (error) {
    const msg = String(error)
    if (interactive) p.cancel(msg)
    else console.error(msg)
    return undefined
  }

  if (interactive) {
    p.note(
      [
        `Type:    ${result.type}`,
        `Network: ${result.network}`,
        `Name:    ${result.name}`,
        `Dir:     ${result.dataDir}`,
        `RPC:     http://127.0.0.1:${result.rpcPort}`,
        `Storage: ${formatBytes(result.advertisedBytes)} advertised`,
        `Config:  ${result.configPath}`,
      ].join("\n"),
      "Node initialized",
    )
    p.outro(`Run "claw-mem node start ${result.name}" to start the node`)
  } else {
    console.log(`Node "${result.name}" initialized at ${result.dataDir}`)
  }

  return result
}

// ────────────────────────────────────────────────────────────
// Prompt helpers
// ────────────────────────────────────────────────────────────

async function resolveNodeType(raw: string | undefined, interactive: boolean): Promise<NodeType | undefined> {
  if (raw) {
    if (!isValidNodeType(raw)) {
      const msg = `Invalid node type: ${raw}`
      if (interactive) p.cancel(msg)
      else console.error(msg)
      return undefined
    }
    return raw
  }
  const result = await p.select({
    message: "Select node type",
    options: (Object.keys(NODE_TYPE_LABELS) as NodeType[]).map((t) => ({
      value: t,
      label: NODE_TYPE_LABELS[t],
      hint: NODE_TYPE_PRESETS[t].services.join(", "),
    })),
  })
  if (p.isCancel(result)) {
    p.cancel("Setup cancelled")
    return undefined
  }
  return result as NodeType
}

async function resolveNetwork(raw: string | undefined, interactive: boolean): Promise<NetworkId | undefined> {
  if (raw) {
    if (!isValidNetworkId(raw)) {
      const msg = `Invalid network: ${raw}`
      if (interactive) p.cancel(msg)
      else console.error(msg)
      return undefined
    }
    return raw
  }
  const result = await p.select({
    message: "Select network",
    options: (Object.keys(NETWORK_LABELS) as NetworkId[]).map((n) => ({
      value: n,
      label: NETWORK_LABELS[n],
    })),
  })
  if (p.isCancel(result)) {
    p.cancel("Setup cancelled")
    return undefined
  }
  return result as NetworkId
}

async function resolveName(
  raw: string | undefined,
  nodeType: NodeType,
  manager: NodeManager,
  interactive: boolean,
): Promise<string | undefined> {
  if (raw) return raw
  const defaultName = generateDefaultName(nodeType, manager)
  if (!interactive) return defaultName

  const result = await p.text({
    message: "Node name",
    defaultValue: defaultName,
    placeholder: defaultName,
    validate: (value) => {
      const v = value.trim() || defaultName
      if (!/^[a-zA-Z0-9_-]+$/.test(v)) {
        return "Name must be alphanumeric with dashes/underscores"
      }
      if (manager.getNode(v)) return `Node "${v}" already exists`
      return undefined
    },
  })
  if (p.isCancel(result)) {
    p.cancel("Setup cancelled")
    return undefined
  }
  return (result as string).trim() || defaultName
}

async function resolveRpcPort(
  raw: number | undefined,
  defaultPort: number,
  interactive: boolean,
): Promise<number | undefined> {
  if (raw !== undefined) return raw
  if (!interactive) return defaultPort

  const result = await p.text({
    message: "RPC port",
    defaultValue: String(defaultPort),
    placeholder: String(defaultPort),
    validate: (value) => {
      const n = Number(value.trim() || defaultPort)
      if (!Number.isInteger(n) || n < 1 || n > 65535) return "Port must be between 1 and 65535"
      return undefined
    },
  })
  if (p.isCancel(result)) {
    p.cancel("Setup cancelled")
    return undefined
  }
  return Number((result as string).trim() || defaultPort)
}

async function collectCustomNetworkParams(): Promise<{ chainId: number; peers: string[] } | undefined> {
  const chainIdResult = await p.text({
    message: "Chain ID",
    defaultValue: "18780",
    placeholder: "18780",
  })
  if (p.isCancel(chainIdResult)) {
    p.cancel("Setup cancelled")
    return undefined
  }
  const chainId = Number((chainIdResult as string).trim() || "18780")

  const peersResult = await p.text({
    message: "Bootstrap peers (comma-separated URLs, or empty)",
    defaultValue: "",
    placeholder: "http://peer1:19780,http://peer2:19780",
  })
  if (p.isCancel(peersResult)) {
    p.cancel("Setup cancelled")
    return undefined
  }
  const peers = (peersResult as string)
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
  return { chainId, peers }
}

function generateDefaultName(nodeType: NodeType, manager: NodeManager): string {
  const prefix = nodeType === "validator" ? "val" : nodeType === "fullnode" ? "fn" : nodeType
  const existing = manager.listNodes()
  for (let i = 1; i <= 100; i++) {
    const candidate = `${prefix}-${i}`
    if (!existing.some((n) => n.name === candidate)) return candidate
  }
  return `${prefix}-${Date.now()}`
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GiB`
  return `${Math.round(mb)} MiB`
}
