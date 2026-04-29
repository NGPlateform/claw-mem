// `claw-mem backup ...` subcommand group.
// Distilled subset of COC/extensions/coc-backup/src/cli/commands.ts —
// includes the most common operations (create, restore, list, status, doctor,
// history). Carrier / guardian / DID / recovery management subcommands are
// deferred to a follow-up PR.

import * as p from "@clack/prompts"
import { Wallet, keccak256, toUtf8Bytes } from "ethers"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Command } from "commander"
import type { SoulCommandDeps } from "./deps.ts"
import {
  DEFAULT_CONFIG_PATH,
  patchConfigFile,
  setDotPath,
} from "../../config-persistence.ts"
import { runInitFlow } from "../../lifecycle.ts"
import {
  getLatestRecoveryPackagePath,
  patchBackupState,
  readBackupState,
  readLatestRecoveryPackage,
} from "../../local-state.ts"
import {
  ZERO_BYTES32,
  deriveDefaultAgentId,
  formatBytes,
  resolveHomePath,
} from "../../backup-utils.ts"
import type { BackupReceipt, DoctorReport, FileCategory } from "../../backup-types.ts"
import type { BackupManager } from "../../backup-manager.ts"
import type { CocBackupConfig } from "../../backup-config-schema.ts"

const VALID_CATEGORIES: ReadonlyArray<FileCategory> = [
  "identity", "memory", "chat", "config", "workspace", "database",
]

function parseCategoryList(raw: string, flagName: string): FileCategory[] {
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean)
  const invalid = items.filter((s) => !VALID_CATEGORIES.includes(s as FileCategory))
  if (invalid.length > 0) {
    throw new Error(
      `${flagName} contains unknown categories: ${invalid.join(", ")}. ` +
      `Valid: ${VALID_CATEGORIES.join(", ")}`,
    )
  }
  return items as FileCategory[]
}

/** Translate --only/--skip into a Partial<CocBackupConfig.categories> override. */
function parseCategoryOverride(only?: string, skip?: string): Partial<CocBackupConfig["categories"]> | undefined {
  if (only) {
    const allow = new Set(parseCategoryList(only, "--only"))
    const out: Partial<CocBackupConfig["categories"]> = {}
    for (const cat of VALID_CATEGORIES) out[cat] = allow.has(cat)
    return out
  }
  if (skip) {
    const deny = new Set(parseCategoryList(skip, "--skip"))
    const out: Partial<CocBackupConfig["categories"]> = {}
    for (const cat of deny) out[cat] = false
    return out
  }
  return undefined
}

/** Emit a JSON receipt for `backup create` (machine-readable output for alerting). */
async function emitCreateJson(receipt: BackupReceipt, backupManager: BackupManager): Promise<void> {
  if (receipt.status === "dry_run") {
    console.log(JSON.stringify({
      status: "dry_run",
      changeset: receipt.changeset,
    }, null, 2))
    return
  }
  if (receipt.status !== "completed") {
    console.log(JSON.stringify({
      status: receipt.status,
      reason: receipt.reason,
    }, null, 2))
    return
  }
  const b = receipt.backup!
  const sourceDir = resolveHomePath(backupManager.getCocConfig().dataDir)
  const recoveryPkgPath = getLatestRecoveryPackagePath(sourceDir)
  const recoveryPkg = await readLatestRecoveryPackage(sourceDir).catch(() => null)
  const key = backupManager.getKeyMaterial()
  console.log(JSON.stringify({
    status: "completed",
    backupType: b.backupType === 0 ? "full" : "incremental",
    manifestCid: b.manifestCid,
    fileCount: b.fileCount,
    totalBytes: b.totalBytes,
    dataMerkleRoot: b.dataMerkleRoot,
    txHash: b.txHash,
    parentManifestCid: b.parentManifestCid,
    anchoredAt: b.anchoredAt,
    encryptionMode: recoveryPkg?.encryptionMode ?? null,
    requiresPassword: recoveryPkg?.requiresPassword ?? null,
    recoveryPackagePath: recoveryPkgPath,
    signerAddress: key.address ?? null,
    heartbeatStatus: receipt.heartbeatStatus,
  }, null, 2))
}

