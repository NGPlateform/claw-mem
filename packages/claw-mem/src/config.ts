import { z } from "zod"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { existsSync, accessSync, mkdirSync, constants as fsConst } from "node:fs"

import { DEFAULT_CHAT_CUES } from "./observer/extractor-chat.ts"

// ──────────────────────────────────────────────────────────────────────────
// Memory (original claw-mem fields, kept top-level for backward compatibility)
// ──────────────────────────────────────────────────────────────────────────

const MemoryDefaults = {
  tokenBudget: 8000,
  maxObservations: 50,
  maxSummaries: 10,
  dedupWindowMs: 30_000,
  skipTools: ["TodoWrite", "AskUserQuestion", "Skill"],
} as const

// ──────────────────────────────────────────────────────────────────────────
// Storage (256 MiB P2P contribution + local quota enforcement)
// ──────────────────────────────────────────────────────────────────────────

export const StorageConfigSchema = z.object({
  quotaBytes: z.number().int().min(1).default(268_435_456),
  advertisedBytes: z.number().int().min(268_435_456).default(268_435_456),
  reservedBytes: z.number().int().min(0).default(268_435_456),
  enforceQuota: z.boolean().default(true),
  reserveFile: z.string().default(".quota.reserved"),
})

// ──────────────────────────────────────────────────────────────────────────
// Node (COC node lifecycle)
// ──────────────────────────────────────────────────────────────────────────

export const NodeAgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().min(1000).default(60_000),
  batchSize: z.number().int().min(1).default(5),
  sampleSize: z.number().int().min(1).default(2),
})

export const NodeRelayerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  intervalMs: z.number().int().min(1000).default(60_000),
  l1RpcUrl: z.string().optional(),
  l2RpcUrl: z.string().optional(),
})

export const NodeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  runtimeDir: z.string().optional(),
  defaultType: z.enum(["validator", "fullnode", "archive", "gateway", "dev"]).default("dev"),
  defaultNetwork: z.enum(["testnet", "mainnet", "local", "custom"]).default("local"),
  port: z.number().int().min(1).max(65535).default(18780),
  bind: z.string().default("127.0.0.1"),
  agent: NodeAgentConfigSchema.default({}),
  relayer: NodeRelayerConfigSchema.default({}),
  autoAdvertiseStorage: z.boolean().default(true),
})

// ──────────────────────────────────────────────────────────────────────────
// Backup (soul backup / recovery / carrier)
// ──────────────────────────────────────────────────────────────────────────

export const BackupSemanticSnapshotSchema = z.object({
  enabled: z.boolean().default(true),
  tokenBudget: z.number().int().min(0).default(8000),
  maxObservations: z.number().int().min(0).default(50),
  maxSummaries: z.number().int().min(0).default(10),
})

export const BackupCategoriesSchema = z.object({
  identity: z.boolean().default(true),
  config: z.boolean().default(true),
  memory: z.boolean().default(true),
  chat: z.boolean().default(true),
  workspace: z.boolean().default(true),
  database: z.boolean().default(true),
})

export const CarrierPendingRequestSchema = z.object({
  requestId: z.string(),
  agentId: z.string(),
})

export const CarrierConfigSchema = z.object({
  enabled: z.boolean().default(false),
  carrierId: z.string().optional(),
  agentEntryScript: z.string().optional(),
  workDir: z.string().default("/tmp/coc-resurrections"),
  watchedAgents: z.array(z.string()).default([]),
  pendingRequestIds: z.array(CarrierPendingRequestSchema).default([]),
  pollIntervalMs: z.number().int().min(1000).default(60_000),
  readinessTimeoutMs: z.number().int().min(1000).default(86_400_000),
  readinessPollMs: z.number().int().min(1000).default(30_000),
})

export const BackupConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Source directory to back up (the agent's home). Defaults to ~/.openclaw. */
  sourceDir: z.string().default("~/.openclaw"),
  rpcUrl: z.string().default("http://199.192.16.79:28780"),
  ipfsUrl: z.string().default("http://199.192.16.79:28786"),
  contractAddress: z.string().default("0x1291Be112d480055DaFd8a610b7d1e203891C274"),
  didRegistryAddress: z.string().default("0x5f3f1dBD7B74C6B46e8c44f98792A1dAf8d69154"),
  faucetUrl: z.string().default("http://199.192.16.79:3003"),
  rpcAuthToken: z.string().optional(),
  privateKey: z.string().optional(),
  autoBackup: z.boolean().default(true),
  autoBackupIntervalMs: z.number().int().min(1000).default(3_600_000),
  maxIncrementalChain: z.number().int().min(1).default(10),
  encryptMemory: z.boolean().default(false),
  encryptionPassword: z.string().optional(),
  backupOnSessionEnd: z.boolean().default(true),
  semanticSnapshot: BackupSemanticSnapshotSchema.default({}),
  categories: BackupCategoriesSchema.default({}),
  carrier: CarrierConfigSchema.default({}),
})

