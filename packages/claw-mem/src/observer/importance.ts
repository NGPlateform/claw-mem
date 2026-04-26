// Heuristic importance scoring for chat observations.
//
// Returns a score in [0.0, 1.0]. The scorer is intentionally cheap (no
// model calls) so it can run inline at capture time. Bumps are additive
// from a 0.5 baseline; we clamp to [0.0, 1.0] at the end.
//
// Used by:
//   - extractor-chat.ts to set initial importance per row
//   - chat-compactor.ts to decide which rows to roll up vs preserve
//   - prune step to decide which compacted rows to hard-delete

const URL_RE = /\bhttps?:\/\/\S+/i
const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/
const DATE_RE = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}:\d{2})\b/
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/
const CODE_RE = /[`{};()=]|\bfunction\b|\bclass\b|\bimport\b|\bconst\b/
// Common low-information replies in zh-CN and English. Loose match (not anchored)
// because we strip them from longer turns too (e.g. "ok 我看完了" still has signal).
const CHITCHAT_TOKENS = new Set([
  "ok", "okay", "sure", "thanks", "thank you", "thx", "got it", "yes", "no",
  "好", "好的", "嗯", "嗯嗯", "收到", "明白", "知道了", "哈哈", "哈哈哈",
  "是的", "对", "对的", "可以",
])

const EXPLICIT_CUE_BUMP = 0.4    // "记一下" / "remember this" / etc.
const PREFERENCE_CUE_BUMP = 0.3  // "我喜欢" / "from now on" / etc.
const URL_BUMP = 0.15
const EMAIL_BUMP = 0.15
const DATE_BUMP = 0.1
const CODE_BUMP = 0.1
const LONG_FORM_BUMP = 0.1       // > 200 chars
const NUMBER_BUMP = 0.05         // any number reference (light bump)
const CHITCHAT_PENALTY = -0.35
const EMOJI_ONLY_PENALTY = -0.5

export interface ImportanceContext {
  /** The cleaned (trimmed) message text. */
  text: string
  /** Whether an explicit cue ("记一下" / "remember this") matched. */
  hasExplicitCue: boolean
  /** Whether a preference cue ("我喜欢" / "from now on") matched. */
  hasPreferenceCue: boolean
  /** Role of the speaker. Assistant messages get a small dampener. */
  role: "user" | "assistant"
}

export function scoreImportance(ctx: ImportanceContext): number {
  let score = 0.5
  const text = ctx.text
  if (!text) return 0.0

  if (ctx.hasExplicitCue) score += EXPLICIT_CUE_BUMP
  else if (ctx.hasPreferenceCue) score += PREFERENCE_CUE_BUMP

  if (URL_RE.test(text)) score += URL_BUMP
  if (EMAIL_RE.test(text)) score += EMAIL_BUMP
  if (DATE_RE.test(text)) score += DATE_BUMP
  if (CODE_RE.test(text)) score += CODE_BUMP
  if (NUMBER_RE.test(text)) score += NUMBER_BUMP
  if (text.length > 200) score += LONG_FORM_BUMP

  if (isEmojiOnly(text)) score += EMOJI_ONLY_PENALTY

  // Chitchat: drop for short messages whose normalized form is in the set.
  // We don't apply on long messages even if they start with "ok" — there's
  // probably real content following.
  if (text.length <= 32) {
    const normalized = text.toLowerCase().replace(/[，。！？.,!?\s]+/g, " ").trim()
    if (CHITCHAT_TOKENS.has(normalized)) score += CHITCHAT_PENALTY
  }

  // Assistant turns are usually less load-bearing than user intent — pull
  // down slightly. Doesn't apply if there's an explicit cue (e.g. assistant
  // explicitly committing to remember something).
  if (ctx.role === "assistant" && !ctx.hasExplicitCue) score -= 0.05

  return clamp(score, 0, 1)
}

/** Returns true when the text contains no Letter / Number / CJK code points. */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  // Strip whitespace and anything that's clearly punctuation.
  const stripped = trimmed.replace(/[\p{P}\p{S}\p{Z}\p{C}]/gu, "")
  if (stripped.length === 0) return true
  // If after removing all alphanumeric+CJK chars we still have most of the
  // string left, it's emoji / pictographs / unusual symbols dominated.
  const letterLike = /[\p{L}\p{N}]/gu
  const matches = stripped.match(letterLike) ?? []
  return matches.length === 0
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
