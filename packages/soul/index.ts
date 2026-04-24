// @chainofclaw/soul — OpenClaw plugin entrypoint.
//
// `activate()` registers the `coc-soul` skill: BackupManager + RecoveryManager
// + CarrierManager, agent tools (soul-*, backup-*, carrier-*), and the
// `coc-soul` CLI subcommand. Every public library symbol that used to live at
// `./src/index.ts` is re-exported here so plain npm consumers keep
// `import { BackupManager } from "@chainofclaw/soul"` working untouched.

export { activate } from "./src/plugin/activate.ts"
export type { PluginApi, PluginLogger, ToolDefinition } from "./src/plugin/types.ts"
export { registerSoulTools, type SoulToolDeps } from "./src/plugin/tools.ts"
export { InMemoryArchiveRepository } from "./src/plugin/in-memory-archive-repository.ts"

// Re-export the full library surface from ./src/index.ts.
export * from "./src/index.ts"
