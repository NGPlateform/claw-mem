// OpenClaw hook handlers for claw-mem
// Registers lifecycle hooks that capture observations and inject context

import type { Database } from "../db/database.ts"
import type { ClawMemConfig } from "../config.ts"
import type { Observation } from "../types.ts"
import type { PluginApi, PluginLogger } from "../types.ts"
import { ObservationStore } from "../db/observation-store.ts"
import { SummaryStore } from "../db/summary-store.ts"
import { SessionStore } from "../db/session-store.ts"
import { SearchEngine } from "../search/search.ts"
import { extractObservation } from "../observer/extractor.ts"
import { extractChatObservation, type ChatRole } from "../observer/extractor-chat.ts"
import { createSummarizer } from "../observer/index.ts"
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
  const searchEngine = new SearchEngine(db)
  const summarizer = createSummarizer(config.summarizer)
  if (config.summarizer.mode === "llm") {
    logger.info(`[claw-mem] summarizer mode=llm (model=${config.summarizer.llm.model}, fallback=${config.summarizer.llm.fallbackOnError})`)
  } else if (config.summarizer.mode === "openclaw") {
    const modelLabel = config.summarizer.openclaw.model ?? "default"
    logger.info(`[claw-mem] summarizer mode=openclaw (bin=${config.summarizer.openclaw.bin}, model=${modelLabel}, fallback=${config.summarizer.openclaw.fallbackOnError})`)
  }
  if (config.chatMemory.enabled) {
    logger.info(
      `[claw-mem] chat-memory enabled (explicitOnly=${config.chatMemory.explicitOnly}, ` +
      `minChars=${config.chatMemory.minChars}, captureAssistant=${config.chatMemory.captureAssistant})`,
    )
  }
  logger.info(`[claw-mem] context recall mode=${config.contextRecall.mode}`)

  // Track current session per agent (in-memory).
  // `lastUserMessage` doubles as the query seed for hybrid recall and as the
  // userPrompt fed to the session summarizer at agent_end.
  const activeSessions = new Map<string, {
    sessionId: string
    agentId: string
    promptCount: number
    lastUserMessage?: string
  }>()

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
  // before_prompt_build: inject memory context (hybrid recall)
  // ──────────────────────────────────────────────────────
  const onBeforePromptBuild = async (event: unknown) => {
    try {
      const ctx = event as {
        agentId?: string
        sessionId?: string
        messages?: Array<{ role?: string; content?: unknown }>
        userMessage?: string
      }
      const agentId = ctx.agentId ?? "default"

      const session = activeSessions.get(agentId)
      if (session) session.promptCount++

      // Seed the recall query from session.lastUserMessage (set by
      // message_received). If that's empty (older host that doesn't emit
      // message_received), fall back to whatever the prompt-build event
      // exposes so hybrid recall still has something to work with.
      const fallbackQuery = session?.lastUserMessage ?? extractMessageText(ctx) ?? ""

      const candidates = recallObservations({
        agentId,
        query: fallbackQuery,
        mode: config.contextRecall.mode,
        searchLimitRatio: config.contextRecall.searchLimitRatio,
        maxObservations: config.maxObservations,
        observations,
        searchEngine,
        logger,
      })
      const recentSums = summaries.getRecent(agentId, config.maxSummaries)

      if (candidates.length === 0 && recentSums.length === 0) return undefined

      const context = buildContext({
        observations: candidates,
        summaries: recentSums,
        tokenBudget: config.tokenBudget,
        agentId,
      })

      if (!context.markdown) return undefined

      logger.info(
        `[claw-mem] Injecting context: ${context.summaryCount} summaries, ` +
        `${context.observationCount} observations, ${context.tokensUsed} tokens` +
        (config.contextRecall.mode === "hybrid" && fallbackQuery ? " (hybrid)" : ""),
      )

      return { prependContext: context.markdown }
    } catch (error) {
      logger.error(`[claw-mem] before_prompt_build error: ${String(error)}`)
      return undefined
    }
  }

  // ──────────────────────────────────────────────────────
  // message_received: capture user chat as observation
  // ──────────────────────────────────────────────────────
  const onMessageReceived = async (event: unknown) => {
    try {
      if (!config.chatMemory.enabled) return
      await captureChatMessage(event, "user")
    } catch (error) {
      logger.error(`[claw-mem] message_received error: ${String(error)}`)
    }
  }

  // ──────────────────────────────────────────────────────
  // message_sent: optional capture of assistant chat
  // ──────────────────────────────────────────────────────
  const onMessageSent = async (event: unknown) => {
    try {
      if (!config.chatMemory.enabled) return
      if (!config.chatMemory.captureAssistant) return
      await captureChatMessage(event, "assistant")
    } catch (error) {
      logger.error(`[claw-mem] message_sent error: ${String(error)}`)
    }
  }

  async function captureChatMessage(event: unknown, role: ChatRole): Promise<void> {
    const ctx = event as {
      agentId?: string
      sessionId?: string
      text?: string
      content?: unknown
      message?: { role?: string; content?: unknown; text?: string }
    }
    const text = extractMessageText(ctx)
    if (!text) return

    const agentId = ctx.agentId ?? "default"
    const session = activeSessions.get(agentId)
    const sessionId = ctx.sessionId ?? session?.sessionId ?? `session-${Date.now()}`

    // Update session.lastUserMessage so the next before_prompt_build can
    // use it as the hybrid-recall query seed.
    if (role === "user" && session) session.lastUserMessage = text

    const obs = extractChatObservation(
      {
        role,
        text,
        sessionId,
        agentId,
        promptNumber: session?.promptCount ?? 0,
      },
      config.chatMemory,
    )
    if (!obs) return
    if (observations.isDuplicate(obs, config.dedupWindowMs)) return
    observations.insert(obs)
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

      const summary = await summarizer(
        sessionId,
        agentId,
        sessionObs,
        session?.lastUserMessage,
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
    api.on("message_received", onMessageReceived)
    api.on("message_sent", onMessageSent)
    api.on("agent_end", onAgentEnd)
    api.on("session_end", onSessionEnd)
  } else if (api.registerHook) {
    // Legacy hook registration: legacy API expects Promise<void>; wrap to discard
    // the structured return value of before_prompt_build (only the new `on()` API
    // can read it, but the hook's side effects still run).
    api.registerHook("session_start", onSessionStart)
    api.registerHook("before_prompt_build", async (event: unknown) => {
      await onBeforePromptBuild(event)
    })
    api.registerHook("after_tool_call", onAfterToolCall)
    api.registerHook("message_received", onMessageReceived)
    api.registerHook("message_sent", onMessageSent)
    api.registerHook("agent_end", onAgentEnd)
    api.registerHook("session_end", onSessionEnd)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/** Hybrid recall: search hits on the latest user message + recent tail, deduped. */
function recallObservations(args: {
  agentId: string
  query: string
  mode: "recent" | "hybrid"
  searchLimitRatio: number
  maxObservations: number
  observations: ObservationStore
  searchEngine: SearchEngine
  logger: PluginLogger
}): Observation[] {
  const {
    agentId, query, mode, searchLimitRatio, maxObservations,
    observations, searchEngine, logger,
  } = args

  if (mode !== "hybrid" || query.length < 2) {
    return observations.getRecent(agentId, maxObservations)
  }

  const searchLimit = Math.max(1, Math.ceil(maxObservations * searchLimitRatio))
  let searchHits: Observation[] = []
  try {
    searchHits = searchEngine.search({ query, agentId, limit: searchLimit }).results
  } catch (e) {
    logger.warn(`[claw-mem] hybrid recall search failed; falling back to recent-only: ${String(e)}`)
  }

  const recent = observations.getRecent(agentId, maxObservations)
  const seen = new Set<number>()
  const merged: Observation[] = []
  for (const obs of searchHits) {
    if (seen.has(obs.id)) continue
    merged.push(obs)
    seen.add(obs.id)
  }
  for (const obs of recent) {
    if (seen.has(obs.id)) continue
    merged.push(obs)
    seen.add(obs.id)
    if (merged.length >= maxObservations) break
  }
  return merged
}

/** Defensive text extraction from heterogeneous chat-event shapes. */
function extractMessageText(ctx: unknown): string {
  if (!ctx || typeof ctx !== "object") return ""
  const obj = ctx as Record<string, unknown>

  // Direct flat field
  if (typeof obj.text === "string" && obj.text.trim()) return obj.text.trim()
  if (typeof obj.userMessage === "string" && obj.userMessage.trim()) return obj.userMessage.trim()
  if (typeof obj.content === "string" && obj.content.trim()) return obj.content.trim()

  // Nested message.{text,content}
  const msg = obj.message as Record<string, unknown> | undefined
  if (msg) {
    if (typeof msg.text === "string" && msg.text.trim()) return msg.text.trim()
    if (typeof msg.content === "string" && msg.content.trim()) return msg.content.trim()
  }

  // messages array — pick the last user message we can find
  const messages = obj.messages as Array<{ role?: string; content?: unknown }> | undefined
  if (Array.isArray(messages) && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.role === "user" && typeof m.content === "string" && m.content.trim()) {
        return m.content.trim()
      }
    }
    const last = messages[messages.length - 1]
    if (typeof last?.content === "string" && last.content.trim()) return last.content.trim()
  }

  return ""
}
