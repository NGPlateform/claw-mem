// Factory that picks the session summarizer to use based on config.
//
// Consumers (session_end hook, explicit CLI summarize command) call
// `await summarizer(sessionId, agentId, obs, userPrompt)` and never have to
// know whether the implementation is heuristic or LLM-powered. The choice is
// made once at bootstrap time from the user's `summarizer.mode` config.

import type { Observation, SummaryInput } from "../types.ts"
import type { SummarizerConfig } from "../config.ts"
import { summarizeSession as heuristicSummarize } from "./summarizer.ts"
import { summarizeSessionWithLLM, type LLMSummarizerDeps } from "./summarizer-llm.ts"
import { summarizeSessionWithOpenClaw, type OpenClawSummarizerDeps } from "./summarizer-openclaw.ts"

export type SessionSummarizer = (
  sessionId: string,
  agentId: string,
  observations: Observation[],
  userPrompt?: string,
) => Promise<SummaryInput>

export interface CreateSummarizerOptions {
  /** For tests: inject a fake Anthropic SDK messages.create shim. */
  llmDeps?: LLMSummarizerDeps
  /** For tests: inject a fake openclaw spawn runner. */
  openclawDeps?: OpenClawSummarizerDeps
}

export function createSummarizer(
  config: SummarizerConfig,
  opts: CreateSummarizerOptions = {},
): SessionSummarizer {
  if (config.mode === "openclaw") {
    return (sessionId, agentId, observations, userPrompt) =>
      summarizeSessionWithOpenClaw(sessionId, agentId, observations, userPrompt, config.openclaw, opts.openclawDeps)
  }
  if (config.mode === "llm") {
    return (sessionId, agentId, observations, userPrompt) =>
      summarizeSessionWithLLM(sessionId, agentId, observations, userPrompt, config.llm, opts.llmDeps)
  }
  return async (sessionId, agentId, observations, userPrompt) =>
    heuristicSummarize(sessionId, agentId, observations, userPrompt)
}

// Re-exports for consumers that want a direct handle on either implementation.
export { summarizeSession } from "./summarizer.ts"
export { summarizeSessionWithLLM } from "./summarizer-llm.ts"
export { summarizeSessionWithOpenClaw } from "./summarizer-openclaw.ts"
export { extractObservation } from "./extractor.ts"
export type { LLMSummarizerDeps } from "./summarizer-llm.ts"
export type { OpenClawSummarizerDeps } from "./summarizer-openclaw.ts"
