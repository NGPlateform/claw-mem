// Entry point for the standalone `claw-mem` CLI binary.
// Invoked via `bin/claw-mem` (a shell shim that runs node with
// --experimental-strip-types so this .ts file can be imported directly).

import { Command } from "commander"

import { bootstrapServices } from "./bootstrap-services.ts"
import { registerAllCommands } from "./register-all.ts"

async function main(): Promise<void> {
  const program = new Command()
    .name("claw-mem")
    .description(
      "OpenClaw super-skill: persistent memory + COC node lifecycle + soul backup",
    )
    .option("--config <path>", "Path to claw-mem config JSON")
    .helpOption("-h, --help", "Show help")

  // Pre-parse to extract --config without consuming subcommand args.
  program.allowUnknownOption(true)
  program.parseOptions(process.argv)
  const opts = program.opts<{ config?: string }>()
  program.allowUnknownOption(false)

  const services = await bootstrapServices({ configPath: opts.config })

  registerAllCommands(program, services)

  try {
    await program.parseAsync(process.argv)
  } finally {
    services.db.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
