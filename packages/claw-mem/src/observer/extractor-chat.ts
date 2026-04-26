// Chat-message observation extractor.
//
// Companion to extractor.ts (which is tool-call oriented). This one fires from
// `message_received` / `message_sent` hooks so that pure chat sessions — where
// the user just types things and the agent just talks back — still build up
// useful long-term memory.
//
// Zero-migration: emitted observations carry `toolName: "message_received"`
// (user) or `toolName: "message_sent"` (assistant) and slot into the existing
// observations table / FTS5 index. The 1:1 mapping with the originating hook
// name makes it easy to filter (`tool_name IN ('message_received','message_sent')`)
// for "all chat" or pull just one direction. No schema change.

import type { ObservationInput, ObservationType } from "../types.ts"

export type ChatRole = "user" | "assistant"

export interface ChatExtractorCues {
  /** High-priority phrases that force a `learning`/`decision` capture (e.g. "记一下", "remember this"). */
  explicit: string[]
  /** Preference / habit phrases (e.g. "我喜欢", "from now on") — captured as `learning` when explicitOnly=false. */
  preference: string[]
}

export interface ChatExtractorOptions {
  /** Disable chat capture entirely. */
  enabled: boolean
  /** Only capture when an explicit cue matches (suppresses preference + plain capture). */
  explicitOnly: boolean
  /** Hard floor on text length (characters); shorter messages are dropped as chitchat. */
  minChars: number
  /** Truncate the captured narrative body at this many characters. */
  maxNarrativeChars: number
  /** Cue dictionaries. */
  cues: ChatExtractorCues
  /** Capture assistant messages via message_sent. Default off. */
  captureAssistant: boolean
}

export interface ChatEvent {
  role: ChatRole
  text: string
  sessionId: string
  agentId: string
  promptNumber: number
}

const TITLE_MAX = 120

/**
 * Extract a single observation from a chat message, or return null if it
 * shouldn't be captured (too short, no cue under explicitOnly, etc.).
 */
export function extractChatObservation(
  event: ChatEvent,
  opts: ChatExtractorOptions,
): ObservationInput | null {
  if (!opts.enabled) return null

  const text = (event.text ?? "").trim()
  if (text.length < opts.minChars) return null

  if (event.role === "assistant" && !opts.captureAssistant) return null

  const lower = text.toLowerCase()
  const explicitHit = opts.cues.explicit.find((c) => containsCue(text, lower, c))
  const preferenceHit = !explicitHit
    ? opts.cues.preference.find((c) => containsCue(text, lower, c))
    : undefined

  if (opts.explicitOnly && !explicitHit) return null

  let type: ObservationType
  let cueLabel: string | null
  if (explicitHit) {
    type = event.role === "user" ? "decision" : "decision"
    cueLabel = explicitHit
  } else if (preferenceHit) {
    type = "learning"
    cueLabel = preferenceHit
  } else {
    // No cue but explicitOnly=false — capture as low-signal `discovery` so it
    // shows up in search but doesn't dominate `learning`/`decision` filters.
    type = "discovery"
    cueLabel = null
  }

  const title = buildTitle(event.role, text, cueLabel)
  const narrative = text.length > opts.maxNarrativeChars
    ? text.slice(0, opts.maxNarrativeChars) + "..."
    : text
  const concepts = extractConcepts(text)

  // Tool name maps 1:1 to the originating hook so downstream filters can
  // query "all chat" with `tool_name IN ('message_received','message_sent')`
  // or pull just one direction.
  const toolName = event.role === "user" ? "message_received" : "message_sent"

  return {
    sessionId: event.sessionId,
    agentId: event.agentId,
    type,
    title,
    facts: cueLabel ? [`cue: ${cueLabel}`, `role: ${event.role}`] : [`role: ${event.role}`],
    narrative,
    concepts,
    filesRead: [],
    filesModified: [],
    toolName,
    promptNumber: event.promptNumber,
  }
}

function containsCue(rawText: string, lowerText: string, cue: string): boolean {
  // Try both raw (CJK / case-sensitive) and lowercased (English) — cheap and
  // covers both alphabets without normalizing Unicode case for CJK (which is
  // a no-op anyway).
  if (rawText.includes(cue)) return true
  return lowerText.includes(cue.toLowerCase())
}

function buildTitle(role: ChatRole, text: string, cue: string | null): string {
  const prefix = role === "user" ? "User" : "Assistant"
  const tag = cue ? ` [${cue}]` : ""
  const oneLine = text.replace(/\s+/g, " ").trim()
  const room = TITLE_MAX - prefix.length - tag.length - 3 // ":  " etc.
  const body = oneLine.length > room ? oneLine.slice(0, Math.max(1, room - 1)) + "…" : oneLine
  return `${prefix}${tag}: ${body}`
}

// Cheap concept extraction: pull capitalised tokens / hashtags / @mentions /
// quoted strings. Good enough to seed FTS without an LLM call.
function extractConcepts(text: string): string[] {
  const out = new Set<string>()
  const tokenRe = /[#@]?[A-Za-z][A-Za-z0-9_-]{2,}/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(text)) !== null) {
    const token = m[0]
    if (token.startsWith("#") || token.startsWith("@")) {
      out.add(token)
      continue
    }
    if (token[0] === token[0].toUpperCase() && /[A-Za-z]/.test(token[0])) {
      out.add(token)
    }
  }
  // Cap to avoid exploding token estimates; FTS5 doesn't need every word.
  return Array.from(out).slice(0, 10)
}

/** Default cue dictionary — exported so config.ts can use it as the schema default. */
export const DEFAULT_CHAT_CUES: ChatExtractorCues = {
  explicit: [
    "记一下",
    "记住",
    "长期记忆",
    "别忘了",
    "remember this",
    "note this",
    "for the record",
    "save this",
  ],
  preference: [
    "我喜欢",
    "我不喜欢",
    "我不想",
    "我偏好",
    "以后都",
    "以后请",
    "i prefer",
    "from now on",
    "always use",
    "never use",
  ],
}
