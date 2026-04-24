// `claw-mem carrier ...` — carrier daemon registration and request submission.

import type { Command } from "commander"
import type { SoulCommandDeps } from "./deps.ts"

export function registerCarrierCommands(program: Command, deps: SoulCommandDeps): void {
  const { backupManager, carrierManager, logger } = deps
  const carrier = program.command("carrier").description("Carrier-mode operations (host souls for offline agents)")

  carrier
    .command("status")
    .description("Show whether the carrier daemon is enabled and running")
    .action(() => {
      console.log(`enabled: ${carrierManager.isEnabled()}`)
      console.log(`running: ${carrierManager.isRunning()}`)
    })

  carrier
    .command("list")
    .description("List carriers registered on-chain (walks CarrierRegistered events)")
    .option("--from-block <n>", "Start block (default: earliest)", (v) => parseInt(v))
    .option("--include-inactive", "Include inactive / deregistered carriers", false)
    .option("--json", "Output JSON")
    .action(async (opts: { fromBlock?: number; includeInactive?: boolean; json?: boolean }) => {
      try {
        const soul = backupManager.getSoulClient()
        const carriers = await soul.listCarriers({
          fromBlock: opts.fromBlock ?? "earliest",
          includeInactive: opts.includeInactive,
        })
        if (opts.json) {
          console.log(JSON.stringify(carriers, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2))
          return
        }
        if (carriers.length === 0) {
          console.log("(no carriers found in the requested block range)")
          return
        }
        const header = padRow("CARRIER ID", "OWNER", "ENDPOINT", "CPU", "MEM", "STORAGE", "ACTIVE")
        console.log(header)
        console.log("-".repeat(header.length))
        for (const c of carriers) {
          console.log(
            padRow(
              c.carrierId.slice(0, 12) + "…",
              c.owner.slice(0, 10) + "…",
              c.endpoint.slice(0, 30),
              `${c.cpuMillicores}m`,
              `${c.memoryMB}MB`,
              `${c.storageMB}MB`,
              c.active ? (c.available ? "yes" : "off") : "no",
            ),
          )
        }
      } catch (error) {
        logger.error(`Carrier list failed: ${String(error)}`)
        process.exit(1)
      }
    })

  carrier
    .command("register")
    .description("Register this node as a carrier provider on-chain")
    .requiredOption("--carrier-id <id>", "Carrier ID (bytes32)")
    .requiredOption("--endpoint <url>", "Carrier communication endpoint")
    .option("--cpu <millicores>", "CPU millicores", "2000")
    .option("--memory <mb>", "Memory in MB", "4096")
    .option("--storage <mb>", "Storage in MB", "50000")
    .action(async (opts: { carrierId: string; endpoint: string; cpu: string; memory: string; storage: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const txHash = await soul.registerCarrier(
          opts.carrierId, opts.endpoint,
          parseInt(opts.cpu), parseInt(opts.memory), parseInt(opts.storage),
        )
        console.log("Carrier registered!")
        console.log(`  Carrier ID: ${opts.carrierId}`)
        console.log(`  Endpoint:   ${opts.endpoint}`)
        console.log(`  TX Hash:    ${txHash}`)
      } catch (error) {
        logger.error(`Carrier registration failed: ${String(error)}`)
        process.exit(1)
      }
    })

  carrier
    .command("deregister")
    .description("Remove a carrier registration from the chain")
    .requiredOption("--carrier-id <id>", "Carrier ID (bytes32)")
    .action(async (opts: { carrierId: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const txHash = await soul.deregisterCarrier(opts.carrierId)
        console.log(`Carrier deregistered (tx ${txHash})`)
      } catch (error) {
        logger.error(`Deregister failed: ${String(error)}`)
        process.exit(1)
      }
    })

  carrier
    .command("availability")
    .description("Mark the carrier as available or unavailable")
    .requiredOption("--carrier-id <id>", "Carrier ID (bytes32)")
    .requiredOption("--available <bool>", "true|false")
    .action(async (opts: { carrierId: string; available: string }) => {
      try {
        const flag = opts.available === "true" || opts.available === "1"
        const soul = backupManager.getSoulClient()
        const txHash = await soul.updateCarrierAvailability(opts.carrierId, flag)
        console.log(`Carrier availability updated (${flag ? "available" : "unavailable"}, tx ${txHash})`)
      } catch (error) {
        logger.error(`Update availability failed: ${String(error)}`)
        process.exit(1)
      }
    })

  carrier
    .command("info")
    .description("Read on-chain carrier info")
    .requiredOption("--carrier-id <id>", "Carrier ID (bytes32)")
    .option("--json", "Output JSON")
    .action(async (opts: { carrierId: string; json?: boolean }) => {
      try {
        const soul = backupManager.getSoulClient()
        const info = await soul.getCarrier(opts.carrierId)
        if (opts.json) console.log(JSON.stringify(info, null, 2))
        else {
          for (const [k, v] of Object.entries(info)) {
            console.log(`  ${k.padEnd(16)} ${typeof v === "bigint" ? v.toString() : JSON.stringify(v)}`)
          }
        }
      } catch (error) {
        logger.error(`Carrier info failed: ${String(error)}`)
        process.exit(1)
      }
    })

  carrier
    .command("submit-request")
    .description("Submit a pending resurrection request to the local carrier daemon")
    .requiredOption("--request-id <id>", "Resurrection request ID (bytes32)")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .action((opts: { requestId: string; agentId: string }) => {
      const result = carrierManager.addRequest(opts.requestId, opts.agentId)
      if (!result.accepted) {
        logger.error(`Request rejected: ${result.reason}`)
        process.exit(1)
      }
      console.log("Request accepted by carrier daemon:")
      console.log(`  Request ID: ${opts.requestId}`)
      console.log(`  Agent ID:   ${opts.agentId}`)
    })

  carrier
    .command("start")
    .description("Start the carrier daemon (if config.backup.carrier.enabled)")
    .action(() => {
      carrierManager.start()
      console.log(`carrier daemon: ${carrierManager.isRunning() ? "started" : "not started (check `carrier status`)"}`)
    })

  carrier
    .command("stop")
    .description("Stop the carrier daemon")
    .action(async () => {
      await carrierManager.stop()
      console.log("carrier daemon stopped")
    })
}

function padRow(...cols: string[]): string {
  const widths = [16, 14, 32, 8, 10, 10, 8]
  return cols.map((c, i) => c.padEnd(widths[i] ?? 12)).join(" ")
}
