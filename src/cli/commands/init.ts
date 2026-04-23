// `claw-mem init` — first-time interactive setup. Writes
// ~/.claw-mem/config.json with sensible defaults so subsequent commands
// (bootstrap, backup configure, node install) have a real starting point.

import * as p from "@clack/prompts"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Command } from "commander"

import type { CliServices } from "../register-all.ts"
import {
  DEFAULT_CONFIG_PATH,
  patchConfigFile,
  readConfigFile,
} from "../../services/config-persistence.ts"
import { checkCocRepo } from "../../shared/paths.ts"

export function registerInitCommand(program: Command, _services: CliServices): void {
  program
    .command("init")
    .description("Interactive first-time setup — writes ~/.claw-mem/config.json")
    .option("--force", "Overwrite an existing config file", false)
    .option("--non-interactive", "Write defaults without prompting", false)
    .action(async (opts: { force?: boolean; nonInteractive?: boolean }) => {
      if (existsSync(DEFAULT_CONFIG_PATH) && !opts.force) {
        const existing = await readConfigFile(DEFAULT_CONFIG_PATH)
        console.log(`Config already exists at ${DEFAULT_CONFIG_PATH}`)
        console.log(`Top-level keys: ${Object.keys(existing).join(", ")}`)
        console.log(`Re-run with --force to overwrite, or use \`claw-mem config set\` to edit individual fields.`)
        return
      }

      if (opts.nonInteractive) {
        await patchConfigFile(DEFAULT_CONFIG_PATH, () => ({
          enabled: true,
          backup: { sourceDir: join(homedir(), ".openclaw") },
        }))
        console.log(`Wrote default config to ${DEFAULT_CONFIG_PATH}`)
        return
      }

      p.intro("claw-mem first-time setup")

      // 1. COC repo
      const cocAuto = checkCocRepo({})
      const cocRepoPath = await p.text({
        message: "Path to the COC repository (used for `node start` and `bootstrap dev`):",
        defaultValue: cocAuto.root ?? "",
        placeholder: cocAuto.root ?? join(homedir(), "COC"),
      })
      if (p.isCancel(cocRepoPath)) {
        p.cancel("Setup cancelled")
        return
      }

      // 2. Source dir to back up
      const sourceDir = await p.text({
        message: "Source directory to back up (the agent's home):",
        defaultValue: "~/.openclaw",
        placeholder: "~/.openclaw",
      })
      if (p.isCancel(sourceDir)) {
        p.cancel("Setup cancelled")
        return
      }

      // 3. Storage quota
      const quotaResult = await p.select({
        message: "P2P storage contribution (advertised + local cap):",
        options: [
          { value: "256", label: "256 MiB (network minimum)", hint: "default" },
          { value: "512", label: "512 MiB" },
          { value: "1024", label: "1 GiB" },
          { value: "4096", label: "4 GiB" },
        ],
      })
      if (p.isCancel(quotaResult)) {
        p.cancel("Setup cancelled")
        return
      }
      const quotaBytes = Number(quotaResult) * 1024 * 1024

      // 4. Bootstrap mode
      const bootstrapMode = await p.select({
        message: "Bootstrap mode:",
        options: [
          { value: "none", label: "none (configure manually)", hint: "default" },
          { value: "dev", label: "dev (auto-spawn local hardhat + dev node)" },
          { value: "prod", label: "prod (point at remote chain — configure manually after init)" },
        ],
      })
      if (p.isCancel(bootstrapMode)) {
        p.cancel("Setup cancelled")
        return
      }

      // 5. Configure backup now?
      const configureBackup = await p.confirm({
        message: "Configure backup now? (you can do it later with `claw-mem backup configure`)",
        initialValue: false,
      })
      if (p.isCancel(configureBackup)) {
        p.cancel("Setup cancelled")
        return
      }

      // Write config
      const written = await patchConfigFile(DEFAULT_CONFIG_PATH, (cfg) => ({
        ...cfg,
        enabled: true,
        storage: {
          ...(cfg.storage as Record<string, unknown> | undefined ?? {}),
          quotaBytes,
          advertisedBytes: quotaBytes,
          reservedBytes: quotaBytes,
        },
        node: {
          ...(cfg.node as Record<string, unknown> | undefined ?? {}),
          runtimeDir: cocRepoPath as string,
        },
        backup: {
          ...(cfg.backup as Record<string, unknown> | undefined ?? {}),
          sourceDir: sourceDir as string,
        },
        bootstrap: {
          ...(cfg.bootstrap as Record<string, unknown> | undefined ?? {}),
          mode: bootstrapMode as string,
          cocRepoPath: cocRepoPath as string,
        },
      }))

      const lines = [
        `Wrote ${DEFAULT_CONFIG_PATH}`,
        `  cocRepoPath: ${cocRepoPath}`,
        `  sourceDir:   ${sourceDir}`,
        `  quotaBytes:  ${quotaBytes} (${(quotaBytes / 1024 / 1024)}MiB)`,
        `  bootstrap:   ${bootstrapMode}`,
        ``,
        `Next:`,
        `  - claw-mem doctor       # verify environment`,
        `  - claw-mem status       # one-screen overview`,
        configureBackup ? `  - claw-mem backup configure   # set RPC, contracts, key` : `  - (skipped backup configure — run when ready)`,
        bootstrapMode === "dev" ? `  - claw-mem bootstrap dev    # spin up the stack` : ``,
      ].filter(Boolean)

      p.note(lines.join("\n"), "Setup complete")
      p.outro("ready")

      void written
    })
}
