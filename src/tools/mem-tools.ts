// Agent tools that surface the claw-mem memory layer.
// Logic mirrors the original tools registered in index.ts so the agent surface
// is unchanged while index.ts becomes a thin assembly layer.

import type { CliServices } from "../cli/register-all.ts"
import type { PluginApi } from "../types.ts"

export function registerMemTools(api: PluginApi, services: CliServices): void {
  const { searchEngine, observationStore, db, dbPath, config } = services

  api.registerTool({
    name: "mem-search",
    description:
      "Search the agent's semantic memory across all past sessions. " +
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
        const result = searchEngine.search({
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

  api.registerTool({
    name: "mem-status",
    description: "View claw-mem memory statistics: total observations, summaries, and database info.",
    parameters: { type: "object", properties: {} },
    async execute() {
      try {
        const totalObs = db.connection.prepare("SELECT COUNT(*) as c FROM observations").get() as { c: number }
        const totalSums = db.connection.prepare("SELECT COUNT(*) as c FROM session_summaries").get() as { c: number }
        const totalSessions = db.connection.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }
        const agents = db.connection.prepare("SELECT DISTINCT agent_id FROM observations").all() as Array<{ agent_id: string }>
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
        const deleted = observationStore.deleteBySession(sessionId)
        return { success: true, sessionId, observationsDeleted: deleted }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
  })
}
