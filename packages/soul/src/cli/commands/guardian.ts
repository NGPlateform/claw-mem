// `claw-mem guardian ...` — guardian-side resurrection + guardian set management.

import type { Command } from "commander"
import type { SoulCommandDeps } from "./deps.ts"

export function registerGuardianCommands(program: Command, deps: SoulCommandDeps): void {
  const { backupManager, logger } = deps
  const guardian = program.command("guardian").description("Guardian-side resurrection operations + guardian set management")

  guardian
    .command("initiate")
    .description("Guardian: initiate resurrection for an offline agent")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .requiredOption("--carrier-id <id>", "Target carrier ID (bytes32)")
    .action(async (opts: { agentId: string; carrierId: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const result = await soul.initiateGuardianResurrection(opts.agentId, opts.carrierId)
        console.log("Guardian resurrection initiated!")
        console.log(`  Request ID: ${result.requestId}`)
        console.log(`  TX Hash:    ${result.txHash}`)
        console.log(`\nNext: other guardians should run`)
        console.log(`  claw-mem guardian approve --request-id ${result.requestId}`)
      } catch (error) {
        logger.error(`Guardian initiation failed: ${String(error)}`)
        process.exit(1)
      }
    })

  guardian
    .command("approve")
    .description("Guardian: approve a pending resurrection request")
    .requiredOption("--request-id <id>", "Resurrection request ID (bytes32)")
    .action(async (opts: { requestId: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const txHash = await soul.approveResurrection(opts.requestId)
        console.log(`Resurrection approved! tx ${txHash}`)
      } catch (error) {
        logger.error(`Guardian approval failed: ${String(error)}`)
        process.exit(1)
      }
    })

  guardian
    .command("status")
    .description("Check readiness of a resurrection request")
    .requiredOption("--request-id <id>", "Resurrection request ID (bytes32)")
    .option("--json", "Output JSON")
    .action(async (opts: { requestId: string; json?: boolean }) => {
      try {
        const soul = backupManager.getSoulClient()
        const r = await soul.getResurrectionReadiness(opts.requestId)
        if (opts.json) {
          console.log(JSON.stringify(r, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2))
          return
        }
        console.log(`Request: ${opts.requestId}`)
        console.log(`  Exists:       ${r.exists}`)
        console.log(`  Trigger:      ${r.trigger}`)
        console.log(`  Approvals:    ${r.approvalCount}/${r.approvalThreshold}`)
        console.log(`  Carrier OK:   ${r.carrierConfirmed}`)
        console.log(`  Offline:      ${r.offlineNow}`)
        console.log(`  Can Complete: ${r.canComplete}`)
      } catch (error) {
        logger.error(`Status check failed: ${String(error)}`)
        process.exit(1)
      }
    })

  guardian
    .command("add")
    .description("Add a guardian to the agent's soul")
    .option("--agent-id <id>", "Agent ID (bytes32). Defaults to wallet's agent.")
    .requiredOption("--guardian <address>", "Guardian Ethereum address")
    .action(async (opts: { agentId?: string; guardian: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const agentId = opts.agentId ?? await soul.getAgentIdForOwner()
        const txHash = await soul.addGuardian(agentId, opts.guardian)
        console.log(`Guardian added (agent ${agentId}, guardian ${opts.guardian}, tx ${txHash})`)
      } catch (error) {
        logger.error(`Add guardian failed: ${String(error)}`)
        process.exit(1)
      }
    })

  guardian
    .command("remove")
    .description("Remove a guardian from the agent's soul")
    .option("--agent-id <id>", "Agent ID (bytes32). Defaults to wallet's agent.")
    .requiredOption("--guardian <address>", "Guardian Ethereum address")
    .action(async (opts: { agentId?: string; guardian: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const agentId = opts.agentId ?? await soul.getAgentIdForOwner()
        const txHash = await soul.removeGuardian(agentId, opts.guardian)
        console.log(`Guardian removed (agent ${agentId}, guardian ${opts.guardian}, tx ${txHash})`)
      } catch (error) {
        logger.error(`Remove guardian failed: ${String(error)}`)
        process.exit(1)
      }
    })

  guardian
    .command("list")
    .description("List guardians for an agent")
    .option("--agent-id <id>", "Agent ID (bytes32). Defaults to wallet's agent.")
    .option("--json", "Output JSON")
    .action(async (opts: { agentId?: string; json?: boolean }) => {
      try {
        const soul = backupManager.getSoulClient()
        const agentId = opts.agentId ?? await soul.getAgentIdForOwner()
        const { guardians, activeCount } = await soul.listGuardians(agentId)
        if (opts.json) {
          console.log(JSON.stringify({ agentId, activeCount, guardians }, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2))
          return
        }
        console.log(`Guardians for ${agentId} (${activeCount} active):`)
        for (const g of guardians) {
          const status = g.active ? "ACTIVE" : "INACTIVE"
          console.log(`  ${g.guardian} [${status}] added ${new Date(Number(g.addedAt) * 1000).toISOString()}`)
        }
      } catch (error) {
        logger.error(`List guardians failed: ${String(error)}`)
        process.exit(1)
      }
    })
}
