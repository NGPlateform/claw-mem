// Mount only the memory-layer subcommands for the thin claw-mem OpenClaw
// plugin. Node / backup / bootstrap / status / doctor etc. live in their own
// plugins (coc-node / coc-soul) or in the standalone `claw-mem` bin.

import type { Command } from "commander"

import type { MemoryServices } from "./bootstrap-services.ts"
import { registerMemCommands } from "./commands/mem.ts"
import { registerConfigCommands } from "./commands/config.ts"
import { registerDbCommands } from "./commands/db.ts"
import { registerVersionCommand } from "./commands/version.ts"

/**
 * Register only the commands that the claw-mem plugin owns after the
 * node/soul split: `mem`, `config`, `db`, and `version`.
 *
 * `status`, `doctor`, `init`, `bootstrap`, `uninstall`, and `tools list`
 * remain in the standalone `bin/claw-mem` binary (they require the full
 * service graph). Users who want those commands inside OpenClaw install
 * the corresponding skill plugin (`@chainofclaw/node`, `@chainofclaw/soul`)
 * or invoke the standalone binary.
 */
export function registerMemOnlyCommands(program: Command, services: MemoryServices): void {
  registerMemCommands(program, services)
  registerDbCommands(program, services)
  registerConfigCommands(program, services)
  registerVersionCommand(program, services)
}
