// Summary storage: CRUD for session summaries

import type { Database } from "./database.ts"
import type { SessionSummary, SummaryInput } from "../types.ts"

const CHARS_PER_TOKEN = 4

function estimateTokens(input: SummaryInput): number {
  let chars = 0
  if (input.request) chars += input.request.length
  if (input.investigated) chars += input.investigated.length
  if (input.learned) chars += input.learned.length
  if (input.completed) chars += input.completed.length
  if (input.nextSteps) chars += input.nextSteps.length
  if (input.notes) chars += input.notes.length
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

export class SummaryStore {
  private readonly db: Database
  constructor(db: Database) { this.db = db }

  upsert(input: SummaryInput): number {
    const now = new Date()
    const tokens = estimateTokens(input)

    const result = this.db.connection
      .prepare(
        `INSERT INTO session_summaries
         (session_id, agent_id, request, investigated, learned, completed,
          next_steps, notes, observation_count, token_estimate, created_at, created_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           request = excluded.request,
           investigated = excluded.investigated,
           learned = excluded.learned,
           completed = excluded.completed,
           next_steps = excluded.next_steps,
           notes = excluded.notes,
           observation_count = excluded.observation_count,
           token_estimate = excluded.token_estimate,
           created_at = excluded.created_at,
           created_at_epoch = excluded.created_at_epoch`,
      )
      .run(
        input.sessionId,
        input.agentId,
        input.request,
        input.investigated,
        input.learned,
        input.completed,
        input.nextSteps,
        input.notes,
        input.observationCount,
        tokens,
        now.toISOString(),
        Math.floor(now.getTime() / 1000),
      )

    return Number(result.lastInsertRowid)
  }

  getRecent(agentId: string, limit: number): SessionSummary[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM session_summaries
         WHERE agent_id = ?
         ORDER BY created_at_epoch DESC
         LIMIT ?`,
      )
      .all(agentId, limit) as unknown as RawSummary[]

    return rows.map(mapRow)
  }

  getBySession(sessionId: string): SessionSummary | null {
    const row = this.db.connection
      .prepare("SELECT * FROM session_summaries WHERE session_id = ?")
      .get(sessionId) as RawSummary | undefined
    return row ? mapRow(row) : null
  }

  countByAgent(agentId: string): number {
    const row = this.db.connection
      .prepare("SELECT COUNT(*) as c FROM session_summaries WHERE agent_id = ?")
      .get(agentId) as { c: number }
    return row.c
  }
}

interface RawSummary {
  id: number
  session_id: string
  agent_id: string
  request: string | null
  investigated: string | null
  learned: string | null
  completed: string | null
  next_steps: string | null
  notes: string | null
  observation_count: number
  token_estimate: number
  created_at: string
  created_at_epoch: number
}

function mapRow(row: RawSummary): SessionSummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    request: row.request,
    investigated: row.investigated,
    learned: row.learned,
    completed: row.completed,
    nextSteps: row.next_steps,
    notes: row.notes,
    observationCount: row.observation_count,
    tokenEstimate: row.token_estimate,
    createdAt: row.created_at,
    createdAtEpoch: row.created_at_epoch,
  }
}
