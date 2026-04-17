import { z } from "zod"
import { join } from "node:path"
import { homedir } from "node:os"

export const ClawMemConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().default("").describe("Data directory (default: ~/.claw-mem)"),
  tokenBudget: z.number().default(8000).describe("Max tokens for context injection"),
  maxObservations: z.number().default(50).describe("Max observations per context window"),
  maxSummaries: z.number().default(10).describe("Max summaries per context window"),
  dedupWindowMs: z.number().default(30_000).describe("Dedup window for identical observations"),
  skipTools: z.array(z.string()).default([
    "TodoWrite", "AskUserQuestion", "Skill",
  ]).describe("Tool names to skip observation capture"),
})

export type ClawMemConfig = z.infer<typeof ClawMemConfigSchema>

export function resolveDataDir(config: ClawMemConfig): string {
  if (config.dataDir) {
    return config.dataDir.startsWith("~")
      ? join(homedir(), config.dataDir.slice(1))
      : config.dataDir
  }
  return join(homedir(), ".claw-mem")
}

export function resolveDbPath(config: ClawMemConfig): string {
  return join(resolveDataDir(config), "claw-mem.db")
}
