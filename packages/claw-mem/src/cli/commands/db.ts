// `claw-mem db ...` — low-level SQLite maintenance.

import { statSync } from "node:fs"
import type { Command } from "commander"

import type { MemoryServices } from "../bootstrap-services.ts"
import { SCHEMA_VERSION } from "../../db/migrations.ts"

export function registerDbCommands(program: Command, services: MemoryServices): void {
  const db = program.command("db").description("SQLite database maintenance")

  db
    .command("vacuum")
    .description("Reclaim space (run after large deletions). Locks the DB briefly.")
    .option("--json", "Output JSON")
    .action((opts: { json?: boolean }) => {
      const before = sizeOf(services.dbPath)
      services.db.connection.exec("VACUUM")
      const after = sizeOf(services.dbPath)
      const result = {
        path: services.dbPath,
        beforeBytes: before,
        afterBytes: after,
        reclaimedBytes: Math.max(0, before - after),
      }
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`VACUUM ${services.dbPath}`)
      console.log(`  before: ${before} bytes`)
      console.log(`  after:  ${after} bytes`)
      console.log(`  reclaimed: ${result.reclaimedBytes} bytes`)
    })

  db
    .command("migrate-status")
    .description("Show schema version + pending migrations")
    .option("--json", "Output JSON")
    .action((opts: { json?: boolean }) => {
      const row = services.db.connection
        .prepare("SELECT MAX(version) as v FROM schema_version")
        .get() as { v: number | null } | undefined
      const current = row?.v ?? 0
      const result = {
        path: services.dbPath,
        currentVersion: current,
        latestVersion: SCHEMA_VERSION,
        upToDate: current === SCHEMA_VERSION,
        pending: SCHEMA_VERSION - current,
      }
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(`Database:  ${result.path}`)
      console.log(`Current:   v${result.currentVersion}`)
      console.log(`Latest:    v${result.latestVersion}`)
      console.log(`Status:    ${result.upToDate ? "up to date" : `${result.pending} migration(s) pending — re-open the DB to run them`}`)
    })

  db
    .command("size")
    .description("Show on-disk size of the SQLite file (and WAL/SHM if present)")
    .option("--json", "Output JSON")
    .action((opts: { json?: boolean }) => {
      const main = sizeOf(services.dbPath)
      const wal = sizeOf(services.dbPath + "-wal")
      const shm = sizeOf(services.dbPath + "-shm")
      const total = main + wal + shm
      if (opts.json) {
        console.log(JSON.stringify({ main, wal, shm, total }, null, 2))
        return
      }
      console.log(`main:  ${main}`)
      console.log(`wal:   ${wal}`)
      console.log(`shm:   ${shm}`)
      console.log(`total: ${total} bytes`)
    })
}

function sizeOf(path: string): number {
  try { return statSync(path).size } catch { return 0 }
}
