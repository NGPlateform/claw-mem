// Database schema migrations for claw-mem
// Uses a simple version-based migration system

type DatabaseSync = InstanceType<typeof import("node:sqlite").DatabaseSync>

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        facts TEXT NOT NULL DEFAULT '[]',
        narrative TEXT,
        concepts TEXT NOT NULL DEFAULT '[]',
        files_read TEXT NOT NULL DEFAULT '[]',
        files_modified TEXT NOT NULL DEFAULT '[]',
        tool_name TEXT,
        prompt_number INTEGER NOT NULL DEFAULT 0,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_obs_agent_epoch
        ON observations(agent_id, created_at_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_obs_session
        ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_obs_hash_epoch
        ON observations(content_hash, created_at_epoch);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        agent_id TEXT NOT NULL DEFAULT '',
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        notes TEXT,
        observation_count INTEGER NOT NULL DEFAULT 0,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sum_agent_epoch
        ON session_summaries(agent_id, created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        prompt_count INTEGER NOT NULL DEFAULT 0,
        observation_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        title, narrative, facts, concepts,
        content='observations', content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, narrative, facts, concepts)
        VALUES (new.id, new.title, new.narrative, new.facts, new.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, narrative, facts, concepts)
        VALUES ('delete', old.id, old.title, old.narrative, old.facts, old.concepts);
      END;
    `,
  },
  {
    version: 2,
    // Adds tables for COC node lifecycle, backup history, contract artifacts,
    // and carrier resurrection requests. ADD-only — does not modify v1 schema.
    sql: `
      CREATE TABLE IF NOT EXISTS coc_nodes (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        network TEXT NOT NULL,
        data_dir TEXT NOT NULL,
        services TEXT NOT NULL DEFAULT '[]',
        advertised_bytes INTEGER NOT NULL DEFAULT 268435456,
        rpc_port INTEGER NOT NULL,
        config_path TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        updated_at TEXT,
        updated_at_epoch INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_coc_nodes_created
        ON coc_nodes(created_at_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_coc_nodes_network
        ON coc_nodes(network);

      CREATE TABLE IF NOT EXISTS backup_archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        manifest_cid TEXT NOT NULL UNIQUE,
        backup_type INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        data_merkle_root TEXT NOT NULL DEFAULT '',
        tx_hash TEXT,
        anchored_at TEXT,
        anchored_at_epoch INTEGER,
        semantic_snapshot_included INTEGER NOT NULL DEFAULT 0,
        parent_cid TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_backup_agent_epoch
        ON backup_archives(agent_id, created_at_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_backup_parent
        ON backup_archives(parent_cid);

      CREATE TABLE IF NOT EXISTS coc_artifacts (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        network TEXT NOT NULL DEFAULT 'local',
        chain_id INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_network
        ON coc_artifacts(network);

      CREATE TABLE IF NOT EXISTS carrier_requests (
        request_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        carrier_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        updated_at TEXT,
        updated_at_epoch INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_carrier_agent
        ON carrier_requests(agent_id);
      CREATE INDEX IF NOT EXISTS idx_carrier_status
        ON carrier_requests(status);
    `,
  },
  {
    version: 3,
    // Chat compaction support: importance scoring + compacted markers.
    //
    //   compacted=1     → row was rolled into a compaction observation; should
    //                     be hidden from recall / search by default
    //   importance      → 0.0..1.0 heuristic score (default 0.5; explicit-cue
    //                     hits get bumped, chitchat gets pulled down). Used by
    //                     prune to decide which compacted rows to delete.
    //   compacted_into  → id of the chat_compaction observation that this row
    //                     was rolled into; lets you reconstruct the audit
    //                     trail without re-walking the timestamp range
    //
    // ADD-only — no v1 / v2 schema changes. Safe to apply on a populated DB:
    // existing rows default compacted=0, importance=0.5, compacted_into=NULL.
    sql: `
      ALTER TABLE observations ADD COLUMN compacted INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE observations ADD COLUMN importance REAL NOT NULL DEFAULT 0.5;
      ALTER TABLE observations ADD COLUMN compacted_into INTEGER;

      CREATE INDEX IF NOT EXISTS idx_obs_compacted_agent
        ON observations(compacted, agent_id, created_at_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_obs_compacted_into
        ON observations(compacted_into);
    `,
  },
]

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export function runMigrations(db: DatabaseSync): void {
  // Ensure schema_version table exists
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`)

  const currentVersion = getCurrentVersion(db)
  const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion)

  for (const migration of pendingMigrations) {
    db.exec(migration.sql)
    db.prepare("INSERT OR REPLACE INTO schema_version (version) VALUES (?)").run(migration.version)
  }
}

function getCurrentVersion(db: DatabaseSync): number {
  try {
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null } | undefined
    return row?.v ?? 0
  } catch {
    return 0
  }
}
