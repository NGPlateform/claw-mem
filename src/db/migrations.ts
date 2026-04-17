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
]

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
