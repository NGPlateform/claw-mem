// `claw-mem recovery ...` — social recovery (guardian-initiated owner migration).

import type { Command } from "commander"
import type { SoulCommandDeps } from "./deps.ts"

export function registerRecoveryCommands(program: Command, deps: SoulCommandDeps): void {
  const { backupManager, logger } = deps
  const recovery = program.command("recovery").description("Social recovery — guardian-initiated owner migration")

  recovery
    .command("initiate")
    .description("Guardian: initiate owner recovery for an agent")
    .requiredOption("--agent-id <id>", "Agent ID (bytes32)")
    .requiredOption("--new-owner <address>", "New owner Ethereum address")
    .action(async (opts: { agentId: string; newOwner: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const requestId = await soul.initiateRecovery(opts.agentId, opts.newOwner)
        console.log("Recovery initiated!")
        console.log(`  Request ID: ${requestId}`)
        console.log(`  Agent:      ${opts.agentId}`)
        console.log(`  New Owner:  ${opts.newOwner}`)
        console.log(`\nNext: other guardians should run`)
        console.log(`  claw-mem recovery approve --request-id ${requestId}`)
      } catch (error) {
        logger.error(`Recovery initiation failed: ${String(error)}`)
        process.exit(1)
      }
    })

  recovery
    .command("approve")
    .description("Guardian: approve a pending recovery request")
    .requiredOption("--request-id <id>", "Recovery request ID (bytes32)")
    .action(async (opts: { requestId: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const txHash = await soul.approveRecovery(opts.requestId)
        console.log(`Recovery approved (tx ${txHash})`)
      } catch (error) {
        logger.error(`Recovery approval failed: ${String(error)}`)
        process.exit(1)
      }
    })

  recovery
    .command("complete")
    .description("Complete a recovery after quorum + timelock satisfied")
    .requiredOption("--request-id <id>", "Recovery request ID (bytes32)")
    .action(async (opts: { requestId: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const txHash = await soul.completeRecovery(opts.requestId)
        console.log(`Recovery completed — ownership transferred (tx ${txHash})`)
      } catch (error) {
        logger.error(`Recovery completion failed: ${String(error)}`)
        process.exit(1)
      }
    })

  recovery
    .command("cancel")
    .description("Owner: cancel a pending recovery request")
    .requiredOption("--request-id <id>", "Recovery request ID (bytes32)")
    .action(async (opts: { requestId: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const txHash = await soul.cancelRecovery(opts.requestId)
        console.log(`Recovery cancelled (tx ${txHash})`)
      } catch (error) {
        logger.error(`Recovery cancel failed: ${String(error)}`)
        process.exit(1)
      }
    })

  recovery
    .command("status")
    .description("Check status of a recovery request")
    .requiredOption("--request-id <id>", "Recovery request ID (bytes32)")
    .option("--json", "Output JSON")
    .action(async (opts: { requestId: string; json?: boolean }) => {
      try {
        const soul = backupManager.getSoulClient()
        const req = await soul.getRecoveryRequest(opts.requestId)
        if (opts.json) {
          console.log(JSON.stringify(req, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2))
          return
        }
        console.log(`Recovery Request: ${opts.requestId}`)
        for (const [k, v] of Object.entries(req as Record<string, unknown>)) {
          const display = typeof v === "bigint"
            ? (v as bigint).toString()
            : (k.endsWith("At") && typeof v === "number"
                ? new Date((v as number) * 1000).toISOString()
                : String(v))
          console.log(`  ${k.padEnd(16)} ${display}`)
        }
      } catch (error) {
        logger.error(`Recovery status failed: ${String(error)}`)
        process.exit(1)
      }
    })
}
