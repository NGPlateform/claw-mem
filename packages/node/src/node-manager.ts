// Multi-node lifecycle manager for COC blockchain instances.
//
// Migrated from COC/extensions/coc-nodeops/src/runtime/node-manager.ts.
// Persistence goes through a small NodeRegistry port — the umbrella
// @chainofclaw/claw-mem package injects its SQLite-backed NodeStore; the
// shipped JsonNodeRegistry default is used by the standalone coc-node CLI.

import crypto from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Wallet } from "ethers"

import type {
  Logger,
  NodeEntry,
  NodeLifecycleConfig,
  NodeRegistry,
} from "./types.ts"
import { ProcessManager, type CocProcessConfig } from "./process-manager.ts"
import { rpcCall } from "./rpc-client.ts"
import type { StorageQuotaManager } from "./storage-quota-manager.ts"
import {
  type NetworkId,
  type NodeType,
  NETWORK_PRESETS,
  NODE_TYPE_PRESETS,
} from "./presets.ts"
import { checkCocRepo, describeCocRepoCheck } from "./paths.ts"

export type { NodeType, NetworkId, NodeEntry }

export interface NodeStatus {
  name: string
  running: boolean
  pid?: number
  blockHeight?: number
  peerCount?: number
  bftActive?: boolean
  services: Record<string, { running: boolean; pid?: number }>
}

export interface InstallOptions {
  type: NodeType
  network: NetworkId
  name?: string
  rpcPort?: number
  dataDir?: string
  customChainId?: number
  customBootstrapPeers?: string[]
  /** Extra fields merged into the generated node-config.json (e.g. PoSe contract address). */
  configOverrides?: Record<string, unknown>
  /** Override per-install advertised storage bytes; defaults to config.storage.advertisedBytes. */
  advertisedBytes?: number
}

export interface InstallResult {
  name: string
  type: NodeType
  network: NetworkId
  dataDir: string
  configPath: string
  services: ("node" | "agent" | "relayer")[]
  advertisedBytes: number
  rpcPort: number
}

export interface NodeManagerOptions {
  /** CRUD port for node records. SQLite-backed in claw-mem; JSON-backed in standalone coc-node. */
  nodeRegistry: NodeRegistry
  processManager: ProcessManager
  config: NodeLifecycleConfig
  logger: Logger
  baseDir: string
  /** Optional. When provided, install enforces the storage quota and refreshes the reservation. */
  storageQuotaManager?: StorageQuotaManager
}

export class NodeManager {
  private readonly nodeRegistry: NodeRegistry
  private readonly processManager: ProcessManager
  private readonly config: NodeLifecycleConfig
  private readonly logger: Logger
  private readonly baseDir: string
  private readonly quotaManager?: StorageQuotaManager

