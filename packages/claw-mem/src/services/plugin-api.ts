import type { Command } from "commander"

export interface PluginLogger {
  info(msg: string): void
  error(msg: string): void
  warn(msg: string): void
}

export interface PluginToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(params: any): Promise<any>
}

export type PluginHookName =
  | "stop"
  | "gateway_stop"
  | "session_start"
  | "session_end"
  | "before_prompt_build"
  | "after_tool_call"
  | "message_received"
  | "message_sent"
  | "agent_end"
  | "before_compaction"
  | "after_compaction"

export interface PluginHookEvent {
  // Common identifiers
  agentId?: string
  sessionId?: string
  // Session / compaction lifecycle
  messageCount?: number
  durationMs?: number
  reason?: string
  tokensBeforeCompaction?: number
  tokensAfterCompaction?: number
  // Tool-call hooks
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  result?: { content?: string }
  // Chat hooks (message_received / message_sent)
  text?: string
  content?: unknown
  message?: { role?: string; content?: unknown; text?: string }
  // Prompt-build hook (host may pass the assembled message list)
  messages?: Array<{ role?: string; content?: unknown }>
  userMessage?: string
}

export interface OpenClawPluginApi {
  logger: PluginLogger
  pluginConfig?: unknown
  registerCli(
    handler: (ctx: { program: Command }) => Promise<void> | void,
    options: { commands: string[] },
  ): void
  registerTool(definition: PluginToolDefinition): void
  registerHook?(
    name: PluginHookName,
    handler: (event?: PluginHookEvent) => Promise<void> | void,
  ): void
}