// ──────────────────────────────────────────────────────────────────────────
// Summarizer (optional LLM-powered session summarizer override)
// ──────────────────────────────────────────────────────────────────────────

export const SummarizerLLMConfigSchema = z.object({
  provider: z.enum(["anthropic"]).default("anthropic"),
  model: z.string().default("claude-sonnet-4-6").describe("Anthropic model ID"),
  apiKey: z.string().optional().describe("Anthropic API key; falls back to ANTHROPIC_API_KEY env"),
  baseURL: z.string().optional().describe("Override API base URL (e.g. a proxy)"),
  maxTokens: z.number().int().min(64).max(8192).default(1024),
  timeoutMs: z.number().int().min(1000).default(30_000),
  fallbackOnError: z.boolean().default(true).describe("Fall back to heuristic summary on LLM failure"),
})

// OpenClaw mode reuses the host's already-configured inference provider via
// `openclaw infer model run --json`. No API key needs to live in claw-mem
// config — auth follows the user's OpenClaw agent profile.
export const SummarizerOpenClawConfigSchema = z.object({
  bin: z.string().default("openclaw").describe("Path to openclaw CLI binary"),
  model: z.string().optional().describe("Model override (provider/model). Empty = let OpenClaw pick the default."),
  timeoutMs: z.number().int().min(1000).default(60_000),
  fallbackOnError: z.boolean().default(true).describe("Fall back to heuristic summary on spawn / parse failure"),
  forceLocal: z.boolean().default(false).describe("Pass --local to openclaw infer model run"),
  forceGateway: z.boolean().default(false).describe("Pass --gateway to openclaw infer model run"),
})

export const SummarizerConfigSchema = z.object({
  mode: z.enum(["heuristic", "llm", "openclaw"]).default("heuristic"),
  llm: SummarizerLLMConfigSchema.default({}),
  openclaw: SummarizerOpenClawConfigSchema.default({}),
})

// ──────────────────────────────────────────────────────────────────────────
// Chat memory (capture from message_received / message_sent hooks)
// ──────────────────────────────────────────────────────────────────────────

export const ChatMemoryCuesSchema = z.object({
  explicit: z.array(z.string()).default([...DEFAULT_CHAT_CUES.explicit])
    .describe("High-priority cues; capture as decision/learning regardless of explicitOnly"),
  preference: z.array(z.string()).default([...DEFAULT_CHAT_CUES.preference])
    .describe("Preference / habit cues; capture as learning when explicitOnly=false"),
})

export const ChatMemoryConfigSchema = z.object({
  enabled: z.boolean().default(true)
    .describe("Capture observations from chat messages (in addition to tool calls)"),
  explicitOnly: z.boolean().default(false)
    .describe("Only capture chat messages that match an explicit cue; suppress preference + plain capture"),
  minLen: z.number().int().min(1).default(8)
    .describe("Drop messages shorter than this many characters as chitchat"),
  cues: ChatMemoryCuesSchema.default({}),
  captureAssistantPromises: z.boolean().default(false)
    .describe("Also capture assistant messages (commitments / decisions). Off by default."),
})

// ──────────────────────────────────────────────────────────────────────────
// Context recall (how before_prompt_build assembles the injected context)
// ──────────────────────────────────────────────────────────────────────────

export const ContextRecallConfigSchema = z.object({
  mode: z.enum(["recent", "hybrid"]).default("hybrid")
    .describe("recent = chronological tail only; hybrid = FTS5 search on the latest user message merged with recent"),
  searchLimitRatio: z.number().min(0).max(1).default(0.5)
    .describe("Fraction of maxObservations to allocate to search hits in hybrid mode (rest is recent)"),
})

// ──────────────────────────────────────────────────────────────────────────
// Bootstrap (dev-mode auto stack)
// ──────────────────────────────────────────────────────────────────────────

export const BootstrapConfigSchema = z.object({
  mode: z.enum(["none", "dev", "prod"]).default("none"),
  hardhatPort: z.number().int().min(1).max(65535).default(8545),
  hardhatNetworkName: z.string().default("claw-mem-local"),
  autoFundEther: z.string().default("0.1"),
  operatorKeyPath: z.string().optional(),
  cocRepoPath: z.string().optional(),
  skipIfReady: z.boolean().default(true),
})

// ──────────────────────────────────────────────────────────────────────────
// Top-level claw-mem config
//
// NOTE: original memory fields stay at the top level for backward
// compatibility — existing consumers (hooks, context builder, mem-status)
// keep reading config.tokenBudget / config.maxObservations / etc.
// ──────────────────────────────────────────────────────────────────────────

