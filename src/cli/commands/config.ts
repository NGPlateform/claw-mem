// `claw-mem config get/set/list` — dot-path read/write of ~/.claw-mem/config.json.
//
// The same file is loaded at startup by bootstrapServices(), so changes made
// here take effect on the next process invocation. Within a single process
// the in-memory config is not mutated.

import type { Command } from "commander"

import type { CliServices } from "../register-all.ts"
import {
  DEFAULT_CONFIG_PATH,
  coerceScalar,
  getDotPath,
  patchConfigFile,
  readConfigFile,
  setDotPath,
} from "@chainofclaw/soul"

export function registerConfigCommands(program: Command, services: CliServices): void {
  const { config: liveConfig } = services
  const cfg = program.command("config").description("Read and modify the persisted claw-mem config (~/.claw-mem/config.json)")

  cfg
    .command("get <path>")
    .description('Read a value via dot-path (e.g. "storage.quotaBytes" or "node.port")')
    .option("--json", "Output the value as JSON")
    .option("--from-disk", "Read from the on-disk config (default: in-memory)")
    .action(async (path: string, opts: { json?: boolean; fromDisk?: boolean }) => {
      const source = opts.fromDisk ? await readConfigFile(DEFAULT_CONFIG_PATH) : liveConfig
      const value = getDotPath(source as Record<string, unknown>, path)
      if (value === undefined) {
        console.log("(undefined)")
        return
      }
      if (opts.json) {
        console.log(JSON.stringify(value, null, 2))
      } else if (typeof value === "object") {
        console.log(JSON.stringify(value, null, 2))
      } else {
        console.log(String(value))
      }
    })

  cfg
    .command("set <path> <value>")
    .description("Write a value to the on-disk config (does not affect the running process)")
    .option("--json", "Treat <value> as JSON (numbers, booleans, arrays, objects)")
    .action(async (path: string, value: string, opts: { json?: boolean }) => {
      const parsed: unknown = opts.json ? JSON.parse(value) : coerceScalar(value)
      await patchConfigFile(DEFAULT_CONFIG_PATH, (cfg) => {
        setDotPath(cfg, path, parsed)
      })
      console.log(`set ${path} = ${typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed)}`)
    })

  cfg
    .command("list")
    .description("Print the in-memory effective config")
    .option("--from-disk", "Show what's persisted in ~/.claw-mem/config.json instead")
    .option("--section <name>", "Limit to a top-level section (e.g. storage, node, backup, bootstrap)")
    .action(async (opts: { fromDisk?: boolean; section?: string }) => {
      const source = opts.fromDisk
        ? await readConfigFile(DEFAULT_CONFIG_PATH)
        : (liveConfig as unknown as Record<string, unknown>)
      const data = opts.section
        ? (source as Record<string, unknown>)[opts.section]
        : source
      console.log(JSON.stringify(data, null, 2))
    })

  cfg
    .command("path")
    .description("Print the path to the on-disk config file")
    .action(() => {
      console.log(DEFAULT_CONFIG_PATH)
    })
}

// helpers moved to ../../services/config-persistence.ts
