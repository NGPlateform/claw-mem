// `claw-mem status` — one-screen overview spanning memory / nodes / backup /
// bootstrap / storage. Read-only — does not touch the network.

import type { Command } from "commander"
import type { CliServices } from "../register-all.ts"
import { isBackupConfigured } from "@chainofclaw/soul"

export function registerStatusCommand(program: Command, services: CliServices): void {
  program
    .command("status")
    .description("One-screen overview: memory + nodes + backup + bootstrap + storage")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const snapshot = await collectStatus(services)
      if (opts.json) {
        console.log(JSON.stringify(snapshot, null, 2))
        return
      }
      printStatus(snapshot)
    })
}

interface StatusSnapshot {
  memory: {
    observations: number
    summaries: number
    sessions: number
    agents: string[]
    database: string
    tokenBudget: number
  }
  nodes: Array<{
    name: string
    type: string
    network: string
    services: string[]
    advertisedBytes: number
    rpcPort: number
  }>
  backup: {
    configured: boolean
    contractAddress: string | null
    didRegistryAddress: string | null
    rpcUrl: string
    archiveCount: number
    latest: { manifestCid: string; createdAt: string; totalBytes: number } | null
  }
  bootstrap: {
    hardhatRunning: boolean
    hardhatPid: number | null
    contracts: Record<string, string | null>
    operatorAddress: string | null
  }
  storage: {
    quotaBytes: number
    advertisedBytes: number
    reservedBytes: number
    enforceQuota: boolean
    usedBytes: number
    reservationPath: string
    reservationPresent: boolean
  }
}

async function collectStatus(services: CliServices): Promise<StatusSnapshot> {
  const {
    db, dbPath, config,
    nodeStore, archiveStore,
    bootstrapManager, storageQuotaManager,
    backupManager,
  } = services

  const totalObs = db.connection.prepare("SELECT COUNT(*) as c FROM observations").get() as { c: number }
  const totalSums = db.connection.prepare("SELECT COUNT(*) as c FROM session_summaries").get() as { c: number }
  const totalSessions = db.connection.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }
  const agents = db.connection.prepare("SELECT DISTINCT agent_id FROM observations").all() as Array<{ agent_id: string }>

  const nodes = nodeStore.list().map((n) => ({
    name: n.name,
    type: n.type,
    network: n.network,
    services: n.services,
    advertisedBytes: n.advertisedBytes,
    rpcPort: n.rpcPort,
  }))

  const archiveCount = archiveStore.count()
  const recent = archiveStore.listAll(1)
  const latest = recent.length > 0
    ? { manifestCid: recent[0].manifestCid, createdAt: recent[0].createdAt, totalBytes: recent[0].totalBytes }
    : null

  const bootstrapStatus = await bootstrapManager.status()
  const usedBytes = await storageQuotaManager.getUsage().catch(() => 0)
  const reservationPath = storageQuotaManager.getReservePath()
  const reservationPresent = await fileExists(reservationPath)

  return {
    memory: {
      observations: totalObs.c,
      summaries: totalSums.c,
      sessions: totalSessions.c,
      agents: agents.map((a) => a.agent_id).filter(Boolean),
      database: dbPath,
      tokenBudget: config.tokenBudget,
    },
    nodes,
    backup: {
      configured: isBackupConfigured(config.backup) && backupManager.isConfigured(),
      contractAddress: config.backup.contractAddress ?? null,
      didRegistryAddress: config.backup.didRegistryAddress ?? null,
      rpcUrl: config.backup.rpcUrl,
      archiveCount,
      latest,
    },
    bootstrap: bootstrapStatus,
    storage: {
      quotaBytes: storageQuotaManager.getQuotaBytes(),
      advertisedBytes: storageQuotaManager.getAdvertisedBytes(),
      reservedBytes: storageQuotaManager.getReservedBytes(),
      enforceQuota: storageQuotaManager.isQuotaEnforced(),
      usedBytes,
      reservationPath,
      reservationPresent,
    },
  }
}

function printStatus(s: StatusSnapshot): void {
  console.log("═══ claw-mem status ═══")
  console.log()
  console.log("Memory:")
  console.log(`  observations: ${s.memory.observations}`)
  console.log(`  summaries:    ${s.memory.summaries}`)
  console.log(`  sessions:     ${s.memory.sessions}`)
  console.log(`  agents:       ${s.memory.agents.length > 0 ? s.memory.agents.join(", ") : "(none)"}`)
  console.log(`  database:     ${s.memory.database}`)
  console.log(`  tokenBudget:  ${s.memory.tokenBudget}`)
  console.log()
  console.log(`Nodes (${s.nodes.length}):`)
  if (s.nodes.length === 0) {
    console.log(`  (none — run \`claw-mem node install\` to create one)`)
  } else {
    for (const n of s.nodes) {
      console.log(
        `  ${n.name.padEnd(16)} ${n.type.padEnd(10)} ${n.network.padEnd(8)} ` +
          `${n.services.join(",").padEnd(18)} ${humanize(n.advertisedBytes).padEnd(8)} :${n.rpcPort}`,
      )
    }
  }
  console.log()
  console.log("Backup:")
  console.log(`  configured:     ${s.backup.configured ? "yes" : "no — run `claw-mem backup configure`"}`)
  console.log(`  rpcUrl:         ${s.backup.rpcUrl}`)
  console.log(`  contractAddr:   ${s.backup.contractAddress ?? "(unset)"}`)
  console.log(`  didRegistry:    ${s.backup.didRegistryAddress ?? "(unset)"}`)
  console.log(`  archives:       ${s.backup.archiveCount}`)
  if (s.backup.latest) {
    console.log(`  last backup:    ${s.backup.latest.createdAt} (${humanize(s.backup.latest.totalBytes)}, CID ${s.backup.latest.manifestCid.slice(0, 16)}…)`)
  }
  console.log()
  console.log("Bootstrap:")
  console.log(`  hardhat:        ${s.bootstrap.hardhatRunning ? "running" : "stopped"}${s.bootstrap.hardhatPid ? ` (PID ${s.bootstrap.hardhatPid})` : ""}`)
  console.log(`  operator:       ${s.bootstrap.operatorAddress ?? "(not generated)"}`)
  const cs = Object.entries(s.bootstrap.contracts)
  if (cs.length === 0) {
    console.log(`  contracts:      (none recorded)`)
  } else {
    console.log("  contracts:")
    for (const [k, v] of cs) console.log(`    ${k}: ${v ?? "(missing)"}`)
  }
  console.log()
  console.log("Storage:")
  console.log(`  quota:          ${humanize(s.storage.quotaBytes)} (${s.storage.enforceQuota ? "enforced" : "not enforced"})`)
  console.log(`  advertised:     ${humanize(s.storage.advertisedBytes)}`)
  console.log(`  reserved:       ${humanize(s.storage.reservedBytes)} ${s.storage.reservationPresent ? "✓" : "(reservation file missing)"}`)
  console.log(`  used:           ${humanize(s.storage.usedBytes)}`)
}

function humanize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)}GiB`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(0)}MiB`
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(0)}KiB`
  return `${bytes}B`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises")
    await access(path)
    return true
  } catch { return false }
}
