// Port interfaces for @chainofclaw/node.
//
// The package does not depend on claw-mem's SQLite store or logger; instead
// it accepts small `NodeRegistry` + `Logger` ports from the caller. The
// umbrella package (@chainofclaw/claw-mem) supplies a SQLite-backed
// NodeStore as the NodeRegistry; standalone callers (coc-node bin) use the
// shipped `JsonNodeRegistry` default.

// ──────────────────────────────────────────────────────────────────────────
// Logger
// ──────────────────────────────────────────────────────────────────────────

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
  debug?(msg: string): void
}

// ──────────────────────────────────────────────────────────────────────────
// Node entry record — shape shared with claw-mem's SQLite store.
// ──────────────────────────────────────────────────────────────────────────

export interface NodeEntry {
  name: string
  type: string
  network: string
  dataDir: string
  services: string[]
  advertisedBytes: number
  rpcPort: number
  configPath: string | null
  createdAt: string
  createdAtEpoch: number
  updatedAt: string | null
  updatedAtEpoch: number | null
}

export interface NodeEntryInput {
  name: string
  type: string
  network: string
  dataDir: string
  services: string[]
  advertisedBytes?: number
  rpcPort: number
  configPath?: string | null
}

// ──────────────────────────────────────────────────────────────────────────
// NodeRegistry port — CRUD for node records, backed by SQLite (claw-mem) or
// a JSON file (default JsonNodeRegistry shipped with this package).
// ──────────────────────────────────────────────────────────────────────────

export interface NodeRegistry {
  /** Optional one-time bootstrap (e.g. ensure disk file exists). */
  init?(): Promise<void> | void
  list(): readonly NodeEntry[]
  get(name: string): NodeEntry | null
  upsert(input: NodeEntryInput): NodeEntry
  /**
   * Delete a node row. Returns true if a row was removed, false if no row
   * existed for the given name.
   */
  delete(name: string): boolean
}

// ──────────────────────────────────────────────────────────────────────────
// NodeLifecycleConfig — slice of the umbrella ClawMemConfig that the node
// package actually reads. Duplicated here (shape-identical) so the package
// does not import claw-mem's config module.
// ──────────────────────────────────────────────────────────────────────────

export interface NodeAgentLifecycleConfig {
  enabled: boolean
  intervalMs: number
  batchSize: number
  sampleSize: number
}

export interface NodeRelayerLifecycleConfig {
  enabled: boolean
  intervalMs: number
  l1RpcUrl?: string
  l2RpcUrl?: string
}

export interface NodeBlockLifecycleConfig {
  enabled: boolean
  runtimeDir?: string
  defaultType: "validator" | "fullnode" | "archive" | "gateway" | "dev"
  defaultNetwork: "testnet" | "mainnet" | "local" | "custom"
  port: number
  bind: string
  agent: NodeAgentLifecycleConfig
  relayer: NodeRelayerLifecycleConfig
  autoAdvertiseStorage: boolean
}

export interface NodeStorageLifecycleConfig {
  quotaBytes: number
  advertisedBytes: number
  reservedBytes: number
  enforceQuota: boolean
  reserveFile: string
}

export interface NodeBootstrapLifecycleConfig {
  cocRepoPath?: string
}

export interface NodeLifecycleConfig {
  node: NodeBlockLifecycleConfig
  storage: NodeStorageLifecycleConfig
  bootstrap: NodeBootstrapLifecycleConfig
  /** Absolute path to the per-user data directory (e.g. ~/.claw-mem). */
  dataDir?: string
}
