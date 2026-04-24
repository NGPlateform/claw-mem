// Public config schemas for @chainofclaw/soul.
//
// These zod schemas own the shape of the `backup.*` and carrier-specific
// keys that appear in the top-level claw-mem config. The umbrella
// @chainofclaw/claw-mem package composes these with its own meta keys.

import { z } from "zod"

// ──────────────────────────────────────────────────────────────────────────
// Carrier — agent-resurrection daemon config
// ──────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────
// Backup — soul backup / recovery config
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

export const BackupConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Source directory to back up (the agent's home). Defaults to ~/.openclaw. */
  sourceDir: z.string().default("~/.openclaw"),
  rpcUrl: z.string().default(""),
  ipfsUrl: z.string().default(""),
  contractAddress: z.string().optional(),
  didRegistryAddress: z.string().optional(),
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

/** Umbrella alias — same zod object, exported under the SDK-wide name. */
export const soulConfigSchema = BackupConfigSchema

export type BackupConfig = z.infer<typeof BackupConfigSchema>
export type CarrierConfig = z.infer<typeof CarrierConfigSchema>
export type BackupSemanticSnapshotConfig = z.infer<typeof BackupSemanticSnapshotSchema>
export type BackupCategoriesConfig = z.infer<typeof BackupCategoriesSchema>
