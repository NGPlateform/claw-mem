// `claw-mem bootstrap ...` subcommand group.

import type { Command } from "commander"
import type { CliServices } from "../register-all.ts"

export function registerBootstrapCommands(program: Command, services: CliServices): void {
  const { bootstrapManager, logger } = services
  const boot = program.command("bootstrap").description("End-to-end stack bootstrap (dev / prod / teardown / status)")

  boot
    .command("dev")
    .description("Bring up local hardhat + COC dev node + (optional) contracts and first backup")
    .option("--hardhat-port <port>", "L1 hardhat port", Number)
    .option("--fund <eth>", "Fund operator with this many ETH from hardhat account #0")
    .option("--skip-contracts", "Skip contract deployment (assume already deployed)", false)
    .option("--skip-first-backup", "Skip the first backup at the end", false)
    .option("--coc-repo <path>", "Override COC repo path")
    .option("--name <name>", "Node name (default: dev-1)")
    .option("--json", "Output JSON")
    .action(async (opts: {
      hardhatPort?: number
      fund?: string
      skipContracts?: boolean
      skipFirstBackup?: boolean
      cocRepo?: string
      name?: string
      json?: boolean
    }) => {
      try {
        const result = await bootstrapManager.runDev({
          hardhatPort: opts.hardhatPort,
          fundEther: opts.fund,
          skipContracts: opts.skipContracts,
          skipFirstBackup: opts.skipFirstBackup,
          cocRepoPath: opts.cocRepo,
          nodeName: opts.name,
        })
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        console.log("Bootstrap dev complete")
        console.log(`  hardhat RPC: ${result.hardhatRpcUrl}`)
        console.log(`  operator:    ${result.operatorAddress}`)
        console.log(`  key file:    ${result.operatorKeyPath}`)
        console.log(`  node:        ${result.nodeName} (${result.nodeRpcUrl})`)
        console.log(`  contracts:   ${JSON.stringify(result.contracts)}`)
        console.log(`  duration:    ${result.durationMs}ms`)
        if (result.warnings.length > 0) {
          console.log(`  warnings:`)
          for (const w of result.warnings) console.log(`    - ${w}`)
        }
      } catch (error) {
        logger.error(`bootstrap dev failed: ${String(error)}`)
        process.exit(1)
      }
    })

  boot
    .command("status")
    .description("Show whether hardhat, the dev node, and contracts are present")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const status = await bootstrapManager.status()
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2))
        return
      }
      console.log(`hardhat:  ${status.hardhatRunning ? "running" : "stopped"}${status.hardhatPid ? ` (PID ${status.hardhatPid})` : ""}`)
      console.log(`node:     ${status.nodeRunning ? "running" : "stopped"}`)
      console.log(`operator: ${status.operatorAddress ?? "(not generated)"}`)
      console.log("contracts:")
      for (const [k, v] of Object.entries(status.contracts)) {
        console.log(`  ${k}: ${v ?? "(missing)"}`)
      }
    })

  boot
    .command("teardown")
    .description("Stop all bootstrap-managed processes and clear local artifacts")
    .option("--yes", "Skip confirmation")
    .option("--keep-keys", "Don't warn about operator keys")
    .action(async (opts: { yes?: boolean; keepKeys?: boolean }) => {
      if (!opts.yes) {
        process.stdout.write("Tear down hardhat + dev node + clear local contracts? [y/N] ")
        const answer = await readLine()
        if (answer.toLowerCase() !== "y") {
          console.log("Cancelled")
          return
        }
      }
      await bootstrapManager.teardown({ keepKeys: opts.keepKeys })
      console.log("Teardown complete")
    })

  boot
    .command("prod")
    .description("Interactive setup pointing at an existing chain (RPC + already-deployed contracts)")
    .option("--non-interactive", "Skip prompts and fail if anything is missing", false)
    .option("--rpc <url>", "COC L1 RPC URL")
    .option("--pose-manager <addr>", "PoSeManager contract address")
    .option("--soul-registry <addr>", "SoulRegistry contract address")
    .option("--did-registry <addr>", "DIDRegistry contract address (optional)")
    .option("--cid-registry <addr>", "CidRegistry contract address (optional)")
    .option("--private-key <key>", "Operator private key (0x + 64 hex)")
    .action(async (opts: {
      nonInteractive?: boolean
      rpc?: string; poseManager?: string; soulRegistry?: string
      didRegistry?: string; cidRegistry?: string; privateKey?: string
    }) => {
      const { runProdBootstrap } = await import("./bootstrap-prod.ts")
      try {
        await runProdBootstrap(services, opts)
      } catch (error) {
        services.logger.error(`bootstrap prod failed: ${String(error)}`)
        process.exit(1)
      }
    })

  boot
    .command("logs")
    .description("Tail the hardhat log spawned by `bootstrap dev` (~/.claw-mem/logs/hardhat.log)")
    .option("-f, --follow", "Follow log output")
    .option("--lines <n>", "Lines to show in non-follow mode", Number, 100)
    .action(async (opts: { follow?: boolean; lines: number }) => {
      const { existsSync } = await import("node:fs")
      const { join } = await import("node:path")
      const logPath = join(services.config.dataDir || services.dbPath.replace(/\/[^/]+$/, ""), "logs", "hardhat.log")
      if (!existsSync(logPath)) {
        console.log(`No hardhat log found at ${logPath}`)
        console.log(`(Run \`claw-mem bootstrap dev\` first.)`)
        return
      }
      if (opts.follow) {
        const { execSync } = await import("node:child_process")
        try { execSync(`tail -n ${opts.lines} -f '${logPath}'`, { stdio: "inherit" }) } catch { /* Ctrl+C */ }
      } else {
        const { readFile } = await import("node:fs/promises")
        const content = await readFile(logPath, "utf-8")
        const lines = content.split("\n")
        console.log(lines.slice(-opts.lines).join("\n"))
      }
    })
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    stdin.setEncoding("utf-8")
    stdin.resume()
    stdin.once("data", (data) => {
      stdin.pause()
      resolve(String(data).trim())
    })
  })
}
