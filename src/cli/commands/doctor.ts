// `claw-mem doctor` — environment checks. Outputs a checklist with
// PASS / WARN / FAIL per item plus a summary tally. Read-only.

import { existsSync, statfsSync } from "node:fs"
import { join } from "node:path"
import { createServer } from "node:net"
import type { Command } from "commander"

import type { CliServices } from "../register-all.ts"
import { checkCocRepo, describeCocRepoCheck } from "../../shared/paths.ts"
import { isBackupConfigured } from "../../services/backup-config-adapter.ts"
import { SCHEMA_VERSION } from "../../db/migrations.ts"

type CheckLevel = "pass" | "warn" | "fail"
interface CheckResult {
  name: string
  level: CheckLevel
  message: string
  hint?: string
}

export function registerDoctorCommand(program: Command, services: CliServices): void {
  program
    .command("doctor")
    .description("Run environment checks and report what's wrong")
    .option("--json", "Output JSON")
    .option("--ports <list>", "Comma-separated extra ports to check (default: 8545,18780,18781,19780,19781,5001)")
    .action(async (opts: { json?: boolean; ports?: string }) => {
      const checks = await runChecks(services, opts.ports)
      if (opts.json) {
        console.log(JSON.stringify(checks, null, 2))
        return
      }
      renderChecks(checks)
      const fails = checks.filter((c) => c.level === "fail").length
      if (fails > 0) process.exit(1)
    })
}

async function runChecks(services: CliServices, portsCsv?: string): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const { config, db, dbPath, storageQuotaManager, backupManager, artifactStore } = services

  // Node version
  const major = Number(process.versions.node.split(".")[0])
  results.push({
    name: "node-version",
    level: major >= 22 ? "pass" : "fail",
    message: `Node ${process.version}`,
    hint: major < 22 ? "Upgrade to Node 22+ (claw-mem uses node:sqlite + --experimental-strip-types)" : undefined,
  })

  // Database opens
  let dbOk = false
  try {
    db.connection.prepare("SELECT 1").get()
    dbOk = true
  } catch (err) {
    results.push({
      name: "database",
      level: "fail",
      message: `Cannot query ${dbPath}: ${String(err)}`,
    })
  }
  if (dbOk) {
    results.push({ name: "database", level: "pass", message: `${dbPath} open` })
    // Schema version
    const row = db.connection.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null }
    const v = row?.v ?? 0
    results.push({
      name: "schema",
      level: v === SCHEMA_VERSION ? "pass" : "warn",
      message: `Schema version ${v} (latest ${SCHEMA_VERSION})`,
      hint: v < SCHEMA_VERSION ? "Re-open the database to run pending migrations" : undefined,
    })
  }

  // COC repo
  const cocCheck = checkCocRepo({
    cocRepoPath: config.bootstrap.cocRepoPath ?? config.node.runtimeDir,
  })
  results.push({
    name: "coc-repo",
    level: cocCheck.ok ? "pass" : "warn",
    message: describeCocRepoCheck(cocCheck),
    hint: cocCheck.ok ? undefined : "Required for `node start` and `bootstrap dev`",
  })

  // Hardhat installation (only meaningful if cocRepo found)
  if (cocCheck.ok && cocCheck.root) {
    const hardhatBin = join(cocCheck.root, "contracts", "node_modules", ".bin", "hardhat")
    results.push({
      name: "hardhat",
      level: existsSync(hardhatBin) ? "pass" : "warn",
      message: existsSync(hardhatBin) ? `hardhat at ${hardhatBin}` : "hardhat not installed",
      hint: existsSync(hardhatBin) ? undefined : `Run: cd ${cocCheck.root}/contracts && npm install`,
    })
  }

  // Disk space
  try {
    const fs = statfsSync(services.config.dataDir || services.dbPath)
    const available = Number(fs.bavail) * Number(fs.bsize)
    const required = storageQuotaManager.getQuotaBytes()
    results.push({
      name: "disk-space",
      level: available >= required ? "pass" : "fail",
      message: `${humanize(available)} free (need ${humanize(required)})`,
    })
  } catch (err) {
    results.push({
      name: "disk-space",
      level: "warn",
      message: `Could not statfs: ${String(err)}`,
    })
  }

  // Reservation file present?
  const reservationPath = storageQuotaManager.getReservePath()
  results.push({
    name: "storage-reservation",
    level: existsSync(reservationPath) ? "pass" : "warn",
    message: existsSync(reservationPath) ? `Reservation at ${reservationPath}` : "No reservation file",
    hint: existsSync(reservationPath) ? undefined : "First node install will create it (or run `claw-mem bootstrap dev`)",
  })

  // Ports
  const portList = (portsCsv ?? "8545,18780,18781,19780,19781,5001")
    .split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  for (const port of portList) {
    const inUse = await isPortInUse(port)
    results.push({
      name: `port-${port}`,
      level: inUse ? "warn" : "pass",
      message: inUse ? `Port ${port} in use` : `Port ${port} free`,
      hint: inUse ? "Stop the conflicting process or pick a different port" : undefined,
    })
  }

  // Backup configured
  if (config.backup.enabled) {
    const configured = isBackupConfigured(config.backup) && backupManager.isConfigured()
    results.push({
      name: "backup-config",
      level: configured ? "pass" : "warn",
      message: configured ? "Backup configured" : "Backup enabled but missing contractAddress / privateKey",
      hint: configured ? undefined : "Run `claw-mem backup configure`",
    })
  }

  // Operator key present (artifact)
  const operatorRef = artifactStore.getValue("operator_key_ref")
  if (operatorRef) {
    results.push({
      name: "operator-key",
      level: existsSync(operatorRef) ? "pass" : "warn",
      message: existsSync(operatorRef)
        ? `Operator key at ${operatorRef}`
        : `Operator key recorded at ${operatorRef} but file missing`,
    })
  }

  return results
}

function renderChecks(results: CheckResult[]): void {
  let pass = 0, warn = 0, fail = 0
  for (const r of results) {
    if (r.level === "pass") pass++
    else if (r.level === "warn") warn++
    else fail++
    const icon = r.level === "pass" ? "✓" : r.level === "warn" ? "⚠" : "✗"
    console.log(`[ ${icon} ] ${r.name.padEnd(22)} ${r.message}`)
    if (r.hint && r.level !== "pass") console.log(`        ↳ ${r.hint}`)
  }
  console.log()
  console.log(`Summary: ${pass} pass, ${warn} warn, ${fail} fail`)
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer()
      .once("error", () => resolve(true))
      .once("listening", () => tester.close(() => resolve(false)))
      .listen(port, "127.0.0.1")
  })
}

function humanize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GiB`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(0)} MiB`
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(0)} KiB`
  return `${bytes} B`
}