export const ClawMemConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().default("").describe("Data directory (default: ~/.claw-mem)"),

  // Memory (original; do not move — breaks downstream)
  tokenBudget: z.number().default(MemoryDefaults.tokenBudget).describe("Max tokens for context injection"),
  maxObservations: z.number().default(MemoryDefaults.maxObservations).describe("Max observations per context window"),
  maxSummaries: z.number().default(MemoryDefaults.maxSummaries).describe("Max summaries per context window"),
  dedupWindowMs: z.number().default(MemoryDefaults.dedupWindowMs).describe("Dedup window for identical observations"),
  skipTools: z.array(z.string()).default([...MemoryDefaults.skipTools]).describe("Tool names to skip observation capture"),

  // New sibling blocks
  storage: StorageConfigSchema.default({}),
  node: NodeConfigSchema.default({}),
  backup: BackupConfigSchema.default({}),
  bootstrap: BootstrapConfigSchema.default({}),
  summarizer: SummarizerConfigSchema.default({}),
  chatMemory: ChatMemoryConfigSchema.default({}),
  contextRecall: ContextRecallConfigSchema.default({}),
})

export type ClawMemConfig = z.infer<typeof ClawMemConfigSchema>
export type StorageConfig = z.infer<typeof StorageConfigSchema>
export type NodeConfig = z.infer<typeof NodeConfigSchema>
export type BackupConfig = z.infer<typeof BackupConfigSchema>
export type BootstrapConfig = z.infer<typeof BootstrapConfigSchema>
export type CarrierConfig = z.infer<typeof CarrierConfigSchema>
export type SummarizerConfig = z.infer<typeof SummarizerConfigSchema>
export type SummarizerLLMConfig = z.infer<typeof SummarizerLLMConfigSchema>
export type SummarizerOpenClawConfig = z.infer<typeof SummarizerOpenClawConfigSchema>
export type ChatMemoryConfig = z.infer<typeof ChatMemoryConfigSchema>
export type ChatMemoryCues = z.infer<typeof ChatMemoryCuesSchema>
export type ContextRecallConfig = z.infer<typeof ContextRecallConfigSchema>

// ──────────────────────────────────────────────────────────────────────────
// Path resolvers
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_DATA_DIR = join(homedir(), ".claw-mem")

function expandTilde(path: string): string {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path
}

function isPathWritable(path: string): boolean {
  let cursor = path
  for (let i = 0; i < 32; i++) {
    if (existsSync(cursor)) {
      try {
        accessSync(cursor, fsConst.W_OK)
        return true
      } catch {
        return false
      }
    }
    const parent = dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
  return false
}

/**
 * Resolve the claw-mem data directory.
 *
 * Priority (highest first):
 *   1. config.dataDir (explicit)
 *   2. process.env.CLAW_MEM_DATA_DIR (operator override)
 *   3. <OPENCLAW_STATE_DIR>/claw-mem (sandbox-managed state dir; the
 *      typical writable path inside OpenClaw)
 *   4. ~/.claw-mem (default for standalone use)
 *
 * The first candidate whose path (or whose closest existing ancestor) is
 * writable wins; mkdirSync at the call site will succeed for it.
 *
 * If none of (1)-(4) are writable, falls back to the default and lets the
 * mkdir at the call site throw an actionable EACCES — that's better than
 * silently picking /tmp, which would be lost on reboot.
 */
export function resolveDataDir(config: ClawMemConfig): string {
  if (config.dataDir && config.dataDir.length > 0) {
    return expandTilde(config.dataDir)
  }
  const envOverride = process.env.CLAW_MEM_DATA_DIR
  if (envOverride && envOverride.length > 0 && isPathWritable(envOverride)) {
    return envOverride
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR
  if (stateDir && stateDir.length > 0) {
    const sandboxDir = join(stateDir, "claw-mem")
    if (isPathWritable(sandboxDir)) return sandboxDir
  }
  return DEFAULT_DATA_DIR
}

export function resolveDbPath(config: ClawMemConfig): string {
  return join(resolveDataDir(config), "claw-mem.db")
}

export function resolveNodesDir(config: ClawMemConfig): string {
  return join(resolveDataDir(config), "nodes")
}

export function resolveBackupDir(config: ClawMemConfig): string {
  return join(resolveDataDir(config), "backup")
}

export function resolveArchivesDir(config: ClawMemConfig): string {
  return join(resolveDataDir(config), "archives")
}

export function resolveLogsDir(config: ClawMemConfig): string {
  return join(resolveDataDir(config), "logs")
}

export function resolveKeysDir(config: ClawMemConfig): string {
  return join(resolveDataDir(config), "keys")
}

export function resolveQuotaReservePath(config: ClawMemConfig): string {
  return join(resolveDataDir(config), config.storage.reserveFile)
}
