// Context formatter: renders memory context as Markdown
// for injection into the agent's system prompt

import type { Observation, SessionSummary } from "../types.ts"

interface FormatOptions {
  observations: Observation[]
  summaries: SessionSummary[]
  agentId: string
  tokensUsed: number
  tokenBudget: number
}

export function formatContext(options: FormatOptions): string {
  const { observations, summaries, agentId, tokensUsed, tokenBudget } = options
  const sections: string[] = []

  sections.push("<claw-mem-context>")
  sections.push(`Agent: ${agentId} | ${summaries.length} summaries, ${observations.length} observations | ${tokensUsed}/${tokenBudget} tokens`)
  sections.push("")

  if (summaries.length > 0) {
    sections.push("## Recent Sessions")
    sections.push("")
    for (const s of summaries) {
      sections.push(formatSummary(s))
    }
  }

  if (observations.length > 0) {
    sections.push("## Recent Observations")
    sections.push("")
    sections.push("| Time | Type | Title | Facts |")
    sections.push("|------|------|-------|-------|")
    for (const obs of observations) {
      sections.push(formatObservationRow(obs))
    }
    sections.push("")
  }

  sections.push("</claw-mem-context>")

  return sections.join("\n")
}

function formatSummary(s: SessionSummary): string {
  const lines: string[] = []
  const date = formatDate(s.createdAt)
  lines.push(`### ${date}`)
  if (s.request) lines.push(`- **Request**: ${s.request}`)
  if (s.learned) lines.push(`- **Learned**: ${s.learned}`)
  if (s.completed) lines.push(`- **Completed**: ${s.completed}`)
  if (s.nextSteps) lines.push(`- **Next Steps**: ${s.nextSteps}`)
  lines.push("")
  return lines.join("\n")
}

function formatObservationRow(obs: Observation): string {
  const time = formatTime(obs.createdAt)
  const facts = obs.facts.length > 0
    ? obs.facts.slice(0, 2).join("; ")
    : "—"
  return `| ${time} | ${obs.type} | ${escape(obs.title)} | ${escape(facts)} |`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    })
  } catch {
    return iso
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
  } catch {
    return iso
  }
}

function escape(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ")
}
