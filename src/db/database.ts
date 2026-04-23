// Database manager: SQLite with node:sqlite (Node.js 22+)
// Handles connection lifecycle, migrations, and WAL mode
//
// open() is synchronous — needed because the OpenClaw plugin host requires
// `activate()` to register hooks/tools synchronously. Uses a static import of
// node:sqlite (available on Node 22+).

import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { runMigrations } from "./migrations.ts"

export class Database {
  private db: DatabaseSync | null = null
  private readonly dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  /**
   * Open the SQLite connection. Synchronous — safe to call inside a plugin
   * `activate()` that must register hooks before returning.
   *
   * Retained as `async` for backward compatibility with callers that
   * previously awaited this method; the underlying work is now sync.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async open(): Promise<void> {
    this.openSync()
  }

  openSync(): void {
    if (this.db) return
    mkdirSync(dirname(this.dbPath), { recursive: true })
    this.db = new DatabaseSync(this.dbPath)
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