  constructor(opts: NodeManagerOptions) {
    this.nodeRegistry = opts.nodeRegistry
    this.processManager = opts.processManager
    this.config = opts.config
    this.logger = opts.logger
    this.baseDir = opts.baseDir
    this.quotaManager = opts.storageQuotaManager
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    await mkdir(join(this.baseDir, "nodes"), { recursive: true })
    if (this.nodeRegistry.init) {
      await this.nodeRegistry.init()
    }
    if (this.quotaManager) {
      try {
        await this.quotaManager.ensureReserved()
      } catch (error) {
        this.logger.warn(`Quota reservation failed: ${String(error)}`)
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // Read API
  // ────────────────────────────────────────────────────────────

  listNodes(): readonly NodeEntry[] {
    return this.nodeRegistry.list()
  }

  getNode(name: string): NodeEntry | undefined {
    return this.nodeRegistry.get(name) ?? undefined
  }

  nodeDir(name: string): string {
    return join(this.baseDir, "nodes", name)
  }

  // ────────────────────────────────────────────────────────────
  // Install
  // ────────────────────────────────────────────────────────────

  /**
   * Install a new node: builds node-config.json, generates the operator key,
   * and registers the entry in NodeStore. Non-interactive.
   */
  async install(opts: InstallOptions): Promise<InstallResult> {
    const preset = NODE_TYPE_PRESETS[opts.type]
    if (!preset) throw new Error(`Unknown node type: ${opts.type}`)

    const name = opts.name && opts.name.length > 0
      ? opts.name
      : generateDefaultName(opts.type, this.listNodes())

    if (this.nodeRegistry.get(name)) {
      throw new Error(`Node "${name}" already exists`)
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error("Name must be alphanumeric with dashes/underscores")
    }

    const nodeDir = opts.dataDir ?? this.nodeDir(name)
    const networkPreset = opts.network !== "custom" ? NETWORK_PRESETS[opts.network] : undefined
    const rpcPort = opts.rpcPort ?? networkPreset?.rpcPort ?? this.config.node.port

    const advertisedBytes = opts.advertisedBytes ?? this.config.storage.advertisedBytes

    // Enforce minimum P2P contribution requirement (256 MiB by default).
    if (advertisedBytes < 268_435_456) {
      throw new Error(
        `advertisedBytes ${advertisedBytes} is below the COC P2P minimum (256 MiB = 268435456). ` +
          "Increase storage.advertisedBytes or pass --advertised-bytes 268435456.",
      )
    }

    // Enforce local quota (skipped if no quota manager wired up).
    if (this.quotaManager) {
      // We don't yet know how big the install will be; charge "0" against the
      // current usage which still catches the case where the quota is already
      // exceeded by other nodes.
      await this.quotaManager.assertCanAdd(0)
    }

    // Pre-check COC repo location: warn (don't fail) at install — start will
    // hard-fail later. This way users discover the issue at install time,
    // before they've invested in node-config edits.
    const repoCheck = checkCocRepo({
      cocRepoPath: this.config.bootstrap.cocRepoPath ?? this.config.node.runtimeDir,
    })
    if (!repoCheck.ok) {
      this.logger.warn(`[node install] ${describeCocRepoCheck(repoCheck)}`)
    }

    // Build node-config.json
    const nodeConfig = this.buildNodeConfig({
      name,
      nodeDir,
      type: opts.type,
      network: opts.network,
      rpcPort,
      customChainId: opts.customChainId,
      customBootstrapPeers: opts.customBootstrapPeers,
      configOverrides: opts.configOverrides,
      advertisedBytes,
    })

    // Materialize on disk (key + config + logs dir)
    await mkdir(nodeDir, { recursive: true })
    const nodeKey = "0x" + crypto.randomBytes(32).toString("hex")
    const keyPath = join(nodeDir, "node-key")
    await writeFile(keyPath, nodeKey + "\n", { mode: 0o600 })

    // Replace nodeId with the derived ETH address (matches DHT/P2P identity)
    const wallet = new Wallet(nodeKey)
    const nodeAddress = wallet.address.toLowerCase()
    nodeConfig.nodeId = nodeAddress

    // Align validators with the replaced nodeId for dev/validator types so
    // chain-engine.expectedProposer() == nodeId (consensus gate never matches
    // otherwise, and the node never proposes a block). buildNodeConfig wrote
    // validators=[opts.name] without knowing the wallet address — fix here.
    if (opts.type === "validator" || opts.type === "dev") {
      nodeConfig.validators = [nodeAddress]
    }

    const configPath = join(nodeDir, "node-config.json")
    await writeFile(configPath, JSON.stringify(nodeConfig, null, 2))

    await mkdir(join(nodeDir, "logs"), { recursive: true })

    // Persist to NodeStore
    this.nodeRegistry.upsert({
      name,
      type: opts.type,
      network: opts.network,
      dataDir: nodeDir,
      services: [...preset.services],
      advertisedBytes,
      rpcPort,
      configPath,
    })

    this.logger.info(`Node "${name}" installed at ${nodeDir} (${preset.services.join(",")})`)
    this.quotaManager?.invalidateCache()

    return {
      name,
      type: opts.type,
      network: opts.network,
      dataDir: nodeDir,
      configPath,
      services: [...preset.services],
      advertisedBytes,
      rpcPort,
    }
  }

  buildNodeConfig(opts: {
    name: string
    nodeDir: string
    type: NodeType
    network: NetworkId
    rpcPort: number
    customChainId?: number
    customBootstrapPeers?: string[]
    configOverrides?: Record<string, unknown>
    advertisedBytes: number
  }): Record<string, unknown> {
    const preset = NODE_TYPE_PRESETS[opts.type]
    const networkPreset = opts.network !== "custom" ? NETWORK_PRESETS[opts.network] : undefined
    const chainId = opts.customChainId ?? networkPreset?.chainId ?? 18780
    const p2pPort = networkPreset?.p2pPort ?? 19780
    const wirePort = networkPreset?.wirePort ?? 19781
    const wsPort = networkPreset?.wsPort ?? 18781
    const ipfsPort = networkPreset?.ipfsPort ?? 5001

    let peers: Array<{ id: string; url: string }> = []
    if (opts.customBootstrapPeers && opts.customBootstrapPeers.length > 0) {
      peers = opts.customBootstrapPeers
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
        .map((url, i) => ({ id: `peer-${i + 1}`, url }))
    } else if (networkPreset) {
      peers = networkPreset.bootstrapPeers
    }

    const dhtBootstrapPeers = networkPreset?.dhtBootstrapPeers ?? []

    const nodeConfig: Record<string, unknown> = {
      dataDir: opts.nodeDir,
      nodeId: opts.name,
      chainId,
      rpcBind: this.config.node.bind,
      rpcPort: opts.rpcPort,
      wsBind: this.config.node.bind,
      wsPort,
      ipfsBind: this.config.node.bind,
      ipfsPort,
      p2pBind: this.config.node.bind,
      p2pPort,
      wireBind: this.config.node.bind,
      wirePort,
      peers,
      dhtBootstrapPeers,
      blockTimeMs: 3000,
      syncIntervalMs: 5000,
      finalityDepth: 3,
      maxTxPerBlock: 50,
      minGasPriceWei: "1",
      // Non-consensus claw-mem extension: declares P2P storage capacity.
      // The COC node layer ignores this today; future versions will broadcast
      // it via the wire handshake. The 256 MiB minimum is enforced at the
      // claw-mem config layer (StorageQuotaManager).
      advertisedStorageBytes: opts.advertisedBytes,
      ...preset.configOverrides,
    }

    if (opts.type === "validator" || opts.type === "dev") {
      nodeConfig.validators = [opts.name]
    } else if (networkPreset?.validators?.length) {
      // Non-validator nodes joining an existing network need the upstream's
      // validator set to verify incoming blocks.
      nodeConfig.validators = networkPreset.validators
    }

    // Genesis prefund: if the network preset declares one and the node-type
    // preset didn't already set one (dev has a hardcoded prefund), propagate
    // it into node-config.json. Required to match upstream genesis stateRoot.
    if (networkPreset?.prefund?.length && !("prefund" in nodeConfig)) {
      nodeConfig.prefund = networkPreset.prefund
    }

    if (opts.configOverrides) {
      Object.assign(nodeConfig, opts.configOverrides)
    }

    return nodeConfig
  }

  // ────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────

  async startNode(name: string): Promise<void> {
    const node = this.requireNode(name)

    // Hard-check the COC repo before spawning. Without it, the spawn fails
    // with an opaque ENOENT — the wrapped message tells the user how to fix.
    const repoCheck = checkCocRepo({
      cocRepoPath: this.config.bootstrap.cocRepoPath ?? this.config.node.runtimeDir,
    })
    if (!repoCheck.ok) {
      throw new Error(`[node start] ${describeCocRepoCheck(repoCheck)}`)
    }

    const processConfig = this.buildProcessConfig(node)
    for (const service of node.services as ("node" | "agent" | "relayer")[]) {
      await this.processManager.start(service, processConfig)
    }
  }

  async stopNode(name: string): Promise<void> {
    const node = this.requireNode(name)
    const reversed = [...node.services].reverse() as ("node" | "agent" | "relayer")[]
    for (const service of reversed) {
      await this.processManager.stop(service, node.dataDir).catch(() => {})
    }
  }

  async restartNode(name: string): Promise<void> {
    await this.stopNode(name)
    await new Promise((r) => setTimeout(r, 500))
    await this.startNode(name)
  }

  async getNodeStatus(name: string): Promise<NodeStatus> {
    const node = this.requireNode(name)
    const services: Record<string, { running: boolean; pid?: number }> = {}
    let anyRunning = false
    let mainPid: number | undefined

    for (const service of node.services as ("node" | "agent" | "relayer")[]) {
      const st = await this.processManager.status(service, node.dataDir)
      services[service] = st
      if (st.running) {
        anyRunning = true
        if (service === "node") mainPid = st.pid
      }
    }

    const result: NodeStatus = {
      name,
      running: anyRunning,
      pid: mainPid,
      services,
    }

    if (anyRunning) {
      const rpcInfo = await this.queryRpcStatus(node).catch(() => undefined)
      if (rpcInfo) {
        result.blockHeight = rpcInfo.blockHeight
        result.peerCount = rpcInfo.peerCount
        result.bftActive = rpcInfo.bftActive
      }
    }

    return result
  }

  async removeNode(name: string, deleteData: boolean): Promise<boolean> {
    const node = this.nodeRegistry.get(name)
    if (!node) return false

    await this.stopNode(name).catch(() => {})

    if (deleteData) {
      try {
        await rm(node.dataDir, { recursive: true, force: true })
      } catch (err) {
        this.logger.warn(`Failed to delete data dir: ${err}`)
      }
    }

    return this.nodeRegistry.delete(name)
  }

  async getNodeLogs(
    name: string,
    service: "node" | "agent" | "relayer" = "node",
    lines = 50,
  ): Promise<string> {
    const node = this.requireNode(name)
    const content = await this.processManager.readLogs(service, node.dataDir)
    if (!content) return ""
    const allLines = content.split("\n")
    return allLines.slice(-lines).join("\n")
  }

  async getNodeConfig(name: string): Promise<Record<string, unknown>> {
    const node = this.requireNode(name)
    const configPath = join(node.dataDir, "node-config.json")
    const raw = await readFile(configPath, "utf-8")
    return JSON.parse(raw) as Record<string, unknown>
  }

  async updateNodeConfig(name: string, patch: Record<string, unknown>): Promise<void> {
    const current = await this.getNodeConfig(name)
    const updated = { ...current, ...patch }
    const node = this.requireNode(name)
    const configPath = join(node.dataDir, "node-config.json")
    await writeFile(configPath, JSON.stringify(updated, null, 2))
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private requireNode(name: string): NodeEntry {
    const node = this.nodeRegistry.get(name)
    if (!node) throw new Error(`Node "${name}" not found`)
    return node
  }

  private buildProcessConfig(node: NodeEntry): CocProcessConfig {
    const nodeUrl = `http://${this.config.node.bind}:${node.rpcPort}`
    return {
      dataDir: node.dataDir,
      nodePort: node.rpcPort,
      nodeBind: this.config.node.bind,
      agentIntervalMs: this.config.node.agent.intervalMs,
      agentBatchSize: this.config.node.agent.batchSize,
      agentSampleSize: this.config.node.agent.sampleSize,
      relayerIntervalMs: this.config.node.relayer.intervalMs,
      nodeUrl,
      l1RpcUrl: this.config.node.relayer.l1RpcUrl,
      l2RpcUrl: this.config.node.relayer.l2RpcUrl,
      cocRepo: { cocRepoPath: this.config.bootstrap.cocRepoPath ?? this.config.node.runtimeDir },
    }
  }

  private async queryRpcStatus(node: NodeEntry): Promise<{
    blockHeight: number
    peerCount: number
    bftActive: boolean
  } | undefined> {
    const url = `http://${this.config.node.bind === "0.0.0.0" ? "127.0.0.1" : this.config.node.bind}:${node.rpcPort}`
    try {
      const [heightRes, peerRes] = await Promise.all([
        rpcCall(url, "eth_blockNumber", []),
        rpcCall(url, "net_peerCount", []),
      ])
      const blockHeight = typeof heightRes === "string" ? Number.parseInt(heightRes, 16) : 0
      const peerCount = typeof peerRes === "string" ? Number.parseInt(peerRes, 16) : 0
      return { blockHeight, peerCount, bftActive: false }
    } catch {
      return undefined
    }
  }
}

function generateDefaultName(nodeType: NodeType, existing: readonly NodeEntry[]): string {
  const prefix = nodeType === "validator" ? "val" : nodeType === "fullnode" ? "fn" : nodeType
  for (let i = 1; i <= 100; i++) {
    const candidate = `${prefix}-${i}`
    if (!existing.some((n) => n.name === candidate)) return candidate
  }
  return `${prefix}-${Date.now()}`
}
