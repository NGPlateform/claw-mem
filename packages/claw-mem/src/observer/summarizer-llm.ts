// LLM-powered session summarizer (optional override).
//
// Upgrades the default heuristic summarizer (summarizer.ts) with a Claude API
// call so the per-session summary gets real language understanding — the
// heuristic version can only stringify observation titles by bucket.
//
// Activation: set `summarizer.mode: "llm"` in claw-mem config and either
// provide `summarizer.llm.apiKey` or set ANTHROPIC_API_KEY env var.
//
// The @anthropic-ai/sdk is declared as an optionalDependency. If the SDK
// isn't installed, or the API call fails, the summarizer falls back to the
// heuristic path so observations still get summaries (with `fallbackOnError`
// true, which is the default).

import type { Observation, SummaryInput } from "../types.ts"
import type { SummarizerLLMConfig } from "../config.ts"
import { summarizeSession as heuristicSummarize } from "./summarizer.ts"

const SYSTEM_PROMPT = `You are a session summarizer for an AI agent's long-term memory system.

Given a list of structured observations from one work session (each observation describes a tool call the agent made: what it read, changed, discovered, or decided), you must produce a compact summary that:

- captures what the user asked for
- lists what was investigated, learned, completed, and what's still open
- stays under 600 words total across all fields
- speaks in plain declarative English, no filler

Return a single JSON object with these exact keys, all strings (use null for empty):
{
  "investigated": "what was explored/read/searched, as a single sentence or semicolon-separated clauses",
  "learned": "key findings / decisions, same format",
  "completed": "what shipped (files written, commits, deployments)",
  "nextSteps": "open issues or follow-ups, null if none",
  "notes": "loose ends worth keeping, null if none"
}

Return ONLY the JSON object, no prose before or after, no markdown fencing.`

export interface LLMSummarizerDeps {
  /** Override for tests: swap the SDK call with a stub. */
  messagesCreate?: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text?: string }> }>
}

/**
 * Generate a session summary via Claude API.
 *
 * On failure (SDK missing, API error, malformed response), falls back to
 * the heuristic summary when `config.fallbackOnError` is true (default),
 * or re-throws when false.
 */
export async function summarizeSessionWithLLM(
  sessionId: string,
  agentId: string,
  observations: Observation[],
  userPrompt: string | undefined,
  config: SummarizerLLMConfig,
  deps: LLMSummarizerDeps = {},
): Promise<SummaryInput> {
  if (observations.length === 0) {
    return heuristicSummarize(sessionId, agentId, observations, userPrompt)
  }

  const fallback = () => heuristicSummarize(sessionId, agentId, observations, userPrompt)

  let messagesCreate = deps.messagesCreate
  if (!messagesCreate) {
    try {
      // Dynamic specifier so TS does not resolve the optional SDK at compile time.
      const sdkModule = "@anthropic-ai/sdk"
      const mod = (await import(sdkModule)) as { default?: unknown; Anthropic?: unknown }
      const Anthropic = mod.default ?? mod.Anthropic
      const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        if (config.fallbackOnError) return fallback()
        throw new Error("LLM summarizer: ANTHROPIC_API_KEY not set and summarizer.llm.apiKey not configured")
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = new (Anthropic as any)({
        apiKey,
        baseURL: config.baseURL,
        timeout: config.timeoutMs,
      })
      messagesCreate = (args) => client.messages.create(args)
    } catch (err) {
      if (config.fallbackOnError) return fallback()
      throw new Error(
        `LLM summarizer requires @anthropic-ai/sdk. Install it (npm i @anthropic-ai/sdk) or enable summarizer.llm.fallbackOnError. Original error: ${String(err)}`,
      )
    }
  }

  const userMessage = buildUserMessage(observations, userPrompt)

  try {
    const response = await messagesCreate({
      model: config.model,
      max_tokens: config.maxTokens,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // Prompt cache the system prompt — it never changes across calls,
          // so every summarizer request after the first hits the cache.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    })

    const text = extractText(response)
    const parsed = parseJSON(text)
    return {
      sessionId,
      agentId,
      request: userPrompt ?? null,
      investigated: stringOrNull(parsed.investigated),
      learned: stringOrNull(parsed.learned),
      completed: stringOrNull(parsed.completed),
      nextSteps: stringOrNull(parsed.nextSteps),
      notes: stringOrNull(parsed.notes),
      observationCount: observations.length,
    }
  } catch (err) {
    if (config.fallbackOnError) return fallback()
    throw err
  }
}

function buildUserMessage(observations: Observation[], userPrompt: string | undefined): string {
  const lines: string[] = []
  if (userPrompt) lines.push(`User request: ${userPrompt}`, "")
  lines.push(`Observations (${observations.length}):`)
  for (const o of observations) {
    const factsPreview = o.facts.length > 0 ? ` | facts: ${o.facts.slice(0, 3).join("; ")}` : ""
    const filesModified = o.filesModified.length > 0 ? ` | modified: ${o.filesModified.slice(0, 3).join(", ")}` : ""
    lines.push(`- [${o.type}] ${o.title}${factsPreview}${filesModified}`)
  }
  return lines.join("\n")
}

function extractText(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content.find((b) => b.type === "text")
  if (!block || !block.text) throw new Error("LLM response contained no text block")
  return block.text.trim()
}

function parseJSON(text: string): Record<string, unknown> {
  // Be lenient: sometimes models emit ```json fences despite instructions.
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
  try {
    return JSON.parse(unfenced) as Record<string, unknown>
  } catch (err) {
    throw new Error(`LLM returned malformed JSON: ${String(err).slice(0, 160)}`)
  }
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}
