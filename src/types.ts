// Core types for claw-mem semantic memory system

export interface Observation {
  id: number
  sessionId: string
  agentId: string
  type: ObservationType
  title: string
  facts: string[]
  narrative: string | null
  concepts: string[]
  filesRead: string[]
  filesModified: string[]
  toolName: string | null
  promptNumber: number
  tokenEstimate: number
  contentHash: string
  createdAt: string
  createdAtEpoch: number
}

export type ObservationType =
  | "discovery"
  | "decision"
  | "pattern"
  | "learning"
  | "issue"
  | "change"
  | "explanation"

export const OBSERVATION_TYPES: readonly ObservationType[] = [
  "discovery", "decision", "pattern", "learning", "issue", "change", "explanation",
] as const

export interface SessionSummary {
  id: number
  sessionId: string
  agentId: string
  request: string | null
  investigated: string | null
  learned: string | null
  completed: string | null
  nextSteps: string | null
  notes: string | null
  observationCount: number
  tokenEstimate: number
  createdAt: string
  createdAtEpoch: number
}

export interface ObservationInput {
  sessionId: string
  agentId: string
  type: ObservationType
  title: string
  facts: string[]
  narrative: string | null
  concepts: string[]
  filesRead: string[]
  filesModified: string[]
  toolName: string | null
  promptNumber: number
}

export interface SummaryInput {
  sessionId: string
  agentId: string
  request: string | null
  investigated: string | null
  learned: string | null
  completed: string | null
  nextSteps: string | null
  notes: string | null
  observationCount: number
}

export interface SearchResult {
  source: "fts" | "like"
  results: Observation[]
  totalCount: number
}

export interface MemoryContext {
  markdown: string
  tokensUsed: number
  observationCount: number
  summaryCount: number
}

export interface SessionState {
  sessionId: string
  agentId: string
  startedAt: string
  promptCount: number
  observationCount: number
  lastToolName: string | null
}

// OpenClaw plugin API types (minimal interface for type safety without importing openclaw)
export interface PluginApi {
  pluginConfig?: Record<string, unknown>
  logger: PluginLogger
  registerTool(tool: ToolDefinition): void
  registerHook?(event: string, handler: (...args: unknown[]) => Promise<void>): void
  on?(hookName: string, handler: (...args: unknown[]) => Promise<unknown>, opts?: { priority?: number }): void
  registerCli?(callback: (ctx: { program: unknown }) => Promise<void>, opts?: { commands: string[] }): void
  registerService?(service: { id: string; start(): Promise<void>; stop(): Promise<void> }): void
}

export interface PluginLogger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
  debug?(msg: string): void
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(params: Record<string, unknown>): Promise<Record<string, unknown>>
}
