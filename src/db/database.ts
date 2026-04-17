// Database manager: SQLite with node:sqlite (Node.js 22+)
// Handles connection lifecycle, migrations, and WAL mode

import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { runMigrations } from "./migrations.ts"

type DatabaseSync = InstanceType<typeof import("node:sqlite").DatabaseSync>

let DatabaseSyncClass: typeof import("node:sqlite").DatabaseSync | null = null

async function loadSqlite(): Promise<typeof import("node:sqlite").DatabaseSync> {
  if (DatabaseSyncClass) return DatabaseSyncClass
  const mod = await import("node:sqlite")
  DatabaseSyncClass = mod.DatabaseSync
  return DatabaseSyncClass
}

export class Database {
  private db: DatabaseSync | null = null
  private readonly dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  async open(): Promise<void> {
    if (this.db) return
    mkdirSync(dirname(this.dbPath), { recursive: true })
    const Ctor = await loadSqlite()
    this.db = new Ctor(this.dbPath)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")
    this.db.exec("PRAGMA foreign_keys = ON")
    this.db.exec("PRAGMA busy_timeout = 5000")
    runMigrations(this.db)
  }

  get connection(): DatabaseSync {
    if (!this.db) throw new Error("Database not open. Call open() first.")
    return this.db
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
