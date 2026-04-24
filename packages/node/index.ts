// @chainofclaw/node — OpenClaw plugin entrypoint.
//
// `activate()` registers the `coc-node` skill: NodeManager + storage quota
// stack, agent tools (`coc-node-*`), and the `coc-node` CLI subcommand. Every
// public library symbol that used to live at `./src/index.ts` is re-exported
// here so plain npm consumers keep `import { NodeManager } from "@chainofclaw/node"`
// working untouched.

export { activate } from "./src/plugin/activate.ts"
export type { PluginApi, PluginLogger, ToolDefinition } from "./src/plugin/types.ts"
export { registerNodeTools, type NodeToolDeps } from "./src/plugin/tools.ts"

// Re-export the full library surface from ./src/index.ts. Keeping the star
// re-export means adding a new symbol there automatically propagates here.
export * from "./src/index.ts"
