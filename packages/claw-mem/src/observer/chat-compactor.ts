// Chat compactor — rolls a batch of message_received / message_sent rows into
// a single chat_compaction observation, then optionally hard-prunes the
// low-importance originals to reclaim space.
//
// Triggers (driven by the hooks layer, not this file):
//   - every N new chat events (counter in hooks/index.ts)
//   - on agent_end / session_end (opportunistic flush)
//   - manual: future `openclaw mem compact` CLI
//
// Output: a single observation with
//   tool_name = "chat_compaction"
//   type      = "learning"
//   concepts  = ["chat-memory", "compaction"]
//   facts     = ["batch_size:N", "importance_avg:X.XX", "session_count:M"]
//   narrative = LLM (or heuristic) summary of the batch
//
// The summarizer picked is whatever's already configured for session
// summaries (`config.summarizer`) — `openclaw` mode by default, falling
// back to `heuristic` when the spawn fails. This keeps "what model do we
// use for X?" centralized in one place.

import type { ClawMemConfig, ChatMemoryConfig } from "../config.ts"
import type { Database } from "../db/database.ts"
import type { ObservationStore } from "../db/observation-store.ts"
import type { Observation, ObservationInput, PluginLogger } from "../types.ts"

export type { Observation }
import type { SessionSummarizer } from "./index.ts"

export interface ChatCompactorDeps {
  db: Database
  observations: ObservationStore
  summarizer: SessionSummarizer
  config: ClawMemConfig
  logger: PluginLogger
}

export interface CompactionResult {
  /** Number of chat rows pulled from the queue. 0 = nothing to do. */
  batchSize: number
  /** id of the chat_compaction observation that was inserted; null when batchSize=0. */
  compactionId: number | null
  /** Number of low-value rows pruned after the compaction (when deleteCompactedLowValue=true). */
  prunedCount: number
}

/**
 * Run a single compaction pass for one agent. Pulls up to
 * `chatMemory.compaction.triggerEvery * 5` uncompacted chat rows (so an
 * occasional skipped trigger still drains), summarizes them, marks them
 * compacted, optionally prunes the low-value ones.
 *
 * Safe to call when chat compaction is disabled (returns a zero result).
 * Safe to call when there are no uncompacted rows (returns a zero result).
 */
export async function runChatCompaction(
  deps: ChatCompactorDeps,
  agentId: string,
): Promise<CompactionResult> {
  const compactionCfg = deps.config.chatMemory.compaction
  if (!deps.config.chatMemory.enabled || !compactionCfg.enabled) {
    return { batchSize: 0, compactionId: null, prunedCount: 0 }
  }

  // Pull a generous batch — `triggerEvery * 5` lets a delayed trigger drain
  // backlog without unbounded memory. Cap at 200 to stay safe.
  const pullLimit = Math.min(200, Math.max(compactionCfg.triggerEvery, 1) * 5)
  const batch = deps.observations.getUncompactedChat(agentId, pullLimit)
  if (batch.length === 0) {
    return { batchSize: 0, compactionId: null, prunedCount: 0 }
  }

  // Always retain the most-recent `keepRecentRaw` chats outside compaction —
  // those are the freshest context the agent can re-read directly. Batch
  // arrives in chronological order (oldest first), so the *last* keepRecent
  // entries are the recent ones we want to skip.
  const keepRecent = Math.max(0, compactionCfg.keepRecentRaw)
  let compactable: Observation[]
  if (batch.length <= keepRecent) {
    compactable = []
  } else if (keepRecent > 0) {
    compactable = batch.slice(0, batch.length - keepRecent)
  } else {
    compactable = batch
  }
  if (compactable.length === 0) {
    return { batchSize: 0, compactionId: null, prunedCount: 0 }
  }

  // Build a synthetic "session" for the summarizer. The summarizer accepts
  // any list of observations; we don't need a real session boundary.
  const sessionId = `chat-compaction:${agentId}:${Date.now()}`
  const userPrompt = `Compact ${compactable.length} chat observations`
  let summaryNarrative = ""
  try {
    const summary = await deps.summarizer(sessionId, agentId, compactable, userPrompt)
    summaryNarrative = [summary.request, summary.investigated, summary.learned, summary.completed, summary.nextSteps]
      .filter((s): s is string => Boolean(s))
      .join("\n\n")
  } catch (error) {
    deps.logger.warn(`[claw-mem] chat-compaction summarizer failed; falling back to concat: ${String(error)}`)
    summaryNarrative = compactable
      .map((o) => `- ${o.title}${o.narrative ? ": " + o.narrative.slice(0, 200) : ""}`)
      .join("\n")
      .slice(0, 4000)
  }

  const importanceAvg = compactable.reduce((sum, o) => sum + (o.importance ?? 0.5), 0) / compactable.length
  const sessionIds = Array.from(new Set(compactable.map((o) => o.sessionId)))
  const compactionInput: ObservationInput = {
    sessionId,
    agentId,
    type: "learning",
    title: `Chat compaction (${compactable.length} msgs)`,
    facts: [
      `batch_size:${compactable.length}`,
      `importance_avg:${importanceAvg.toFixed(2)}`,
      `session_count:${sessionIds.length}`,
      `oldest:${compactable[0]?.createdAt ?? "?"}`,
      `newest:${compactable[compactable.length - 1]?.createdAt ?? "?"}`,
    ],
    narrative: summaryNarrative || null,
    concepts: ["chat-memory", "compaction"],
    filesRead: [],
    filesModified: [],
    toolName: "chat_compaction",
    promptNumber: 0,
    importance: 0.9, // compactions are load-bearing for recall — protect from prune
  }

  // Single transaction so the parent insert + child marks are atomic.
  let compactionId = 0
  let prunedCount = 0
  deps.db.connection.exec("BEGIN")
  try {
    compactionId = deps.observations.insert(compactionInput)
    deps.observations.markCompacted(compactable.map((o) => o.id), compactionId)
    deps.db.connection.exec("COMMIT")
  } catch (err) {
    deps.db.connection.exec("ROLLBACK")
    throw err
  }

  if (compactionCfg.deleteCompactedLowValue) {
    try {
      prunedCount = deps.observations.pruneCompactedLowValue({
        agentId,
        minImportance: compactionCfg.minImportanceToKeep,
        keepRecent,
      })
    } catch (err) {
      deps.logger.warn(`[claw-mem] chat-compaction prune failed: ${String(err)}`)
    }
  }

  deps.logger.info(
    `[claw-mem] chat-compaction: rolled ${compactable.length} msgs into obs#${compactionId} ` +
      `(importance_avg=${importanceAvg.toFixed(2)}, pruned=${prunedCount})`,
  )

  return { batchSize: compactable.length, compactionId, prunedCount }
}

/**
 * Stateful counter helper used by hooks/index.ts to throttle compaction
 * triggers. Call `tick()` after each chat capture; when it returns true,
 * the caller should run `runChatCompaction()`.
 */
export class CompactionTrigger {
  private counter = 0
  private readonly cfg: Pick<ChatMemoryConfig["compaction"], "enabled" | "triggerEvery">

  constructor(cfg: Pick<ChatMemoryConfig["compaction"], "enabled" | "triggerEvery">) {
    this.cfg = cfg
  }

  tick(): boolean {
    if (!this.cfg.enabled) return false
    this.counter++
    if (this.counter >= Math.max(1, this.cfg.triggerEvery)) {
      this.counter = 0
      return true
    }
    return false
  }

  reset(): void {
    this.counter = 0
  }
}
