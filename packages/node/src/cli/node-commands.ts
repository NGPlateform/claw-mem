// `coc node ...` subcommand group (claw-mem also mounts this via its register-all).
// Migrated from COC/extensions/coc-nodeops/src/cli/commands.ts.

import { execSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import type { Command } from "commander"

import type { Logger } from "../types.ts"
import type { NodeManager, NodeStatus } from "../node-manager.ts"
import { runInitWizard } from "./init-wizard.ts"

export interface NodeCommandDeps {
  nodeManager: NodeManager
  logger: Logger
}

export function registerNodeCommands(program: Command, deps: NodeCommandDeps): void {
  const { nodeManager, logger } = deps
  const node = program.command("node").description("Manage COC blockchain nodes")

  // ─── claw-mem node install ─────────────────────────────────
  node
    .command("install")
    .alias("init")
    .description("Initialize a new COC node")
    .option("-t, --type <type>", "Node type: validator|fullnode|archive|gateway|dev")
    .option("-n, --network <network>", "Network: testnet|mainnet|local|custom")
    .option("--name <name>", "Node name")
    .option("--data-dir <dir>", "Data directory")
    .option("--rpc-port <port>", "RPC port", Number)
    .option("--advertised-bytes <bytes>", "P2P storage to advertise (default: config.storage.advertisedBytes)", Number)
    .action(async (opts) => {
      try {
        await nodeManager.init()
        await runInitWizard(nodeManager, {
          type: opts.type,
          network: opts.network,
          name: opts.name,
          dataDir: opts.dataDir,
          rpcPort: opts.rpcPort,
        })
      } catch (error) {
        logger.error(`Install failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── claw-mem node list ───────────────────────────────────
  node
    .command("list")
    .description("List all managed node instances")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      await nodeManager.init()
      const nodes = nodeManager.listNodes()
      if (nodes.length === 0) {
        console.log('No nodes configured. Run "claw-mem node install" to create one.')
        return
      }
      if (opts.json) {
        console.log(JSON.stringify(nodes, null, 2))
        return
      }
      const header = padRow("NAME", "TYPE", "NETWORK", "SERVICES", "STORAGE", "CREATED")
      console.log(header)
      console.log("-".repeat(header.length))
      for (const n of nodes) {
        console.log(
          padRow(
            n.name,
            n.type,
            n.network,
            n.services.join(","),
            formatBytes(n.advertisedBytes),
            n.createdAt.slice(0, 10),
          ),
        )
      }
    })

  // ─── start / stop / restart [name] ─────────────────────────
  node
    .command("start [name]")
    .description("Start a node (or all nodes)")
    .action(async (name?: string) => {
      try {
        await nodeManager.init()
        await iterateNodes(name, nodeManager, "start", async (n) => {
          await nodeManager.startNode(n.name)
          console.log(`Node "${n.name}" started`)
        })
      } catch (error) {
        logger.error(`Start failed: ${String(error)}`)
        process.exit(1)
      }
    })

  node
    .command("stop [name]")
    .description("Stop a node (or all nodes)")
    .action(async (name?: string) => {
      try {
        await nodeManager.init()
        await iterateNodes(name, nodeManager, "stop", async (n) => {
          await nodeManager.stopNode(n.name)
          console.log(`Node "${n.name}" stopped`)
        })
      } catch (error) {
        logger.error(`Stop failed: ${String(error)}`)
        process.exit(1)
      }
    })

  node
    .command("restart [name]")
    .description("Restart a node (or all nodes)")
    .action(async (name?: string) => {
      try {
        await nodeManager.init()
        await iterateNodes(name, nodeManager, "restart", async (n) => {
          await nodeManager.restartNode(n.name)
          console.log(`Node "${n.name}" restarted`)
        })
      } catch (error) {
        logger.error(`Restart failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── status [name] ─────────────────────────────────────────
  node
    .command("status [name]")
    .description("Show node status (with RPC stats)")
    .option("--json", "Output JSON")
    .action(async (name: string | undefined, opts: { json?: boolean }) => {
      try {
        await nodeManager.init()
        if (name) {
          const status = await nodeManager.getNodeStatus(name)
          if (opts.json) console.log(JSON.stringify(status, null, 2))
          else printNodeStatus(status)
          return
        }
        const nodes = nodeManager.listNodes()
        if (nodes.length === 0) {
          console.log('No nodes configured. Run "claw-mem node install" first.')
          return
        }
        const statuses = await Promise.all(nodes.map((n) => nodeManager.getNodeStatus(n.name)))
        if (opts.json) {
          console.log(JSON.stringify(statuses, null, 2))
          return
        }
        for (const status of statuses) {
          printNodeStatus(status)
          console.log()
        }
      } catch (error) {
        logger.error(`Status failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── remove <name> ─────────────────────────────────────────
  node
    .command("remove <name>")
    .description("Remove a node instance")
    .option("--yes", "Skip confirmation")
    .option("--keep-data", "Keep data directory")
    .action(async (name: string, opts: { yes?: boolean; keepData?: boolean }) => {
      await nodeManager.init()
      const n = nodeManager.getNode(name)
      if (!n) {
        console.error(`Node "${name}" not found`)
        process.exit(1)
      }

      if (!opts.yes) {
        process.stdout.write(
          `Remove node "${name}"${opts.keepData ? "" : " and delete all data"}? [y/N] `,
        )
        const answer = await readLine()
        if (answer.toLowerCase() !== "y") {
          console.log("Cancelled")
          return
        }
      }

      const deleted = await nodeManager.removeNode(name, !opts.keepData)
      if (deleted) console.log(`Node "${name}" removed`)
    })

  // ─── config show/edit ──────────────────────────────────────
  const configCmd = node.command("config").description("Node configuration")

  configCmd
    .command("show [name]")
    .description("Show node configuration")
    .action(async (name?: string) => {
      try {
        await nodeManager.init()
        const target = await pickSingleNode(name, nodeManager)
        if (!target) return
        const cfg = await nodeManager.getNodeConfig(target)
        console.log(JSON.stringify(cfg, null, 2))
      } catch (error) {
        logger.error(`Config show failed: ${String(error)}`)
        process.exit(1)
      }
    })

  configCmd
    .command("edit <name>")
    .description("Edit node configuration in $EDITOR")
    .action(async (name: string) => {
      await nodeManager.init()
      const n = nodeManager.getNode(name)
      if (!n) {
        console.error(`Node "${name}" not found`)
        process.exit(1)
      }
      const editor = process.env.EDITOR || "vi"
      const configPath = `${n.dataDir}/node-config.json`
      try {
        execSync(`${editor} ${configPath}`, { stdio: "inherit" })
        console.log("Configuration saved")
      } catch {
        console.error("Editor exited with error")
      }
    })

  // ─── logs <name> ──────────────────────────────────────────
  node
    .command("logs <name>")
    .description("View node logs")
    .option("-f, --follow", "Follow log output")
    .option("--service <service>", "Service: node|agent|relayer (ignored if --all)", "node")
    .option("--all", "Interleave logs from all services that this node runs", false)
    .option("--lines <n>", "Lines to show in non-follow mode", Number, 100)
    .action(async (name: string, opts: { follow?: boolean; service?: string; all?: boolean; lines: number }) => {
      await nodeManager.init()
      const n = nodeManager.getNode(name)
      if (!n) {
        console.error(`Node "${name}" not found`)
        process.exit(1)
      }
      const targetServices = opts.all
        ? (n.services as ("node" | "agent" | "relayer")[])
        : [(opts.service ?? "node") as "node" | "agent" | "relayer"]

      const logPaths = targetServices.map((s) => ({ service: s, path: `${n.dataDir}/coc-${s}.log` }))

      if (opts.follow) {
        // GNU/BSD tail handles multi-file follow natively, prefixing each chunk with ==> file <==
        const args = ["-n", String(opts.lines), "-f", ...logPaths.map((l) => l.path)]
        try {
          execSync(`tail ${args.map((a) => quote(a)).join(" ")}`, { stdio: "inherit" })
        } catch {
          // user Ctrl+C
        }
      } else {
        for (const { service, path } of logPaths) {
          if (logPaths.length > 1) console.log(`\n══ ${service} (${path}) ══`)
          try {
            const content = await readFile(path, "utf-8")
            const lines = content.split("\n")
            console.log(lines.slice(-opts.lines).join("\n"))
          } catch {
            console.log(`(no log found at ${path})`)
          }
        }
      }
    })
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

// ────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────

async function iterateNodes(
  name: string | undefined,
  nodeManager: NodeManager,
  action: string,
  fn: (n: { name: string }) => Promise<void>,
): Promise<void> {
  if (name) {
    await fn({ name })
    return
  }
  const all = nodeManager.listNodes()
  if (all.length === 0) {
    console.log(`No nodes configured. Run "claw-mem node install" first.`)
    return
  }
  const ordered = action === "stop" ? [...all].reverse() : all
  for (const n of ordered) await fn(n)
}

async function pickSingleNode(
  name: string | undefined,
  nodeManager: NodeManager,
): Promise<string | undefined> {
  if (name) return name
  const all = nodeManager.listNodes()
  if (all.length === 1) return all[0].name
  if (all.length === 0) {
    console.log("No nodes configured")
    return undefined
  }
  console.log("Specify a node name. Available nodes:")
  for (const n of all) console.log(`  ${n.name}`)
  return undefined
}

function padRow(...cols: string[]): string {
  const widths = [16, 12, 12, 18, 12, 12]
  return cols.map((c, i) => c.padEnd(widths[i] ?? 16)).join(" ")
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GiB`
  return `${Math.round(mb)}MiB`
}

function printNodeStatus(status: NodeStatus): void {
  const state = status.running ? "RUNNING" : "STOPPED"
  console.log(`${status.name}: ${state}`)
  if (status.pid) console.log(`  PID: ${status.pid}`)
  if (status.blockHeight !== undefined) console.log(`  Block: #${status.blockHeight}`)
  if (status.peerCount !== undefined) console.log(`  Peers: ${status.peerCount}`)
  if (status.bftActive !== undefined) console.log(`  BFT: ${status.bftActive ? "active" : "inactive"}`)
  for (const [svc, st] of Object.entries(status.services)) {
    console.log(`  ${svc}: ${st.running ? "running" : "stopped"}${st.pid ? ` (${st.pid})` : ""}`)
  }
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
