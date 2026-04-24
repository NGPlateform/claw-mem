// `claw-mem tools list` — list every agent tool the skill exposes.
//
// Trick: replay registerAllTools against a mock PluginApi that only collects
// the ToolDefinitions. Keeps tool definitions co-located with their handlers
// and avoids duplicating a static catalog.

import type { Command } from "commander"

import type { CliServices } from "../register-all.ts"
import type { PluginApi, ToolDefinition } from "../../types.ts"
import { registerAllTools } from "../../tools/index.ts"

export function registerToolsCommand(program: Command, services: CliServices): void {
  const tools = program.command("tools").description("Inspect agent tools exposed by claw-mem")

  tools
    .command("list")
    .description("List every agent tool, grouped by source")
    .option("--json", "Output JSON")
    .option("--with-schema", "Include each tool's parameter schema")
    .action((opts: { json?: boolean; withSchema?: boolean }) => {
      const definitions = collectTools(services)
      if (opts.json) {
        console.log(JSON.stringify(
          definitions.map((d) => ({
            name: d.name,
            description: d.description,
            parameters: opts.withSchema ? d.parameters : undefined,
          })),
          null, 2,
        ))
        return
      }
      console.log(`Registered tools (${definitions.length}):`)
      console.log()
      const groups = groupTools(definitions)
      for (const [group, items] of groups) {
        console.log(`# ${group} (${items.length})`)
        for (const t of items) {
          console.log(`  ${t.name.padEnd(28)} ${truncate(t.description, 80)}`)
          if (opts.withSchema) {
            const required = (t.parameters?.required as string[] | undefined) ?? []
            const props = t.parameters?.properties as Record<string, { type?: string; description?: string }> | undefined
            if (props) {
              for (const [pname, p] of Object.entries(props)) {
                const star = required.includes(pname) ? "*" : " "
                console.log(`     ${star} ${pname.padEnd(16)} ${p.type ?? "?"}  ${p.description ?? ""}`)
              }
            }
          }
        }
        console.log()
      }
    })
}

function collectTools(services: CliServices): ToolDefinition[] {
  const collected: ToolDefinition[] = []
  const mockApi: PluginApi = {
    pluginConfig: services.config as unknown as Record<string, unknown>,
    logger: services.logger,
    registerTool(t: ToolDefinition) { collected.push(t) },
    registerHook() {},
    on() {},
  }
  registerAllTools(mockApi, services)
  return collected
}

function groupTools(defs: ToolDefinition[]): Array<[string, ToolDefinition[]]> {
  const groups = new Map<string, ToolDefinition[]>()
  for (const d of defs) {
    const prefix = d.name.startsWith("mem-") ? "memory"
      : d.name.startsWith("coc-") ? "node"
      : d.name.startsWith("soul-") ? "backup"
      : "other"
    const list = groups.get(prefix) ?? []
    list.push(d)
    groups.set(prefix, list)
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + "…"
}
