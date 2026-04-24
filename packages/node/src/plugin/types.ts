// Minimal OpenClaw plugin API types for @chainofclaw/node.
//
// Defined locally (structurally identical to the ones in @chainofclaw/claw-mem
// and @chainofclaw/soul) so this package never has to import its downstream
// umbrella — the dependency arrow must point claw-mem → node, not vice versa.

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

export interface PluginApi {
  pluginConfig?: Record<string, unknown>
  logger: PluginLogger
  registerTool(tool: ToolDefinition): void
  registerHook?(event: string, handler: (...args: unknown[]) => Promise<void>): void
  on?(hookName: string, handler: (...args: unknown[]) => Promise<unknown>, opts?: { priority?: number }): void
  registerCli?(callback: (ctx: { program: unknown }) => Promise<void>, opts?: { commands: string[] }): void
  registerService?(service: { id: string; start(): Promise<void>; stop(): Promise<void> }): void
}
