// Context builder: assembles token-budgeted memory context for injection
// into the agent's system prompt via before_prompt_build hook

import type { Observation, SessionSummary, MemoryContext } from "../types.ts"
import { formatContext } from "./formatter.ts"

const CHARS_PER_TOKEN = 4

interface BuildContextOptions {
  observations: Observation[]
  summaries: SessionSummary[]
  tokenBudget: number
  agentId: string
}

/**
 * Build a token-budgeted memory context from observations and summaries.
 * Summaries are packed first (higher information density), then observations.
 */
export function buildContext(options: BuildContextOptions): MemoryContext {
  const { observations, summaries, tokenBudget, agentId } = options

  let tokensUsed = 0
  const packedSummaries: SessionSummary[] = []
  const packedObservations: Observation[] = []

  // Pack summaries first (higher value per token)
  for (const summary of summaries) {
    const tokens = summary.tokenEstimate || estimateSummaryTokens(summary)
    if (tokensUsed + tokens > tokenBudget) break
    packedSummaries.push(summary)
    tokensUsed += tokens
  }

  // Pack observations with remaining budget
  for (const obs of observations) {
    const tokens = obs.tokenEstimate || estimateObsTokens(obs)
    if (tokensUsed + tokens > tokenBudget) break
    packedObservations.push(obs)
    tokensUsed += tokens
  }

  if (packedSummaries.length === 0 && packedObservations.length === 0) {
    return {
      markdown: "",
      tokensUsed: 0,
      observationCount: 0,
      summaryCount: 0,
    }
  }

  const markdown = formatContext({
    observations: packedObservations,
    summaries: packedSummaries,
    agentId,
    tokensUsed,
    tokenBudget,
  })

  return {
    markdown,
    tokensUsed,
    observationCount: packedObservations.length,
    summaryCount: packedSummaries.length,
  }
}

function estimateSummaryTokens(s: SessionSummary): number {
  let chars = 0
  if (s.request) chars += s.request.length
  if (s.investigated) chars += s.investigated.length
  if (s.learned) chars += s.learned.length
  if (s.completed) chars += s.completed.length
  if (s.nextSteps) chars += s.nextSteps.length
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

function estimateObsTokens(o: Observation): number {
  let chars = o.title.length
  if (o.narrative) chars += o.narrative.length
  for (const f of o.facts) chars += f.length
  return Math.ceil(chars / CHARS_PER_TOKEN)
}
