// OpenClaw hook handlers for claw-mem
// Registers lifecycle hooks that capture observations and inject context

import type { Database } from "../db/database.ts"
import type { ClawMemConfig } from "../config.ts"
import type { PluginApi, PluginLogger } from "../types.ts"
import { ObservationStore } from "../db/observation-store.ts"
import { SummaryStore } from "../db/summary-store.ts"
import { SessionStore } from "../db/session-store.ts"
import { SearchEngine } from "../search/search.ts"
import { extractObservation } from "../observer/extractor.ts"
import { summarizeSession } from "../observer/summarizer.ts"
import { buildContext } from "../context/builder.ts"

export function registerHooks(
  api: PluginApi,
  db: Database,
  config: ClawMemConfig,
  logger: PluginLogger,
): void {
  const observations = new ObservationStore(db)
  const summaries = new SummaryStore(db)
  const sessions = new SessionStore(db)

  // Track current session per agent (in-memory)
  const activeSessions = new Map<string, { sessionId: string; agentId: string; promptCount: number; userPrompt?: string }>()

  // ──────────────────────────────────────────────────────
  // session_start: initialize session tracking
  // ──────────────────────────────────────────────────────
  const onSessionStart = async (event: unknown) => {
    try {
      const ctx = event as { agentId?: string; sessionId?: string; sessionKey?: string }
      const agentId = ctx.agentId ?? "default"
      const sessionId = ctx.sessionId ?? ctx.sessionKey ?? `session-${Date.now()}`

      sessions.startSession(sessionId, agentId)
      activeSessions.set(agentId, { sessionId, agentId, promptCount: 0 })

      logger.info(`[claw-mem] Session started: ${sessionId} (agent: ${agentId})`)
    } catch (error) {
      logger.error(`[claw-mem] session_start error: ${String(error)}`)
    }
  }

  // ──────────────────────────────────────────────────────
  // before_prompt_build: inject memory context
  // ──────────────────────────────────────────────────────
  const onBeforePromptBuild = async (event: unknown) => {
    try {
      const ctx = event as { agentId?: string; sessionId?: string }
      const agentId = ctx.agentId ?? "default"

      // Track user prompt for summary
      const session = activeSessions.get(agentId)
      if (session) {
        session.promptCount++
      }

      const recentObs = observations.getRecent(agentId, config.maxObservations)
      const recentSums = summaries.getRecent(agentId, config.maxSummaries)

      if (recentObs.length === 0 && recentSums.length === 0) return undefined

      const context = buildContext({
        observations: recentObs,
        summaries: recentSums,
        tokenBudget: config.tokenBudget,
        agentId,
      })

      if (!context.markdown) return undefined

      logger.info(
        `[claw-mem] Injecting context: ${context.summaryCount} summaries, ` +
        `${context.observationCount} observations, ${context.tokensUsed} tokens`,
      )

      return { prependContext: context.markdown }
    } catch (error) {
      logger.error(`[claw-mem] before_prompt_build error: ${String(error)}`)
      return undefined
    }
  }

  // ──────────────────────────────────────────────────────
  // after_tool_call: capture observations
  // ──────────────────────────────────────────────────────
  const onAfterToolCall = async (event: unknown) => {
    try {
      const ctx = event as {
        agentId?: string
        sessionId?: string
        toolName?: string
        toolInput?: Record<string, unknown>
        toolOutput?: string
        result?: { content?: string }
      }

      const toolName = ctx.toolName ?? ""
      if (config.skipTools.includes(toolName)) return

      const agentId = ctx.agentId ?? "default"
      const session = activeSessions.get(agentId)
      const sessionId = ctx.sessionId ?? session?.sessionId ?? "unknown"
      const toolOutput = ctx.toolOutput ?? ctx.result?.content ?? ""

      const obs = extractObservation({
        toolName,
        toolInput: ctx.toolInput ?? {},
        toolOutput: typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput),
        sessionId,
        agentId,
        promptNumber: session?.promptCount ?? 0,
      })

      if (!obs) return
      if (observations.isDuplicate(obs, config.dedupWindowMs)) return

      observations.insert(obs)
    } catch (error) {
      logger.error(`[claw-mem] after_tool_call error: ${String(error)}`)
    }
  }

  // ──────────────────────────────────────────────────────
  // agent_end: generate session summary
  // ──────────────────────────────────────────────────────
  const onAgentEnd = async (event: unknown) => {
    try {
      const ctx = event as { agentId?: string; sessionId?: string }
      const agentId = ctx.agentId ?? "default"
      const session = activeSessions.get(agentId)
      const sessionId = ctx.sessionId ?? session?.sessionId

      if (!sessionId) return

      const sessionObs = observations.getBySession(sessionId)
      if (sessionObs.length === 0) return

      const summary = summarizeSession(
        sessionId,
        agentId,
        sessionObs,
        session?.userPrompt,
      )
      summaries.upsert(summary)

      logger.info(`[claw-mem] Summary generated: ${sessionObs.length} observations → summary for ${sessionId}`)
    } catch (error) {
      logger.error(`[claw-mem] agent_end error: ${String(error)}`)
    }
  }

  // ──────────────────────────────────────────────────────
  // session_end: finalize session
  // ──────────────────────────────────────────────────────
  const onSessionEnd = async (event: unknown) => {
    try {
      const ctx = event as { agentId?: string; sessionId?: string }
      const agentId = ctx.agentId ?? "default"
      const session = activeSessions.get(agentId)
      const sessionId = ctx.sessionId ?? session?.sessionId

      if (sessionId) {
        sessions.endSession(sessionId)
      }
      activeSessions.delete(agentId)

      logger.info(`[claw-mem] Session ended: ${sessionId ?? "unknown"}`)
    } catch (error) {
      logger.error(`[claw-mem] session_end error: ${String(error)}`)
    }
  }

  // ──────────────────────────────────────────────────────
  // Register all hooks
  // ──────────────────────────────────────────────────────
  if (api.on) {
    // Newer OpenClaw API with priority support
    api.on("session_start", onSessionStart)
    api.on("before_prompt_build", onBeforePromptBuild, { priority: 50 })
    api.on("after_tool_call", onAfterToolCall)
    api.on("agent_end", onAgentEnd)
    api.on("session_end", onSessionEnd)
  } else if (api.registerHook) {
    // Legacy hook registration
    api.registerHook("session_start", onSessionStart)
    api.registerHook("before_prompt_build", onBeforePromptBuild)
    api.registerHook("after_tool_call", onAfterToolCall)
    api.registerHook("agent_end", onAgentEnd)
    api.registerHook("session_end", onSessionEnd)
  }
}
