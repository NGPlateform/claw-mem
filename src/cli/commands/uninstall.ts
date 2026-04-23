// `claw-mem uninstall` — clean up ~/.claw-mem with selective preservation.
//
// Always asks for confirmation unless --yes is passed. Operator keys are
// preserved by default (--purge-keys to remove them too) since they may be
// the only access to on-chain backups.

import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { Command } from "commander"

import type { CliServices } from "../register-all.ts"

export function registerUninstallCommand(program: Command, services: CliServices): void {
  program
    .command("uninstall")
    .description("Remove ~/.claw-mem and all locally-stored memory/nodes/backup data")
    .option("--yes", "Skip the confirmation prompt", false)
    .option("--purge-keys", "Also delete the operator key directory", false)
    .option("--keep-database", "Preserve claw-mem.db (only delete nodes/, logs/, etc.)", false)
    .option("--dry-run", "Show what would be deleted, don't actually delete", false)
    .action(async (opts: { yes?: boolean; purgeKeys?: boolean; keepDatabase?: boolean; dryRun?: boolean }) => {
      const dataDir = services.config.dataDir || resolveDefaultDataDir(services.dbPath)
      if (!existsSync(dataDir)) {
        console.log(`Nothing to remove — ${dataDir} does not exist`)
        return
      }

      const targets = decideTargets(dataDir, services.dbPath, opts)
      const preserved = decidePreserved(dataDir, services.dbPath, opts)

      console.log("Would delete:")
      for (const t of targets) console.log(`  - ${t}`)
      if (preserved.length > 0) {
        console.log("Preserve:")
        for (const p of preserved) console.log(`  - ${p}`)
      }
      if (opts.dryRun) {
        console.log("(dry-run, nothing actually removed)")
        return
      }

      if (!opts.yes) {
        process.stdout.write(`\nProceed? [y/N] `)
        const answer = await readLine()
        if (answer.toLowerCase() !== "y") {
          console.log("Cancelled")
          return
        }
      }

      services.db.close()  // release WAL handles before deleting
      services.backupManager.stop()

      for (const t of targets) {
        try {
          await rm(t, { recursive: true, force: true })
          console.log(`removed ${t}`)
        } catch (err) {
          console.error(`failed to remove ${t}: ${String(err)}`)
        }
      }
      console.log("Uninstall complete.")
    })
}

function decideTargets(
  dataDir: string,
  dbPath: string,
  opts: { purgeKeys?: boolean; keepDatabase?: boolean },
): string[] {
  // If neither --keep-database nor --purge-keys is qualified, just blow away
  // the whole dataDir.
  if (!opts.keepDatabase && opts.purgeKeys) return [dataDir]

  const targets: string[] = []
  // Subdirectories that are always safe to delete
  for (const sub of ["nodes", "logs", "backup", "archives"]) {
    const path = join(dataDir, sub)
    if (existsSync(path)) targets.push(path)
  }
  // Reservation file
  const reserve = join(dataDir, ".quota.reserved")
  if (existsSync(reserve)) targets.push(reserve)

  if (!opts.keepDatabase) {
    if (existsSync(dbPath)) targets.push(dbPath)
    for (const ext of ["-wal", "-shm"]) {
      const aux = dbPath + ext
      if (existsSync(aux)) targets.push(aux)
    }
  }
  if (opts.purgeKeys) {
    const keys = join(dataDir, "keys")
    if (existsSync(keys)) targets.push(keys)
  }
  return targets
}

function decidePreserved(
  dataDir: string,
  dbPath: string,
  opts: { purgeKeys?: boolean; keepDatabase?: boolean },
): string[] {
  const out: string[] = []
  if (opts.keepDatabase && existsSync(dbPath)) out.push(dbPath)
  const keys = join(dataDir, "keys")
  if (!opts.purgeKeys && existsSync(keys)) out.push(`${keys}  (use --purge-keys to remove)`)
  return out
}

function resolveDefaultDataDir(dbPath: string): string {
  // dbPath is `<dataDir>/claw-mem.db`; we don't have direct access here.
  return dbPath.replace(/\/claw-mem\.db$/, "")
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    stdin.setEncoding("utf-8")
    stdin.resume()
    stdin.once("data", (data) => {
      stdin.pause()
      resolve(String(data).trim())
    })
  })
}
