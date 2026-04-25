// OpenClaw-backed session summarizer.
//
// Spawns `openclaw infer model run --prompt <text> --json` to reuse whatever
// inference provider the host's OpenClaw agent has already authenticated.
// Zero extra API key, zero extra config — the user already configured one
// provider for OpenClaw, claw-mem just borrows it.
//
// Activation: set `summarizer.mode: "openclaw"` in claw-mem config. The
// plugin activate() path also auto-defaults to this mode when the openclaw
// binary is on PATH and the user hasn't picked a mode explicitly.

import { spawn } from "node:child_process"

import type { Observation, SummaryInput } from "../types.ts"
import type { SummarizerOpenClawConfig } from "../config.ts"
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

export interface OpenClawSummarizerDeps {
  /** Override for tests: replace the spawn-based runner with a stub. */
  runOpenClaw?: (prompt: string, config: SummarizerOpenClawConfig) => Promise<string>
}

export async function summarizeSessionWithOpenClaw(
  sessionId: string,
  agentId: string,
  observations: Observation[],
  userPrompt: string | undefined,
  config: SummarizerOpenClawConfig,
  deps: OpenClawSummarizerDeps = {},
): Promise<SummaryInput> {
  if (observations.length === 0) {
    return heuristicSummarize(sessionId, agentId, observations, userPrompt)
  }

  const fallback = () => heuristicSummarize(sessionId, agentId, observations, userPrompt)
  const prompt = buildPrompt(observations, userPrompt)

  let raw: string
  try {
    raw = deps.runOpenClaw
      ? await deps.runOpenClaw(prompt, config)
      : await runOpenClawInfer(prompt, config)
  } catch (err) {
    if (config.fallbackOnError) return fallback()
    throw err
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parseSummaryJSON(raw)
  } catch (err) {
    if (config.fallbackOnError) return fallback()
    throw err
  }

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
}

function buildPrompt(observations: Observation[], userPrompt: string | undefined): string {
  const lines: string[] = [SYSTEM_PROMPT, ""]
  if (userPrompt) lines.push(`User request: ${userPrompt}`, "")
  lines.push(`Observations (${observations.length}):`)
  for (const o of observations) {
    const factsPreview = o.facts.length > 0 ? ` | facts: ${o.facts.slice(0, 3).join("; ")}` : ""
    const filesModified = o.filesModified.length > 0 ? ` | modified: ${o.filesModified.slice(0, 3).join(", ")}` : ""
    lines.push(`- [${o.type}] ${o.title}${factsPreview}${filesModified}`)
  }
  return lines.join("\n")
}

async function runOpenClawInfer(prompt: string, config: SummarizerOpenClawConfig): Promise<string> {
  const args = ["infer", "model", "run", "--prompt", prompt, "--json"]
  if (config.model) args.push("--model", config.model)
  if (config.forceLocal) args.push("--local")
  if (config.forceGateway) args.push("--gateway")

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(config.bin, args, { stdio: ["ignore", "pipe", "pipe"] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill("SIGTERM") } catch { /* ignore */ }
      reject(new Error(`openclaw infer timed out after ${config.timeoutMs}ms`))
    }, config.timeoutMs)
    timer.unref?.()

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))
    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`openclaw spawn failed: ${err.message}`))
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdout = Buffer.concat(stdoutChunks).toString("utf8")
      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 400)
        reject(new Error(`openclaw infer exited ${code}: ${tail}`))
        return
      }
      const text = extractInferText(stdout)
      if (!text) {
        reject(new Error("openclaw infer returned no text"))
        return
      }
      resolve(text)
    })
  })
}

// `openclaw infer model run --json` emits a JSON envelope. Try the documented
// shape first, fall back to scanning common keys, finally treat the whole
// stdout as the summary text if no envelope is recognized.
function extractInferText(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) return ""
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    for (const key of ["text", "output", "content", "result", "completion", "message"]) {
      const v = obj[key]
      if (typeof v === "string" && v.trim().length > 0) return v
    }
    // Some envelopes nest the text inside { data: { text: "..." } } or
    // { result: { text: "..." } }; scan one level deep.
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") {
        const inner = v as Record<string, unknown>
        for (const key of ["text", "output", "content", "completion"]) {
          const t = inner[key]
          if (typeof t === "string" && t.trim().length > 0) return t
        }
      }
    }
  } catch {
    // Not JSON — treat whole stdout as the model's reply.
    return trimmed
  }
  return trimmed
}

function parseSummaryJSON(text: string): Record<string, unknown> {
  // Be lenient: trim ``` fences and look for the first {...} block.
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
  // If the model preceded the JSON with prose, find the first balanced {}.
  const start = unfenced.indexOf("{")
  const end = unfenced.lastIndexOf("}")
  const candidate = start !== -1 && end > start ? unfenced.slice(start, end + 1) : unfenced
  try {
    return JSON.parse(candidate) as Record<string, unknown>
  } catch (err) {
    throw new Error(`OpenClaw summarizer returned malformed JSON: ${String(err).slice(0, 160)}`)
  }
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}
