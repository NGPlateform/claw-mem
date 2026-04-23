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
import type { CliServices } from "../register-all.ts"
import {
  DEFAULT_CONFIG_PATH,
  patchConfigFile,
  setDotPath,
} from "../../services/config-persistence.ts"
import { runInitFlow } from "../../services/lifecycle.ts"
import { patchBackupState, readBackupState } from "../../services/local-state.ts"
import {
  ZERO_BYTES32,
  deriveDefaultAgentId,
  formatBytes,
  resolveHomePath,
} from "../../services/backup-utils.ts"
import type { BackupReceipt, DoctorReport } from "../../services/backup-types.ts"

export function registerBackupCommands(program: Command, services: CliServices): void {
  const { backupManager, recoveryManager, archiveStore, logger } = services
  const backup = program.command("backup").description("Soul backup, restore, and inspection")

  // ─── claw-mem backup create [--full] ──────────────────────
  backup
    .command("create")
    .description("Create a new soul backup")
    .option("--full", "Force a full backup", false)
    .action(async (opts: { full?: boolean }) => {
      try {
        const r = await backupManager.runBackup(opts.full ?? false)
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
      } catch (error) {
        logger.error(`Backup failed: ${String(error)}`)
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

      const { db } = services
      const agentClause = opts.agent ? "AND agent_id = ?" : ""
      const agentBind: unknown[] = opts.agent ? [opts.agent] : []

      // Find rows that would be deleted, EXCLUDING the latest N per agent.
      const candidates = db.connection.prepare(
        `WITH ranked AS (
           SELECT id, agent_id, manifest_cid, created_at_epoch, created_at,
                  ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at_epoch DESC) AS rn
           FROM backup_archives
           ${opts.agent ? "WHERE agent_id = ?" : ""}
         )
         SELECT id, manifest_cid, agent_id, created_at FROM ranked
         WHERE created_at_epoch < ? AND rn > ?`,
      ).all(...(agentBind as never[]), cutoffEpoch, opts.keepLatest) as Array<{
        id: number; manifest_cid: string; agent_id: string; created_at: string
      }>

      console.log(`Cutoff:        ${new Date(cutoffEpoch * 1000).toISOString()}`)
      console.log(`Keep latest:   ${opts.keepLatest} per agent`)
      console.log(`Candidates:    ${candidates.length}`)
      for (const c of candidates.slice(0, 10)) {
        console.log(`  - ${c.created_at}  ${c.manifest_cid.slice(0, 24)}…  (agent ${c.agent_id})`)
      }
      if (candidates.length > 10) console.log(`  ... ${candidates.length - 10} more`)

      if (opts.dryRun) {
        console.log("(dry-run, nothing actually deleted)")
        return
      }
      if (candidates.length === 0) return

      const ids = candidates.map((c) => c.id)
      const placeholders = ids.map(() => "?").join(",")
      db.connection.prepare(`DELETE FROM backup_archives WHERE id IN (${placeholders})`)
        .run(...(ids as never[]))
      console.log(`Deleted ${candidates.length} local index entries.`)
      console.log(`NOTE: this does not remove the underlying IPFS data — unpin via your IPFS pinning service if needed.`)
      // help suppress unused vars warning
      void agentClause
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
        ? services.archiveStore.listByAgent(opts.agent, 100)
        : services.archiveStore.listAll(100)

      // Group by agent and pick latest-per-agent
      const byAgent = new Map<string, typeof local>()
      for (const a of local) {
        const list = byAgent.get(a.agentId) ?? []
        list.push(a)
        byAgent.set(a.agentId, list)
      }

      let onChain: Array<{ agentId: string; cid: string | null; error?: string }> = []
      if (opts.onChain) {
        if (!services.backupManager.isConfigured()) {
          console.error("--on-chain requires backup to be configured (`claw-mem backup configure`).")
          process.exit(1)
        }
        const soul = services.backupManager.getSoulClient()
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
      const current = services.config.backup
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