export function registerBackupCommands(program: Command, deps: SoulCommandDeps): void {
  const { backupManager, recoveryManager, archiveStore, logger } = deps
  const backup = program.command("backup").description("Soul backup, restore, and inspection")

  // ─── claw-mem backup create [--full] [--dry-run] [--json] [--only|--skip] ──
  backup
    .command("create")
    .description("Create a new soul backup")
    .option("--full", "Force a full backup", false)
    .option("--dry-run", "Compute the changeset but skip upload + on-chain anchor", false)
    .option("--json", "Output JSON (suitable for cron + jq + alerting pipelines)", false)
    .option("--only <categories>", "Comma-separated category allowlist (e.g. config,memory). Mutually exclusive with --skip.")
    .option("--skip <categories>", "Comma-separated category denylist. Mutually exclusive with --only.")
    .action(async (opts: {
      full?: boolean
      dryRun?: boolean
      json?: boolean
      only?: string
      skip?: string
    }) => {
      try {
        if (opts.only && opts.skip) {
          throw new Error("--only and --skip are mutually exclusive")
        }
        const categoryOverride = parseCategoryOverride(opts.only, opts.skip)
        const r = await backupManager.runBackup({
          full: opts.full ?? false,
          dryRun: opts.dryRun ?? false,
          categoryOverride,
        })

        if (opts.json) {
          await emitCreateJson(r, backupManager)
          if (r.status !== "completed" && r.status !== "dry_run") process.exit(1)
          return
        }

        if (r.status === "dry_run") {
          const cs = r.changeset!
          console.log(`Dry run (${cs.isFullBackup ? "full" : "incremental"}) — nothing uploaded:`)
          console.log(`  added:        ${cs.added}`)
          console.log(`  modified:     ${cs.modified}`)
          console.log(`  deleted:      ${cs.deleted}`)
          console.log(`  unchanged:    ${cs.unchanged}`)
          console.log(`  bytesToUpload: ${cs.bytesToUpload}`)
          if (Object.keys(cs.byCategory).length > 0) {
            console.log(`  byCategory:`)
            for (const [cat, info] of Object.entries(cs.byCategory)) {
              if (!info) continue
              console.log(`    ${cat.padEnd(10)} added=${info.added} modified=${info.modified} bytes=${info.bytes}`)
            }
          }
          return
        }

        if (r.status !== "completed") {
          console.log(`Backup ${r.status}: ${r.reason ?? "(no reason given)"}`)
          return
        }
        const b = r.backup!
        console.log(`Backup complete (${b.backupType === 0 ? "full" : "incremental"}):`)
        console.log(`  manifest:   ${b.manifestCid}`)
        console.log(`  files:      ${b.fileCount}`)
        console.log(`  bytes:      ${b.totalBytes}`)
        console.log(`  merkleRoot: ${b.dataMerkleRoot}`)
        if (b.txHash) console.log(`  txHash:     ${b.txHash}`)

        // ── Recovery instructions: how to restore THIS backup later ──
        // Surfaced after every successful backup so the user knows
        // (a) the manifest CID to ask for, (b) where the private key
        // they'll need lives, and (c) a copy-paste restore command.
        // The recommendedRestoreCommand and encryptionMode come from
        // the recovery package the scheduler just wrote to disk.
        const sourceDir = resolveHomePath(backupManager.getCocConfig().dataDir)
        const recoveryPkgPath = getLatestRecoveryPackagePath(sourceDir)
        const recoveryPkg = await readLatestRecoveryPackage(sourceDir).catch(() => null)
        const key = backupManager.getKeyMaterial()

        console.log("")
        console.log("Recovery info — keep this safe to restore on another host:")
        console.log(`  recovery package: ${recoveryPkgPath}`)
        if (recoveryPkg) {
          console.log(`  encryption mode:  ${recoveryPkg.encryptionMode}`)
        }
        if (key.source === "keystore" && key.keyPath) {
          console.log(`  signing key file: ${key.keyPath} (mode 0600 — copy off-host securely)`)
        } else if (key.source === "config") {
          console.log(`  signing key:      from backup.privateKey in config (operator-managed)`)
        } else {
          console.log(`  signing key:      not loaded (backup ran in dry mode?)`)
        }
        if (key.address) {
          console.log(`  signer address:   ${key.address}`)
        }
        console.log("")
        console.log("To restore on another host (always restore to /tmp first, verify, then promote):")
        console.log(`  openclaw coc-soul backup restore --manifest-cid ${b.manifestCid} \\`)
        console.log(`    --target-dir /tmp/openclaw-restore-test${recoveryPkg?.requiresPassword ? " \\\n    --password '<your-password>'" : ""}`)
        if (recoveryPkg) {
          console.log("")
          console.log(`  (if you also have ${recoveryPkgPath} on the target host:)`)
          console.log(`  openclaw coc-soul backup restore --latest-local --target-dir /tmp/openclaw-restore-test${recoveryPkg.requiresPassword ? " --password '<pw>'" : ""}`)
        }
      } catch (error) {
        if (opts.json) {
          console.log(JSON.stringify({ status: "failed", reason: String(error) }))
        } else {
          logger.error(`Backup failed: ${String(error)}`)
        }
        process.exit(1)
      }
    })

  // ─── claw-mem backup list [--limit] ───────────────────────
  backup
    .command("list")
    .description("List previously recorded backups")
    .option("--limit <n>", "Max entries to show", Number, 20)
    .option("--agent <agentId>", "Filter by agent ID")
    .option("--json", "Output JSON")
    .action((opts: { limit: number; agent?: string; json?: boolean }) => {
      const archives = opts.agent
        ? archiveStore.listByAgent(opts.agent, opts.limit)
        : archiveStore.listAll(opts.limit)
      if (opts.json) {
        console.log(JSON.stringify(archives, null, 2))
        return
      }
      if (archives.length === 0) {
        console.log("No backups recorded.")
        return
      }
      const header = padRow("CID", "TYPE", "FILES", "BYTES", "ANCHORED", "CREATED")
      console.log(header)
      console.log("-".repeat(header.length))
      for (const a of archives) {
        console.log(
          padRow(
            a.manifestCid.slice(0, 16) + "…",
            a.backupType,
            String(a.fileCount),
            String(a.totalBytes),
            a.txHash ? "yes" : "no",
            a.createdAt.slice(0, 19),
          ),
        )
      }
    })

  // ─── claw-mem backup status ───────────────────────────────
  backup
    .command("status")
    .description("Show backup configuration and chain registration status")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const report = await recoveryManager.doctor()
        if (opts.json) {
          console.log(JSON.stringify(report, null, 2))
          return
        }
        console.log(`Lifecycle state: ${report.state}`)
        console.log(`Chain registered: ${report.chain.registered}`)
        if (report.actions.length > 0) {
          console.log("Recommended actions:")
          for (const a of report.actions) console.log(`  - ${a.label}: ${a.description}`)
        }
      } catch (error) {
        logger.error(`Status failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── claw-mem backup doctor ───────────────────────────────
  backup
    .command("doctor")
    .description("Run lifecycle checks and recommend next actions")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const report = await recoveryManager.doctor()
        console.log(JSON.stringify(report, null, opts.json ? 2 : 2))
      } catch (error) {
        logger.error(`Doctor failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── claw-mem backup restore ──────────────────────────────
  backup
    .command("restore")
    .description("Restore agent state from a backup")
    .option("--manifest-cid <cid>", "Restore from a specific manifest CID")
    .option("--package <path>", "Restore from a local recovery package")
    .option("--latest-local", "Restore from the latest local recovery package")
    .option("--target-dir <path>", "Restoration target directory (default: configured sourceDir)")
    .option("--password <pwd>", "Decryption password")
    .action(async (opts: {
      manifestCid?: string
      package?: string
      latestLocal?: boolean
      targetDir?: string
      password?: string
    }) => {
      try {
        const result = await recoveryManager.restore({
          manifestCid: opts.manifestCid,
          packagePath: opts.package,
          latestLocal: opts.latestLocal,
          targetDir: opts.targetDir,
          password: opts.password,
        })
        console.log("Restore complete:")
        console.log(`  files:        ${result.filesRestored}`)
        console.log(`  bytes:        ${result.totalBytes}`)
        console.log(`  manifests:    ${result.backupsApplied}`)
        console.log(`  merkleVerified: ${result.merkleVerified}`)
        console.log(`  manifestCid:  ${result.requestedManifestCid}`)
      } catch (error) {
        logger.error(`Restore failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── coc-soul backup verify ───────────────────────────────
  // Lightweight integrity audit for an existing backup: walks the parent
  // chain, recomputes each manifest's Merkle root, and (when SoulClient
  // is available) confirms the latest manifest's root matches the
  // on-chain anchor. Does NOT decrypt or re-hash file blobs — that's
  // restore's job, and verify is meant to run without the decryption
  // key for routine "is this backup still recoverable?" audits.
  backup
    .command("verify")
    .description("Verify integrity of an existing backup (manifest chain + on-chain anchor)")
    .option("--cid <manifestCid>", "Manifest CID to verify (defaults to latest local)")
    .option("--latest", "Verify the latest local backup (default behavior; flag is for symmetry)")
    .option("--json", "Output JSON")
    .action(async (opts: { cid?: string; latest?: boolean; json?: boolean }) => {
      try {
        const result = await recoveryManager.verify({
          manifestCid: opts.cid,
          latest: opts.latest,
        })
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
        } else {
          console.log(`Manifest:           ${result.manifestCid}`)
          console.log(`  ok:               ${result.ok}`)
          console.log(`  agentId:          ${result.agentId ?? "(unknown)"}`)
          console.log(`  chainResolved:    ${result.chainResolved}`)
          console.log(`  chainLength:      ${result.chainLength}`)
          console.log(`  manifestRoots:    ${result.manifestRootsValid ? "valid" : "INVALID"}`)
          console.log(`  fileCount:        ${result.fileCount}`)
          console.log(`  totalBytes:       ${result.totalBytes}`)
          console.log(`  anchorAttempted:  ${result.anchorCheckAttempted}`)
          console.log(`  anchorPassed:     ${result.anchorCheckPassed}`)
          if (result.anchorCheckReason) {
            console.log(`  anchorReason:     ${result.anchorCheckReason}`)
          }
          if (result.reason) {
            console.log(`  reason:           ${result.reason}`)
          }
        }
        if (!result.ok) process.exit(1)
      } catch (error) {
        if (opts.json) {
          console.log(JSON.stringify({
            ok: false,
            reason: String(error),
          }, null, 2))
        } else {
          logger.error(`Verify failed: ${String(error)}`)
        }
        process.exit(1)
      }
    })

  // ─── claw-mem backup history (alias for list with default ordering) ──
  backup
    .command("history")
    .description("Show recent backup history (alias for `list`)")
    .option("--limit <n>", "Max entries to show", Number, 10)
    .action((opts: { limit: number }) => {
      const archives = archiveStore.listAll(opts.limit)
      if (archives.length === 0) {
        console.log("No backups recorded.")
        return
      }
      for (const a of archives) {
        console.log(
          `${a.createdAt.slice(0, 19)}  ${a.backupType.padEnd(11)}  ${a.manifestCid}  files=${a.fileCount}`,
        )
      }
    })

  // ─── claw-mem backup init ────────────────────────────────
  backup
    .command("init")
    .description("Register soul if needed, run first full backup, and write local recovery metadata")
    .option("--agent-id <id>", "Agent ID (bytes32 hex). Auto-derived from wallet if omitted")
    .option("--identity-cid <cid>", "Identity CID hash (bytes32 hex). Auto-upload if omitted")
    .option("--key-hash <hash>", "Configure resurrection after init using keccak256(abi.encodePacked(resurrectionKeyAddress))")
    .option("--max-offline <seconds>", "Max offline duration in seconds", (v) => parseInt(v), 86400)
    .action(async (opts: { agentId?: string; identityCid?: string; keyHash?: string; maxOffline: number }) => {
      try {
        const coc = backupManager.getCocConfig()
        const soul = backupManager.getSoulClient()
        const ipfs = backupManager.getIpfsClient()
        const scheduler = backupManager.getScheduler()
        const result = await runInitFlow(coc, soul, ipfs, scheduler, {
          agentId: opts.agentId,
          identityCid: opts.identityCid,
          resurrectionKeyHash: opts.keyHash,
          maxOfflineDuration: opts.maxOffline,
        })
        console.log("Initialization complete!")
        console.log(`  Agent ID:           ${result.agentId}`)
        console.log(`  Already registered: ${result.alreadyRegistered}`)
        if (result.registrationTxHash) {
          console.log(`  Registration TX:    ${result.registrationTxHash}`)
        }
        printBackupReceipt(result.backupReceipt)
        console.log(`  State file:         ${result.statePath}`)
        if (result.recoveryPackagePath) {
          console.log(`  Recovery package:   ${result.recoveryPackagePath}`)
        }
        if (result.resurrectionConfigured && result.resurrectionTxHash) {
          console.log(`  Resurrection TX:    ${result.resurrectionTxHash}`)
        }
      } catch (error) {
        logger.error(`Init failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── claw-mem backup register ────────────────────────────
  backup
    .command("register")
    .description("Register soul identity on-chain (without running a backup)")
    .option("--agent-id <id>", "Agent ID (bytes32 hex). Auto-derived from wallet if omitted")
    .option("--identity-cid <cid>", "Identity CID hash (bytes32 hex)")
    .action(async (opts: { agentId?: string; identityCid?: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const ipfs = backupManager.getIpfsClient()
        const coc = backupManager.getCocConfig()
        const ownerAddress = (soul as unknown as { address: string }).address
        const agentId = opts.agentId ?? deriveDefaultAgentId(ownerAddress)
        let identityCid = opts.identityCid
        if (!identityCid) {
          const baseDir = resolveHomePath(coc.dataDir)
          try {
            const data = await readFile(join(baseDir, "IDENTITY.md"))
            identityCid = keccak256(toUtf8Bytes(await ipfs.add(data)))
          } catch {
            identityCid = keccak256(toUtf8Bytes("empty-identity"))
            logger.warn("No IDENTITY.md found, using placeholder CID")
          }
        }
        const txHash = await soul.registerSoul(agentId, identityCid)
        console.log("Soul registered!")
        console.log(`  Agent ID: ${agentId}`)
        console.log(`  Owner:    ${ownerAddress}`)
        console.log(`  TX Hash:  ${txHash}`)
      } catch (error) {
        logger.error(`Registration failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── claw-mem backup heartbeat ───────────────────────────
  backup
    .command("heartbeat")
    .description("Send heartbeat proving the agent is alive (resets the offline timer)")
    .action(async () => {
      try {
        const soul = backupManager.getSoulClient()
        const agentId = await soul.getAgentIdForOwner()
        if (agentId === ZERO_BYTES32) {
          logger.error("No soul registered for this wallet — run `claw-mem backup register` first")
          process.exit(1)
        }
        const txHash = await soul.heartbeat(agentId)
        console.log(`Heartbeat sent (tx ${txHash})`)
      } catch (error) {
        logger.error(`Heartbeat failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── claw-mem backup configure-resurrection ──────────────
  backup
    .command("configure-resurrection")
    .description("Configure the resurrection key hash and offline timeout")
    .requiredOption("--key-hash <hash>", "keccak256 hash of the resurrection key address")
    .option("--max-offline <seconds>", "Max offline duration in seconds", (v) => parseInt(v), 86400)
    .action(async (opts: { keyHash: string; maxOffline: number }) => {
      try {
        const soul = backupManager.getSoulClient()
        const agentId = await soul.getAgentIdForOwner()
        if (agentId === ZERO_BYTES32) {
          logger.error("No soul registered — run `claw-mem backup register` first")
          process.exit(1)
        }
        const txHash = await soul.configureResurrection(agentId, opts.keyHash, opts.maxOffline)
        console.log(`Resurrection configured`)
        console.log(`  Key Hash:    ${opts.keyHash}`)
        console.log(`  Max Offline: ${opts.maxOffline}s`)
        console.log(`  TX Hash:     ${txHash}`)
      } catch (error) {
        logger.error(`Configure resurrection failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── claw-mem backup resurrection { start | status | confirm | complete | cancel } ──
  const resurrection = backup.command("resurrection").description("Owner-key resurrection flow")

  resurrection
    .command("start")
    .description("Initiate resurrection using a resurrection key")
    .requiredOption("--carrier-id <id>", "Target carrier ID (bytes32)")
    .requiredOption("--resurrection-key <key>", "Resurrection private key (hex)")
    .option("--agent-id <id>", "Agent ID (bytes32 hex). Required when relaying for another soul")
    .action(async (opts: { carrierId: string; resurrectionKey: string; agentId?: string }) => {
      try {
        const soul = backupManager.getSoulClient()
        const coc = backupManager.getCocConfig()
        const agentId = opts.agentId ?? await soul.getAgentIdForOwner()
        if (agentId === ZERO_BYTES32) {
          logger.error("No soul registered for this wallet")
          process.exit(1)
        }
        const result = await soul.initiateResurrection(agentId, opts.carrierId, opts.resurrectionKey)
        await patchBackupState(resolveHomePath(coc.dataDir), {
          pendingResurrectionRequestId: result.requestId,
          pendingCarrierId: opts.carrierId,
          latestAgentId: agentId,
        })
        console.log("Resurrection initiated!")
        console.log(`  Agent ID:   ${agentId}`)
        console.log(`  Carrier ID: ${opts.carrierId}`)
        console.log(`  Request ID: ${result.requestId}`)
        console.log(`  TX Hash:    ${result.txHash}`)
      } catch (error) {
        logger.error(`Resurrection failed: ${String(error)}`)
        process.exit(1)
      }
    })

  resurrection
    .command("status")
    .description("Show readiness of the pending resurrection request")
    .option("--request-id <id>", "Resurrection request ID (defaults to local pending request)")
    .option("--json", "Output JSON")
    .action(async (opts: { requestId?: string; json?: boolean }) => {
      try {
        const coc = backupManager.getCocConfig()
        const soul = backupManager.getSoulClient()
        const requestId = await resolvePendingRequestId(coc.dataDir, opts.requestId)
        const request = await soul.getResurrectionRequest(requestId)
        const readiness = await soul.getResurrectionReadiness(requestId)
        if (opts.json) {
          console.log(JSON.stringify({ request, readiness }, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2))
          return
        }
        console.log(`Resurrection Request`)
        console.log(`  Request ID:        ${request.requestId}`)
        console.log(`  Agent ID:          ${request.agentId}`)
        console.log(`  Carrier ID:        ${request.carrierId}`)
        console.log(`  Trigger:           ${request.trigger}`)
        console.log(`  Approval Count:    ${readiness.approvalCount}/${readiness.approvalThreshold}`)
        console.log(`  Carrier Confirmed: ${readiness.carrierConfirmed}`)
        console.log(`  Offline Now:       ${readiness.offlineNow}`)
        console.log(`  Can Complete:      ${readiness.canComplete}`)
      } catch (error) {
        logger.error(`Resurrection status failed: ${String(error)}`)
        process.exit(1)
      }
    })

  resurrection
    .command("confirm")
    .description("Confirm carrier readiness for the pending resurrection request")
    .option("--request-id <id>", "Resurrection request ID (defaults to local pending request)")
    .action(async (opts: { requestId?: string }) => {
      try {
        const coc = backupManager.getCocConfig()
        const soul = backupManager.getSoulClient()
        const requestId = await resolvePendingRequestId(coc.dataDir, opts.requestId)
        const txHash = await soul.confirmCarrier(requestId)
        console.log(`Carrier confirmed (tx ${txHash})`)
      } catch (error) {
        logger.error(`Resurrection confirm failed: ${String(error)}`)
        process.exit(1)
      }
    })

  resurrection
    .command("complete")
    .description("Complete the pending resurrection request")
    .option("--request-id <id>", "Resurrection request ID (defaults to local pending request)")
    .action(async (opts: { requestId?: string }) => {
      try {
        const coc = backupManager.getCocConfig()
        const soul = backupManager.getSoulClient()
        const requestId = await resolvePendingRequestId(coc.dataDir, opts.requestId)
        const txHash = await soul.completeResurrection(requestId)
        await patchBackupState(resolveHomePath(coc.dataDir), {
          pendingResurrectionRequestId: null,
          pendingCarrierId: null,
        })
        console.log(`Resurrection completed (tx ${txHash})`)
      } catch (error) {
        logger.error(`Resurrection complete failed: ${String(error)}`)
        process.exit(1)
      }
    })

  resurrection
    .command("cancel")
    .description("Cancel the pending resurrection request")
    .option("--request-id <id>", "Resurrection request ID (defaults to local pending request)")
    .action(async (opts: { requestId?: string }) => {
      try {
        const coc = backupManager.getCocConfig()
        const soul = backupManager.getSoulClient()
        const requestId = await resolvePendingRequestId(coc.dataDir, opts.requestId)
        const txHash = await soul.cancelResurrection(requestId)
        await patchBackupState(resolveHomePath(coc.dataDir), {
          pendingResurrectionRequestId: null,
          pendingCarrierId: null,
        })
        console.log(`Resurrection cancelled (tx ${txHash})`)
      } catch (error) {
        logger.error(`Resurrection cancel failed: ${String(error)}`)
        process.exit(1)
      }
    })

  // ─── claw-mem backup prune ───────────────────────────────
  backup
    .command("prune")
    .description("Delete local archive index entries older than N days (does NOT unpin IPFS data)")
    .option("--older-than <days>", "Days threshold", (v) => Number(v))
    .option("--before <iso>", "Drop entries strictly older than this ISO timestamp")
    .option("--agent <agentId>", "Only prune for one agent")
    .option("--keep-latest <n>", "Always keep the latest N entries per agent", Number, 1)
    .option("--dry-run", "Show counts, don't actually delete", false)
    .action((opts: {
      olderThan?: number; before?: string; agent?: string;
      keepLatest: number; dryRun?: boolean
    }) => {
      let cutoffEpoch: number
      if (opts.before) cutoffEpoch = Math.floor(new Date(opts.before).getTime() / 1000)
      else if (opts.olderThan !== undefined && Number.isFinite(opts.olderThan)) {
        cutoffEpoch = Math.floor((Date.now() - opts.olderThan * 86_400_000) / 1000)
      } else {
        console.error("Provide --older-than <days> or --before <ISO>")
        process.exit(1)
      }

      // Preview via the archive repository port; the umbrella SQLite
      // implementation runs the actual ranked-DELETE query.
      const preview = deps.archiveStore.prune({
        cutoffEpoch,
        keepLatest: opts.keepLatest,
        agent: opts.agent,
        dryRun: true,
      })
      const candidates = preview.candidates

      console.log(`Cutoff:        ${new Date(cutoffEpoch * 1000).toISOString()}`)
      console.log(`Keep latest:   ${opts.keepLatest} per agent`)
      console.log(`Candidates:    ${candidates.length}`)
      for (const c of candidates.slice(0, 10)) {
        console.log(`  - ${c.createdAt}  ${c.manifestCid.slice(0, 24)}…  (agent ${c.agentId})`)
      }
      if (candidates.length > 10) console.log(`  ... ${candidates.length - 10} more`)

      if (opts.dryRun) {
        console.log("(dry-run, nothing actually deleted)")
        return
      }
      if (candidates.length === 0) return

      const result = deps.archiveStore.prune({
        cutoffEpoch,
        keepLatest: opts.keepLatest,
        agent: opts.agent,
      })
      console.log(`Deleted ${result.deleted} local index entries.`)
      console.log(`NOTE: this does not remove the underlying IPFS data — unpin via your IPFS pinning service if needed.`)
    })

  // ─── claw-mem backup find-recoverable ────────────────────
  backup
    .command("find-recoverable")
    .description("List backups recoverable from the local archive index (and optionally on-chain)")
    .option("--agent <agentId>", "Filter by agent ID")
    .option("--owner <addr>", "Resolve agent ID for this owner address (requires backup configured)")
    .option("--on-chain", "Also query SoulRegistry for the latest on-chain CID per agent", false)
    .option("--json", "Output JSON")
    .action(async (opts: { agent?: string; owner?: string; onChain?: boolean; json?: boolean }) => {
      const local = opts.agent
        ? deps.archiveStore.listByAgent(opts.agent, 100)
        : deps.archiveStore.listAll(100)

      // Group by agent and pick latest-per-agent
      const byAgent = new Map<string, typeof local>()
      for (const a of local) {
        const list = byAgent.get(a.agentId) ?? []
        list.push(a)
        byAgent.set(a.agentId, list)
      }

      let onChain: Array<{ agentId: string; cid: string | null; error?: string }> = []
      if (opts.onChain) {
        if (!deps.backupManager.isConfigured()) {
          console.error("--on-chain requires backup to be configured (`claw-mem backup configure`).")
          process.exit(1)
        }
        const soul = deps.backupManager.getSoulClient()
        const targets: string[] = []
        if (opts.agent) targets.push(opts.agent)
        else if (opts.owner) {
          try {
            // soul-client owns getAgentIdForOwner — we can call into it through the manager
            const agentId = await soul.getAgentIdForOwner()
            targets.push(agentId)
          } catch (err) {
            console.error(`Failed to resolve owner: ${String(err)}`)
            process.exit(1)
          }
        } else {
          // best-effort: use distinct agent ids from local index
          targets.push(...byAgent.keys())
        }
        for (const aid of targets) {
          try {
            const info = await soul.getSoul(aid)
            onChain.push({ agentId: aid, cid: info?.latestSnapshotCid ?? null })
          } catch (err) {
            onChain.push({ agentId: aid, cid: null, error: String(err) })
          }
        }
      }

      const result = {
        local: Array.from(byAgent.entries()).map(([agentId, items]) => ({
          agentId,
          latest: items[0]
            ? {
                manifestCid: items[0].manifestCid,
                createdAt: items[0].createdAt,
                totalBytes: items[0].totalBytes,
                txHash: items[0].txHash,
              }
            : null,
          historyCount: items.length,
        })),
        onChain,
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      console.log(`Recoverable backups (local index, ${result.local.length} agent(s)):`)
      for (const r of result.local) {
        console.log(`  agent ${r.agentId.slice(0, 24)}…  history=${r.historyCount}`)
        if (r.latest) console.log(`    latest: ${r.latest.createdAt}  ${r.latest.manifestCid}`)
      }
      if (opts.onChain) {
        console.log(`\nOn-chain (${onChain.length}):`)
        for (const r of onChain) {
          if (r.error) console.log(`  agent ${r.agentId.slice(0, 24)}…  ERROR: ${r.error}`)
          else console.log(`  agent ${r.agentId.slice(0, 24)}…  cid=${r.cid ?? "(none)"}`)
        }
      }
    })

  // ─── claw-mem backup configure ───────────────────────────
  backup
    .command("configure")
    .description("Interactive wizard: set RPC, IPFS, SoulRegistry, DIDRegistry, private key")
    .option("--non-interactive", "Skip prompts; only generate a key if one is missing")
    .action(async (opts: { nonInteractive?: boolean }) => {
      const current = deps.backupConfig
      if (opts.nonInteractive) {
        if (!current.privateKey) {
          const wallet = Wallet.createRandom()
          await patchConfigFile(DEFAULT_CONFIG_PATH, (cfg) => {
            setDotPath(cfg, "backup.privateKey", wallet.privateKey)
          })
          console.log(`Generated backup.privateKey for ${wallet.address}`)
        } else {
          console.log("backup.privateKey already set; nothing to do.")
        }
        return
      }

      p.intro("claw-mem backup setup")

      const rpcUrl = await p.text({
        message: "COC RPC URL:",
        defaultValue: current.rpcUrl,
        placeholder: current.rpcUrl,
      })
      if (p.isCancel(rpcUrl)) { p.cancel("cancelled"); return }

      const ipfsUrl = await p.text({
        message: "IPFS API URL:",
        defaultValue: current.ipfsUrl,
        placeholder: current.ipfsUrl,
      })
      if (p.isCancel(ipfsUrl)) { p.cancel("cancelled"); return }

      const contractAddress = await p.text({
        message: "SoulRegistry contract address (0x…):",
        defaultValue: current.contractAddress ?? "",
        placeholder: "0x" + "0".repeat(40),
        validate: (v) => /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? undefined : "Must be a 0x-prefixed 40-hex address",
      })
      if (p.isCancel(contractAddress)) { p.cancel("cancelled"); return }

      const wantDid = await p.confirm({
        message: "Configure DIDRegistry?",
        initialValue: Boolean(current.didRegistryAddress),
      })
      if (p.isCancel(wantDid)) { p.cancel("cancelled"); return }

      let didRegistryAddress: string | undefined
      if (wantDid) {
        const did = await p.text({
          message: "DIDRegistry contract address (0x…):",
          defaultValue: current.didRegistryAddress ?? "",
          placeholder: "0x" + "0".repeat(40),
          validate: (v) => /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? undefined : "Must be a 0x-prefixed 40-hex address",
        })
        if (p.isCancel(did)) { p.cancel("cancelled"); return }
        didRegistryAddress = did as string
      }

      const keyChoice = await p.select({
        message: "Operator private key:",
        options: [
          { value: "generate", label: "Generate a new key", hint: "stored in ~/.claw-mem/config.json" },
          { value: "paste", label: "Paste an existing key" },
          { value: "keep", label: "Keep current value", hint: current.privateKey ? "0x…" + current.privateKey.slice(-6) : "(none set)" },
        ],
      })
      if (p.isCancel(keyChoice)) { p.cancel("cancelled"); return }

      let privateKey = current.privateKey
      let derivedAddress: string | null = current.privateKey ? safeAddress(current.privateKey) : null
      if (keyChoice === "generate") {
        const wallet = Wallet.createRandom()
        privateKey = wallet.privateKey
        derivedAddress = wallet.address
      } else if (keyChoice === "paste") {
        const pasted = await p.password({
          message: "Paste 0x-prefixed 64-hex private key:",
          validate: (v) => /^0x[0-9a-fA-F]{64}$/.test(v.trim()) ? undefined : "Must be 0x + 64 hex chars",
        })
        if (p.isCancel(pasted)) { p.cancel("cancelled"); return }
        privateKey = (pasted as string).trim()
        derivedAddress = safeAddress(privateKey)
      }

      const persistKey = await p.confirm({
        message: "Write the private key into ~/.claw-mem/config.json (chmod 600)?",
        initialValue: keyChoice !== "keep",
      })
      if (p.isCancel(persistKey)) { p.cancel("cancelled"); return }

      await patchConfigFile(DEFAULT_CONFIG_PATH, (cfg) => {
        setDotPath(cfg, "backup.rpcUrl", rpcUrl as string)
        setDotPath(cfg, "backup.ipfsUrl", ipfsUrl as string)
        setDotPath(cfg, "backup.contractAddress", contractAddress as string)
        if (didRegistryAddress !== undefined) {
          setDotPath(cfg, "backup.didRegistryAddress", didRegistryAddress)
        }
        if (persistKey && privateKey) {
          setDotPath(cfg, "backup.privateKey", privateKey)
        }
      })

      const summary = [
        `rpcUrl:          ${rpcUrl}`,
        `ipfsUrl:         ${ipfsUrl}`,
        `contractAddress: ${contractAddress}`,
        didRegistryAddress ? `didRegistry:     ${didRegistryAddress}` : null,
        derivedAddress ? `operator addr:   ${derivedAddress}` : null,
        persistKey ? `privateKey:      written to ${DEFAULT_CONFIG_PATH}` : `privateKey:      NOT written`,
        ``,
        `Next:`,
        `  - claw-mem backup status`,
        `  - claw-mem backup create   # try a backup`,
      ].filter(Boolean) as string[]
      p.note(summary.join("\n"), "Backup configured")
      p.outro("ready")
    })
}

function safeAddress(privateKey: string): string | null {
  try { return new Wallet(privateKey).address } catch { return null }
}

async function resolvePendingRequestId(dataDir: string, explicitRequestId?: string): Promise<string> {
  if (explicitRequestId) return explicitRequestId
  const state = await readBackupState(resolveHomePath(dataDir))
  if (!state.pendingResurrectionRequestId) {
    throw new Error("No pending resurrection request recorded locally. Provide --request-id.")
  }
  return state.pendingResurrectionRequestId
}

function printBackupReceipt(receipt: BackupReceipt): void {
  if (receipt.status === "registration_required") {
    console.log("Soul not registered. Run `claw-mem backup init` or `claw-mem backup register` first.")
    return
  }
  if (receipt.status === "skipped") {
    console.log(`Backup skipped: ${receipt.reason ?? "no reason"}`)
  } else if (receipt.backup) {
    console.log("Backup complete:")
    console.log(`  Files:      ${receipt.backup.fileCount}`)
    console.log(`  Size:       ${formatBytes(receipt.backup.totalBytes)}`)
    console.log(`  Type:       ${receipt.backup.backupType === 0 ? "full" : "incremental"}`)
    console.log(`  CID:        ${receipt.backup.manifestCid}`)
    console.log(`  Merkle:     ${receipt.backup.dataMerkleRoot}`)
    if (receipt.backup.txHash) console.log(`  TX Hash:    ${receipt.backup.txHash}`)
  }
  console.log(`  Heartbeat:  ${receipt.heartbeatStatus}`)
  if (receipt.heartbeatError) console.log(`  Warning:    ${receipt.heartbeatError}`)
}

// Touch unused-import lint
type _DoctorReport = DoctorReport

function padRow(...cols: string[]): string {
  const widths = [22, 12, 8, 12, 10, 19]
  return cols.map((c, i) => c.padEnd(widths[i] ?? 12)).join(" ")
}
