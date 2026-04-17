// Search module: FTS5 full-text search with LIKE fallback

import type { Database } from "../db/database.ts"
import type { Observation, SearchResult } from "../types.ts"

export interface SearchOptions {
  query: string
  agentId?: string
  type?: string
  limit?: number
}

export class SearchEngine {
  private readonly db: Database
  constructor(db: Database) { this.db = db }

  search(options: SearchOptions): SearchResult {
    const { query, limit = 10 } = options

    // Try FTS5 first
    try {
      return this.searchFts(options)
    } catch {
      // FTS unavailable, fall through
    }

    // Fall back to LIKE
    return this.searchLike(options)
  }

  private searchFts(options: SearchOptions): SearchResult {
    const { query, agentId, type, limit = 10 } = options
    const ftsQuery = sanitizeFtsQuery(query)

    let sql = `
      SELECT o.*, rank
      FROM observations_fts fts
      JOIN observations o ON o.id = fts.rowid
      WHERE observations_fts MATCH ?`
    const params: unknown[] = [ftsQuery]

    if (agentId) {
      sql += " AND o.agent_id = ?"
      params.push(agentId)
    }
    if (type) {
      sql += " AND o.type = ?"
      params.push(type)
    }

    sql += " ORDER BY rank LIMIT ?"
    params.push(limit)

    const rows = this.db.connection.prepare(sql).all(...params) as RawObsRow[]

    return {
      source: "fts",
      results: rows.map(mapRow),
      totalCount: rows.length,
    }
  }

  private searchLike(options: SearchOptions): SearchResult {
    const { query, agentId, type, limit = 10 } = options
    const pattern = `%${query}%`

    let sql = `
      SELECT * FROM observations
      WHERE (title LIKE ? OR narrative LIKE ? OR facts LIKE ?)`
    const params: unknown[] = [pattern, pattern, pattern]

    if (agentId) {
      sql += " AND agent_id = ?"
      params.push(agentId)
    }
    if (type) {
      sql += " AND type = ?"
      params.push(type)
    }

    sql += " ORDER BY created_at_epoch DESC LIMIT ?"
    params.push(limit)

    const rows = this.db.connection.prepare(sql).all(...params) as RawObsRow[]

    return {
      source: "like",
      results: rows.map(mapRow),
      totalCount: rows.length,
    }
  }
}

function sanitizeFtsQuery(query: string): string {
  return query
    .replace(/['"]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w}"`)
    .join(" OR ")
}

interface RawObsRow {
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

function mapRow(row: RawObsRow): Observation {
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
