// Aggregated CLI mounter for @chainofclaw/soul. Consumers who want every
// soul subcommand at once (umbrella claw-mem + coc-soul bin) call this.
// For finer control, import the individual registerXCommands directly.

import type { Command } from "commander"

import type { SoulCommandDeps } from "./commands/deps.ts"
import { registerBackupCommands } from "./commands/backup.ts"
import { registerDidCommands } from "./commands/did.ts"
import { registerGuardianCommands } from "./commands/guardian.ts"
import { registerRecoveryCommands } from "./commands/recovery.ts"
import { registerCarrierCommands } from "./commands/carrier.ts"

export function registerSoulCommands(program: Command, deps: SoulCommandDeps): void {
  registerBackupCommands(program, deps)
  registerDidCommands(program, deps)
  registerGuardianCommands(program, deps)
  registerRecoveryCommands(program, deps)
  registerCarrierCommands(program, deps)
}
