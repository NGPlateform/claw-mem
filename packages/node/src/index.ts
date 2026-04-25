// @chainofclaw/node — COC blockchain node lifecycle.
//
// Entry point for both the umbrella @chainofclaw/claw-mem package (which
// re-exports everything here) and standalone users who only need node
// management without the memory/soul stacks.

// ── Runtime classes ────────────────────────────────────────────
export { NodeManager, type NodeManagerOptions, type NodeStatus, type InstallOptions, type InstallResult } from "./node-manager.ts"
export { ProcessManager, type CocProcessKind, type CocProcessConfig, type ProcessStatus } from "./process-manager.ts"
export { StorageQuotaManager, QuotaExceededError, type StorageQuotaManagerOptions } from "./storage-quota-manager.ts"

// ── RPC helpers ────────────────────────────────────────────────
export { rpcCall, safeRpcQuery, resolveNodeRpcUrl, ALLOWED_RPC_METHODS, type AllowedRpcMethod } from "./rpc-client.ts"

// ── Presets ────────────────────────────────────────────────────
export {
  NETWORK_PRESETS,
  NETWORK_LABELS,
  NODE_TYPE_PRESETS,
  NODE_TYPE_LABELS,
  getNetworkPreset,
  isValidNetworkId,
  isValidNodeType,
  type NetworkId,
  type NetworkPreset,
  type NodeType,
  type NodeTypePreset,
} from "./presets.ts"

// ── Path resolvers ─────────────────────────────────────────────
export {
  resolveCocRoot,
  resolveRuntimeDir,
  resolveContractsDir,
  resolveNodeEntryScript,
  checkCocRepo,
  describeCocRepoCheck,
  expandTilde,
  looksLikeCocRoot,
  type CocRepoLocator,
  type CocRepoCheck,
} from "./paths.ts"

// ── Registry port + default implementation ─────────────────────
export { JsonNodeRegistry, type JsonNodeRegistryOptions } from "./json-registry.ts"

// ── Sandbox-safe data dir resolution ──────────────────────────
export {
  resolveWritableDataDir,
  isPathWritable,
  DEFAULT_DATA_DIR,
  type ResolveDataDirOptions,
} from "./writable-dir.ts"

// ── CLI ───────────────────────────────────────────────────────
export { registerNodeCommands, type NodeCommandDeps } from "./cli/node-commands.ts"
export { runInitWizard, type InitWizardOptions } from "./cli/init-wizard.ts"

// ── Shared types ───────────────────────────────────────────────
export type {
  Logger,
  NodeEntry,
  NodeEntryInput,
  NodeRegistry,
  NodeLifecycleConfig,
  NodeAgentLifecycleConfig,
  NodeRelayerLifecycleConfig,
  NodeBlockLifecycleConfig,
  NodeStorageLifecycleConfig,
  NodeBootstrapLifecycleConfig,
} from "./types.ts"
