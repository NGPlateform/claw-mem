// claw-mem: Persistent cross-session semantic memory for OpenClaw AI agents
//
// Captures structured observations from tool usage, compresses them into
// session summaries, and injects relevant context into future sessions.
//
// Architecture:
//   Hook: session_start       → Track session lifecycle
//   Hook: before_prompt_build → Inject memory context (token-budgeted)
//   Hook: after_tool_call     → Capture observations (heuristic extraction)
//   Hook: agent_end           → Generate session summary
//   Hook: session_end         → Finalize session
//   Tool: mem-search          → Search past observations
//   Tool: mem-status          → View memory statistics
//   Tool: mem-forget          → Delete session memories

import { ClawMemConfigSchema, resolveDbPath } from "./src/config.ts"
import type { ClawMemConfig } from "./src/config.ts"
import { Database } from "./src/db/database.ts"
import { ObservationStore } from "./src/db/observation-store.ts"
import { SummaryStore } from "./src/db/summary-store.ts"
import { SessionStore } from "./src/db/session-store.ts"
import { SearchEngine } from "./src/search/search.ts"
import { registerHooks } from "./src/hooks/index.ts"
import type { PluginApi } from "./src/types.ts"

export async function activate(api: PluginApi): Promise<void> {
  const logger = api.logger
  logger.info("[claw-mem] Loading...")

  // Parse configuration
  let config: ClawMemConfig
  try {
    config = ClawMemConfigSchema.parse(api.pluginConfig ?? {})
  } catch (error) {
    logger.error(`[claw-mem] Config parse failed: ${String(error)}`)
    return
  }

  if (!config.enabled) {
    logger.info("[claw-mem] Disabled via config")
    return
  }

  // Open database
  const dbPath = resolveDbPath(config)
  const db = new Database(dbPath)
  try {
    await db.open()
  } catch (error) {
    logger.error(`[claw-mem] Database open failed: ${String(error)}`)
    return
  }

  logger.info(`[claw-mem] Database opened: ${dbPath}`)

  // Register hooks (session lifecycle, context injection, observation capture)
  registerHooks(api, db, config, logger)

  // ──────────────────────────────────────────────────────
  // Tool: mem-search
  // ──────────────────────────────────────────────────────
  const search = new SearchEngine(db)

  api.registerTool({
    name: "mem-search",
    description: "Search the agent's semantic memory across all past sessions. " +
      "Finds observations by keyword, concept, or natural language query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
        limit: { type: "number", description: "Max results (default: 10)" },
        type: {
          type: "string",
          description: "Filter by observation type: discovery, decision, pattern, learning, issue, change",
        },
      },
      required: ["query"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        const result = search.search({
          query: String(params.query),
          limit: Number(params.limit ?? 10),
          type: params.type ? String(params.type) : undefined,
        })
        return {
          success: true,
          source: result.source,
          count: result.totalCount,
          results: result.results.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            narrative: r.narrative,
            facts: r.facts,
            concepts: r.concepts,
            createdAt: r.createdAt,
          })),
        }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  // ──────────────────────────────────────────────────────
  // Tool: mem-status
  // ──────────────────────────────────────────────────────
  const obsStore = new ObservationStore(db)
  const sumStore = new SummaryStore(db)

  api.registerTool({
    name: "mem-status",
    description: "View claw-mem memory statistics: total observations, summaries, and database info.",
    parameters: { type: "object", properties: {} },
    async execute() {
      try {
        // Count across all agents (empty string agent_id = count all)
        const totalObs = db.connection
          .prepare("SELECT COUNT(*) as c FROM observations").get() as { c: number }
        const totalSums = db.connection
          .prepare("SELECT COUNT(*) as c FROM session_summaries").get() as { c: number }
        const totalSessions = db.connection
          .prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }
        const agents = db.connection
          .prepare("SELECT DISTINCT agent_id FROM observations").all() as { agent_id: string }[]

        return {
          success: true,
          observations: totalObs.c,
          summaries: totalSums.c,
          sessions: totalSessions.c,
          agents: agents.map((a) => a.agent_id),
          database: dbPath,
          tokenBudget: config.tokenBudget,
        }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  // ──────────────────────────────────────────────────────
  // Tool: mem-forget
  // ──────────────────────────────────────────────────────
  api.registerTool({
    name: "mem-forget",
    description: "Delete memories from a specific session. Use with caution.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID to forget" },
      },
      required: ["sessionId"],
    },
    async execute(params: Record<string, unknown>) {
      try {
        const sessionId = String(params.sessionId)
        const deleted = obsStore.deleteBySession(sessionId)
        return {
          success: true,
          sessionId,
          observationsDeleted: deleted,
        }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })

  // ──────────────────────────────────────────────────────
  // Graceful shutdown
  // ──────────────────────────────────────────────────────
  if (api.registerHook) {
    api.registerHook("gateway_stop", async () => {
      logger.info("[claw-mem] Shutting down...")
      db.close()
    })
  }

  logger.info("[claw-mem] Loaded successfully")
}

// Re-export core modules for external use (e.g., coc-backup integration)
export { Database } from "./src/db/database.ts"
export { ObservationStore } from "./src/db/observation-store.ts"
export { SummaryStore } from "./src/db/summary-store.ts"
export { SessionStore } from "./src/db/session-store.ts"
export { SearchEngine } from "./src/search/search.ts"
export { buildContext } from "./src/context/builder.ts"
export { extractObservation } from "./src/observer/extractor.ts"
export { summarizeSession } from "./src/observer/summarizer.ts"
export { ClawMemConfigSchema, resolveDbPath, resolveDataDir } from "./src/config.ts"
export type { ClawMemConfig } from "./src/config.ts"
export type * from "./src/types.ts"
