// Soul backup / recovery / resurrection / guardian agent tools.
// Mirrors the full surface of COC/extensions/coc-backup/index.ts.

import type { CliServices } from "../cli/register-all.ts"
import type { PluginApi } from "../types.ts"
import { patchBackupState, readBackupState } from "../services/local-state.ts"
import { resolveHomePath } from "../services/backup-utils.ts"

export function registerSoulTools(api: PluginApi, services: CliServices): void {
  const { backupManager, recoveryManager, carrierManager, logger } = services

  api.registerTool({
    name: "soul-backup",
    description:
      "Backup the current agent's soul (identity, memory, chat history) to IPFS with on-chain anchoring",
    parameters: {
      type: "object",
      properties: {
        full: {
          type: "boolean",
          description: "Force a full backup instead of incremental",
          default: false,
        },
      },
    },
    async execute(params: Record<string, unknown>) {
      try {
        const full = Boolean(params.full ?? false)
        const result = await backupManager.runBackup(full)
        const b = result.backup
        return {
          success: true,
          status: result.status,
          reason: result.reason,
          heartbeatStatus: result.heartbeatStatus,
          manifestCid: b?.manifestCid ?? null,
          fileCount: b?.fileCount ?? 0,
          totalBytes: b?.totalBytes ?? 0,
          backupType: b ? (b.backupType === 0 ? "full" : "incremental") : null,
          txHash: b?.txHash ?? null,
        }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-restore",
    description: "Restore the agent's soul from an IPFS backup using a manifest CID",
    parameters: {
      type: "object",
      properties: {
        manifestCid: { type: "string", description: "IPFS CID of the backup manifest" },
        packagePath: { type: "string", description: "Local recovery package JSON path" },
        latestLocal: { type: "boolean", description: "Use latest local package" },
        targetDir: { type: "string", description: "Target directory (default: configured sourceDir)" },
        password: { type: "string", description: "Decryption password" },
      },
    },
    async execute(params: Record<string, unknown>) {
      try {
        const result = await recoveryManager.restore({
          manifestCid: params.manifestCid as string | undefined,
          packagePath: params.packagePath as string | undefined,
          latestLocal: params.latestLocal as boolean | undefined,
          targetDir: params.targetDir as string | undefined,
          password: params.password as string | undefined,
        })
        return { success: true, ...result }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-status",
    description: "Check the current soul backup status and on-chain registration",
    parameters: { type: "object", properties: {} },
    async execute() {
      try {
        const report = await recoveryManager.doctor()
        return {
          success: true,
          registered: report.chain.registered,
          lifecycleState: report.state,
          doctor: report,
        }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-doctor",
    description: "Run lifecycle checks for the current soul and recommend next actions",
    parameters: { type: "object", properties: {} },
    async execute() {
      try {
        const report = await recoveryManager.doctor()
        return { success: true, ...report }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-memory-search",
    description:
      "Search the agent's semantic memories (past observations and session summaries) via the local claw-mem store.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
        limit: { type: "number", description: "Max results (default: 10)" },
        type: { type: "string", description: "Filter by observation type" },
      },
      required: ["query"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        const result = await recoveryManager.searchMemories({
          query: String(params.query),
          limit: params.limit ? Number(params.limit) : undefined,
          type: params.type ? String(params.type) : undefined,
        })
        return {
          success: true,
          source: result.source,
          totalCount: result.totalCount,
          results: result.results.map((hit) => ({
            id: hit.id,
            type: hit.type,
            title: hit.title,
            narrative: hit.narrative,
            facts: hit.facts,
            concepts: hit.concepts,
            createdAt: hit.createdAt,
            score: hit.score,
          })),
        }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-auto-restore",
    description:
      "Automatically restore agent from on-chain backup using agentId. Resolves latest backup CID via " +
      "local index, MFS, or on-chain registry, then downloads, decrypts, and verifies all files.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID (bytes32 hex). If omitted, resolves from wallet." },
        targetDir: { type: "string", description: "Target directory (default: configured sourceDir)" },
        password: { type: "string", description: "Decryption password" },
      },
    },
    async execute(params: Record<string, unknown>) {
      try {
        const result = await recoveryManager.autoRestoreAgent({
          agentId: params.agentId as string | undefined,
          targetDir: params.targetDir as string | undefined,
          password: params.password as string | undefined,
        })
        return { success: true, ...result }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-resurrection",
    description: "Manage owner-key resurrection requests for the current soul",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "status", "confirm", "complete", "cancel"] },
        requestId: { type: "string", description: "Resurrection request ID. Falls back to local pending request." },
        carrierId: { type: "string", description: "Carrier ID for the start action" },
        resurrectionKey: { type: "string", description: "Resurrection private key for the start action" },
        agentId: { type: "string", description: "Optional agentId override when relaying for another soul" },
      },
      required: ["action"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        const action = String(params.action) as "start" | "status" | "confirm" | "complete" | "cancel"
        const soul = backupManager.getSoulClient()
        const coc = backupManager.getCocConfig()
        const dataDir = resolveHomePath(coc.dataDir)
        const localState = await readBackupState(dataDir)
        const requestId = (params.requestId as string | undefined) ?? localState.pendingResurrectionRequestId ?? undefined

        if (action === "start") {
          const carrierId = params.carrierId as string | undefined
          const resurrectionKey = params.resurrectionKey as string | undefined
          if (!carrierId || !resurrectionKey) {
            throw new Error("start action requires carrierId and resurrectionKey")
          }
          const agentId = (params.agentId as string | undefined) ?? await soul.getAgentIdForOwner()
          const result = await soul.initiateResurrection(agentId, carrierId, resurrectionKey)
          await patchBackupState(dataDir, {
            latestAgentId: agentId,
            pendingCarrierId: carrierId,
            pendingResurrectionRequestId: result.requestId,
          })
          return { success: true, agentId, carrierId, ...result }
        }
        if (!requestId) throw new Error("No resurrection requestId provided and no local pending request is recorded")

        if (action === "status") {
          const request = await soul.getResurrectionRequest(requestId)
          const readiness = await soul.getResurrectionReadiness(requestId)
          return { success: true, request, readiness }
        }
        if (action === "confirm") {
          const txHash = await soul.confirmCarrier(requestId)
          return { success: true, requestId, txHash }
        }
        if (action === "complete") {
          const txHash = await soul.completeResurrection(requestId)
          await patchBackupState(dataDir, {
            pendingResurrectionRequestId: null,
            pendingCarrierId: null,
          })
          return { success: true, requestId, txHash }
        }
        const txHash = await soul.cancelResurrection(requestId)
        await patchBackupState(dataDir, {
          pendingResurrectionRequestId: null,
          pendingCarrierId: null,
        })
        return { success: true, requestId, txHash }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-carrier-request",
    description: "Submit a pending resurrection request to the local carrier daemon",
    parameters: {
      type: "object",
      properties: {
        requestId: { type: "string", description: "Resurrection request ID (bytes32)" },
        agentId: { type: "string", description: "Agent ID (bytes32)" },
      },
      required: ["requestId", "agentId"],
    },
    async execute(params: Record<string, unknown>) {
      const result = carrierManager.addRequest(String(params.requestId), String(params.agentId))
      if (!result.accepted) return { success: false, error: result.reason ?? "Request rejected" }
      return { success: true, message: `Request ${params.requestId} accepted by carrier daemon` }
    },
  })

  api.registerTool({
    name: "soul-guardian-initiate",
    description: "Guardian: initiate a resurrection request for an offline agent",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID (bytes32)" },
        carrierId: { type: "string", description: "Target carrier ID (bytes32)" },
      },
      required: ["agentId", "carrierId"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        const soul = backupManager.getSoulClient()
        const result = await soul.initiateGuardianResurrection(String(params.agentId), String(params.carrierId))
        return { success: true, ...result }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-guardian-approve",
    description: "Guardian: approve a pending resurrection request",
    parameters: {
      type: "object",
      properties: { requestId: { type: "string", description: "Resurrection request ID (bytes32)" } },
      required: ["requestId"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        const soul = backupManager.getSoulClient()
        const txHash = await soul.approveResurrection(String(params.requestId))
        return { success: true, txHash }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-guardian-manage",
    description: "Manage guardians: add, remove, or list guardians for the agent's soul",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove", "list"], description: "Action" },
        guardian: { type: "string", description: "Guardian address (required for add/remove)" },
        agentId: { type: "string", description: "Agent ID (defaults to wallet's agent)" },
      },
      required: ["action"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        const soul = backupManager.getSoulClient()
        const action = params.action as "add" | "remove" | "list"
        const agentId = (params.agentId as string | undefined) ?? await soul.getAgentIdForOwner()
        if (action === "list") {
          const result = await soul.listGuardians(agentId)
          return { success: true, ...result }
        }
        if (!params.guardian) return { success: false, error: "guardian address required for add/remove" }
        if (action === "add") {
          const txHash = await soul.addGuardian(agentId, String(params.guardian))
          return { success: true, action: "added", guardian: params.guardian, txHash }
        }
        const txHash = await soul.removeGuardian(agentId, String(params.guardian))
        return { success: true, action: "removed", guardian: params.guardian, txHash }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-recovery-initiate",
    description: "Guardian: initiate social recovery to transfer ownership of an agent's soul",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Agent ID (bytes32)" },
        newOwner: { type: "string", description: "New owner Ethereum address" },
      },
      required: ["agentId", "newOwner"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        const soul = backupManager.getSoulClient()
        const requestId = await soul.initiateRecovery(String(params.agentId), String(params.newOwner))
        return { success: true, requestId, agentId: params.agentId, newOwner: params.newOwner }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  api.registerTool({
    name: "soul-recovery-approve",
    description: "Guardian: approve a pending social recovery request",
    parameters: {
      type: "object",
      properties: { requestId: { type: "string", description: "Recovery request ID (bytes32)" } },
      required: ["requestId"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        const soul = backupManager.getSoulClient()
        const txHash = await soul.approveRecovery(String(params.requestId))
        return { success: true, txHash }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  // Touch unused-import lint
  void logger
}
