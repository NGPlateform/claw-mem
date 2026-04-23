// Observation storage: CRUD operations for captured observations

import { createHash } from "node:crypto"
import type { Database } from "./database.ts"
import type { Observation, ObservationInput } from "../types.ts"

const CHARS_PER_TOKEN = 4

function estimateTokens(obs: ObservationInput): number {
  let chars = obs.title.length
  if (obs.narrative) chars += obs.narrative.length
  for (const f of obs.facts) chars += f.length
  for (const c of obs.concepts) chars += c.length
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

function computeHash(obs: ObservationInput): string {
  const data = `${obs.sessionId}:${obs.title}:${obs.narrative ?? ""}`
  return createHash("sha256").update(data).digest("hex").slice(0, 32)
}

export class ObservationStore {
  private readonly db: Database
  constructor(db: Database) { this.db = db }

  insert(input: ObservationInput): number {
    const now = new Date()
    const hash = computeHash(input)
    const tokens = estimateTokens(input)

    const result = this.db.connection
      .prepare(
        `INSERT INTO observations
         (session_id, agent_id, type, title, facts, narrative, concepts,
          files_read, files_modified, tool_name, prompt_number,
          token_estimate, content_hash, created_at, created_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.agentId,
        input.type,
        input.title,
        JSON.stringify(input.facts),
        input.narrative,
        JSON.stringify(input.concepts),
        JSON.stringify(input.filesRead),
        JSON.stringify(input.filesModified),
        input.toolName,
        input.promptNumber,
        tokens,
        hash,
        now.toISOString(),
        Math.floor(now.getTime() / 1000),
      )

    // Update session observation count
    this.db.connection
      .prepare("UPDATE sessions SET observation_count = observation_count + 1 WHERE session_id = ?")
      .run(input.sessionId)

    return Number(result.lastInsertRowid)
  }

  isDuplicate(input: ObservationInput, windowMs: number): boolean {
    const hash = computeHash(input)
    const cutoff = Math.floor((Date.now() - windowMs) / 1000)
    const row = this.db.connection
      .prepare(
        `SELECT id FROM observations
         WHERE content_hash = ? AND created_at_epoch > ?
         LIMIT 1`,
      )
      .get(hash, cutoff) as { id: number } | undefined
    return row !== undefined
  }

  getRecent(agentId: string, limit: number): Observation[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM observations
         WHERE agent_id = ?
         ORDER BY created_at_epoch DESC
         LIMIT ?`,
      )
      .all(agentId, limit) as unknown as RawObservation[]

    return rows.map(mapRow)
  }

  getBySession(sessionId: string): Observation[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM observations
         WHERE session_id = ?
         ORDER BY created_at_epoch ASC`,
      )
      .all(sessionId) as unknown as RawObservation[]

    return rows.map(mapRow)
  }

  countByAgent(agentId: string): number {
    const row = this.db.connection
      .prepare("SELECT COUNT(*) as c FROM observations WHERE agent_id = ?")
      .get(agentId) as { c: number }
    return row.c
  }

  deleteBySession(sessionId: string): number {
    const result = this.db.connection
      .prepare("DELETE FROM observations WHERE session_id = ?")
      .run(sessionId)
    return Number(result.changes)
  }
}

interface RawObservation {
  id: number
  session_id: string
  agent_id: string
  type: string
  title: string
  facts: string
  narrative: string | null
  concepts: string
  files_read: string
  files_modified: string
  tool_name: string | null
  prompt_number: number
  token_estimate: number
  content_hash: string
  created_at: string
  created_at_epoch: number
}

function mapRow(row: RawObservation): Observation {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    type: row.type as Observation["type"],
    title: row.title,
    facts: parseJson(row.facts),
    narrative: row.narrative,
    concepts: parseJson(row.concepts),
    filesRead: parseJson(row.files_read),
    filesModified: parseJson(row.files_modified),
    toolName: row.tool_name,
    promptNumber: row.prompt_number,
    tokenEstimate: row.token_estimate,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    createdAtEpoch: row.created_at_epoch,
  }
}

function parseJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
