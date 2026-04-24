// Session summarizer: generates session summaries from observations
// Uses a heuristic approach (no LLM required) by aggregating observation data

import type { Observation, SummaryInput } from "../types.ts"

/**
 * Generate a session summary from a list of observations.
 * This is a heuristic summarizer that doesn't require an LLM call.
 * For higher-quality summaries, override with an LLM-powered summarizer.
 */
export function summarizeSession(
  sessionId: string,
  agentId: string,
  observations: Observation[],
  userPrompt?: string,
): SummaryInput {
  if (observations.length === 0) {
    return {
      sessionId,
      agentId,
      request: userPrompt ?? null,
      investigated: null,
      learned: null,
      completed: null,
      nextSteps: null,
      notes: null,
      observationCount: 0,
    }
  }

  const discoveries = observations.filter((o) => o.type === "discovery")
  const decisions = observations.filter((o) => o.type === "decision")
  const changes = observations.filter((o) => o.type === "change")
  const learnings = observations.filter((o) => o.type === "learning")
  const issues = observations.filter((o) => o.type === "issue")

  // Investigated: what was explored (discoveries + reads)
  const investigated = discoveries.length > 0
    ? discoveries
        .slice(0, 5)
        .map((d) => d.title)
        .join("; ")
    : null

  // Learned: key findings (learnings + decisions)
  const learnedItems = [...learnings, ...decisions]
  const learned = learnedItems.length > 0
    ? learnedItems
        .slice(0, 5)
        .map((l) => l.title)
        .join("; ")
    : null

  // Completed: changes made
  const completed = changes.length > 0
    ? changes
        .slice(0, 5)
        .map((c) => c.title)
        .join("; ")
    : null

  // Next steps: derive from issues + recent context
  const nextSteps = issues.length > 0
    ? issues
        .slice(0, 3)
        .map((i) => `Address: ${i.title}`)
        .join("; ")
    : null

  // All unique files modified
  const allModified = [...new Set(observations.flatMap((o) => o.filesModified))]
  const notes = allModified.length > 0
    ? `Files modified: ${allModified.slice(0, 10).join(", ")}`
    : null

  return {
    sessionId,
    agentId,
    request: userPrompt ?? null,
    investigated,
    learned,
    completed,
    nextSteps,
    notes,
    observationCount: observations.length,
  }
}
