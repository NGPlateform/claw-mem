// Session state tracking

import type { Database } from "./database.ts"
import type { SessionState } from "../types.ts"

export class SessionStore {
  private readonly db: Database
  constructor(db: Database) { this.db = db }

  startSession(sessionId: string, agentId: string): void {
    const now = new Date()
    this.db.connection
      .prepare(
        `INSERT OR IGNORE INTO sessions
         (session_id, agent_id, started_at, started_at_epoch, status)
         VALUES (?, ?, ?, ?, 'active')`,
      )
      .run(sessionId, agentId, now.toISOString(), Math.floor(now.getTime() / 1000))
  }

  endSession(sessionId: string): void {
    const now = new Date()
    this.db.connection
      .prepare(
        `UPDATE sessions
         SET completed_at = ?, completed_at_epoch = ?, status = 'completed'
         WHERE session_id = ?`,
      )
      .run(now.toISOString(), Math.floor(now.getTime() / 1000), sessionId)
  }

  incrementPrompt(sessionId: string): number {
    this.db.connection
      .prepare("UPDATE sessions SET prompt_count = prompt_count + 1 WHERE session_id = ?")
      .run(sessionId)
    const row = this.db.connection
      .prepare("SELECT prompt_count FROM sessions WHERE session_id = ?")
      .get(sessionId) as { prompt_count: number } | undefined
    return row?.prompt_count ?? 1
  }

  getSession(sessionId: string): SessionState | null {
    const row = this.db.connection
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as {
      session_id: string
      agent_id: string
      started_at: string
      prompt_count: number
      observation_count: number
    } | undefined

    if (!row) return null
    return {
      sessionId: row.session_id,
      agentId: row.agent_id,
      startedAt: row.started_at,
      promptCount: row.prompt_count,
      observationCount: row.observation_count,
      lastToolName: null,
    }
  }
}
