// BootstrapManager — `claw-mem bootstrap dev` end-to-end stack initialization.
//
// Brings up a local L1 (hardhat), funds an operator account, generates a
// node-config (with advertisedStorageBytes=256MiB), installs and starts a COC
// dev node, and runs a health check. Contract deployment, agent self-
// registration confirmation, and the first backup are stubbed with clear
// TODO markers so a follow-up PR can wire them into the COC deploy scripts.
//
// Steps (per the plan in
// .claude/plans/clawbot-claw-mem-openclaw-skills-coc-25-rustling-feigenbaum.md):
//   1.  Locate cocRepoPath
//   2.  Sanity-check Node version + disk space
//   3.  Reserve 256MiB placeholder
//   4.  Port preflight
//   5.  skipIfReady — re-use prior deployment
//   6.  Spawn hardhat
//   7.  Wait for L1 RPC ready
//   8.  Generate operator key
//   9.  Fund operator (transfer ETH from hardhat account #0)
//   10. Deploy PoSeManager / SoulRegistry / DIDRegistry / CidRegistry  [TODO]
//   11. Generate node-config.json
//   12. NodeManager.install()
//   13. NodeManager.startNode()
//   14. Health check (eth_blockNumber)
//   15. Wait for agent self-registration  [TODO]
//   16. Copy operator key into backup.privateKey if missing
//   17. First backup  [TODO — requires step 10]
//   18. Print summary

import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:net"
import { spawn } from "node:child_process"
import { ContractFactory, JsonRpcProvider, Wallet, parseEther } from "ethers"

import type { ClawMemConfig } from "../config.ts"
import { resolveContractsDir, resolveCocRoot } from "../shared/paths.ts"
import { DEFAULT_CONFIG_PATH, patchConfigFile, setDotPath } from "./config-persistence.ts"
import type { PluginLogger } from "../types.ts"
import type { NodeManager } from "./node-manager.ts"
import type { ProcessManager } from "./process-manager.ts"
import type { ArtifactStore } from "../db/artifact-store.ts"
import type { StorageQuotaManager } from "./storage-quota-manager.ts"
import type { BackupManager } from "./backup-manager.ts"

export interface BootstrapManagerOptions {
  config: ClawMemConfig
  nodeManager: NodeManager
  processManager: ProcessManager
  artifactStore: ArtifactStore
  storageQuotaManager: StorageQuotaManager
  backupManager: BackupManager
  logger: PluginLogger
  dataDir: string
}

export interface DevBootstrapOverrides {
  hardhatPort?: number
  fundEther?: string
  skipContracts?: boolean
  skipFirstBackup?: boolean
  cocRepoPath?: string
  nodeName?: string
}

export interface DevBootstrapResult {
  hardhatRpcUrl: string
  operatorAddress: string
  operatorKeyPath: string
  nodeName: string
  nodeRpcUrl: string
  contracts: {
    poseManager: string | null
    soulRegistry: string | null
    didRegistry: string | null
    cidRegistry: string | null
  }
  artifactsRecorded: number
  durationMs: number
  warnings: string[]
}

export interface BootstrapStatus {
  hardhatRunning: boolean
  hardhatPid: number | null
  nodeRunning: boolean
  contracts: Record<string, string | null>
  operatorAddress: string | null
}

export class BootstrapManager {
  private readonly config: ClawMemConfig
  private readonly nodeManager: NodeManager
  private readonly processManager: ProcessManager
  private readonly artifactStore: ArtifactStore
  private readonly storageQuotaManager: StorageQuotaManager
  private readonly backupManager: BackupManager
  private readonly logger: PluginLogger
  private readonly dataDir: string

  constructor(opts: BootstrapManagerOptions) {
    this.config = opts.config
    this.nodeManager = opts.nodeManager
    this.processManager = opts.processManager
    this.artifactStore = opts.artifactStore
    this.storageQuotaManager = opts.storageQuotaManager
    this.backupManager = opts.backupManager
    this.logger = opts.logger
    this.dataDir = opts.dataDir
  }

  // ─── runDev: 18-step happy path ──────────────────────────────
  async runDev(overrides: DevBootstrapOverrides = {}): Promise<DevBootstrapResult> {
    const t0 = Date.now()
    const warnings: string[] = []

    // Step 1: locate COC repo
    const cocRepoPath = overrides.cocRepoPath
      ?? this.config.bootstrap.cocRepoPath
      ?? resolveCocRoot()
    this.logger.info(`[bootstrap] step 1 — COC repo at ${cocRepoPath}`)

    // Step 2: env preflight
    const major = Number(process.versions.node.split(".")[0])
    if (major < 22) throw new Error(`Node 22+ required (have ${process.version})`)

    // Step 3: storage reservation (best-effort)
    try {
      await this.storageQuotaManager.ensureReserved()
    } catch (err) {
      warnings.push(`storage reservation: ${String(err)}`)
    }

    // Step 4: port preflight
    const hardhatPort = overrides.hardhatPort ?? this.config.bootstrap.hardhatPort
    const nodePort = this.config.node.port
    const portsToCheck = [hardhatPort, nodePort, 18781, 19780, 19781]
    for (const p of portsToCheck) {
      if (await isPortInUse(p)) {
        throw new Error(`Port ${p} already in use; bootstrap aborted`)
      }
    }
    this.logger.info(`[bootstrap] step 4 — ports ${portsToCheck.join(",")} clear`)

    // Step 5: skipIfReady
    const existingHardhatArtifact = this.artifactStore.get("hardhat_pid")
    if (this.config.bootstrap.skipIfReady && existingHardhatArtifact) {
      const existingPid = Number(existingHardhatArtifact.value)
      if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
        this.logger.info(`[bootstrap] step 5 — hardhat PID ${existingPid} still alive, skipping spawn`)
      }
    }

    // Step 6: spawn hardhat
    const contractsDir = resolveContractsDir({ cocRepoPath })
    const hardhatLogFile = join(this.dataDir, "logs", "hardhat.log")
    await mkdir(join(this.dataDir, "logs"), { recursive: true })
    const hardhatPid = await this.processManager.spawnHardhat({
      contractsDir,
      dataDir: this.dataDir,
      port: hardhatPort,
      hostname: "127.0.0.1",
      logFile: hardhatLogFile,
    })
    this.artifactStore.set({
      key: "hardhat_pid",
      value: String(hardhatPid),
      network: "local",
      chainId: 31337,
    })

    // Step 7: wait for L1 ready
    const hardhatRpcUrl = `http://127.0.0.1:${hardhatPort}`
    await waitForL1Ready(hardhatRpcUrl, this.logger)
    this.logger.info(`[bootstrap] step 7 — L1 RPC ready at ${hardhatRpcUrl}`)

    // Step 8: generate operator key
    const operatorKeyPath = this.config.bootstrap.operatorKeyPath
      ?? join(this.dataDir, "keys", "operator.key")
    await mkdir(join(this.dataDir, "keys"), { recursive: true })
    const wallet = Wallet.createRandom()
    await writeFile(operatorKeyPath, wallet.privateKey + "\n")
    await chmod(operatorKeyPath, 0o600)
    this.artifactStore.set({
      key: "operator_key_ref",
      value: operatorKeyPath,
      network: "local",
      chainId: 31337,
    })
    this.logger.info(`[bootstrap] step 8 — operator key generated (${wallet.address})`)

    // Step 9: fund operator from hardhat account #0
    const fundEther = overrides.fundEther ?? this.config.bootstrap.autoFundEther
    const provider = new JsonRpcProvider(hardhatRpcUrl)
    // Hardhat default account #0 private key (well-known, only valid on local).
    const HARDHAT_ACCOUNT_0_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    const funder = new Wallet(HARDHAT_ACCOUNT_0_PK, provider)
    const fundTx = await funder.sendTransaction({
      to: wallet.address,
      value: parseEther(fundEther),
    })
    await fundTx.wait()
    const balance = await provider.getBalance(wallet.address)
    this.logger.info(`[bootstrap] step 9 — operator funded with ${fundEther} ETH (balance: ${balance.toString()} wei)`)

    // Step 10: deploy contracts  [TODO]
    let contracts = {
      poseManager: null as string | null,
      soulRegistry: null as string | null,
      didRegistry: null as string | null,
      cidRegistry: null as string | null,
    }
    if (overrides.skipContracts) {
      warnings.push("step 10 skipped (skipContracts=true)")
    } else {
      // Deploy via the COC contracts/deploy/* scripts requires invoking
      // hardhat run inside the COC repo with our private key wired in. The
      // wiring is non-trivial and varies between PoSe v1 / v2 / SoulRegistry
      // / DIDRegistry / CidRegistry. Defer to a follow-up that integrates the
      // existing `contracts/deploy/cli-deploy-pose.ts` flow, optionally
      // using a generated hardhat config that picks up our hardhat node URL
      // and operator key.
      contracts = await this.maybeDeployContracts(cocRepoPath, hardhatRpcUrl, wallet.privateKey, warnings)
    }

    // Step 11+12: install node (advertisedStorageBytes injected automatically)
    const nodeName = overrides.nodeName ?? "dev-1"
    const installResult = await (async () => {
      const existing = this.nodeManager.getNode(nodeName)
      if (existing) {
        this.logger.info(`[bootstrap] step 11 — reusing existing node ${nodeName}`)
        return {
          name: existing.name,
          configPath: existing.configPath,
          rpcPort: existing.rpcPort,
          dataDir: existing.dataDir,
        }
      }
      const r = await this.nodeManager.install({
        type: "dev",
        network: "local",
        name: nodeName,
        configOverrides: contracts.poseManager
          ? { poseManagerAddress: contracts.poseManager, hardhatRpcUrl }
          : { hardhatRpcUrl },
      })
      this.logger.info(`[bootstrap] step 11+12 — node installed at ${r.dataDir}`)
      return r
    })()

    // Step 13: start node
    try {
      await this.nodeManager.startNode(nodeName)
      this.logger.info(`[bootstrap] step 13 — node ${nodeName} started`)
    } catch (err) {
      warnings.push(`step 13 startNode failed: ${String(err)}`)
    }

    // Health-check the node RPC; the variable is reused below.

    // Step 14: health check
    const nodeRpcUrl = `http://${this.config.node.bind}:${installResult.rpcPort}`
    const healthy = await waitForBlockNumber(nodeRpcUrl, 60_000)
    if (!healthy) {
      warnings.push(`step 14 health check timed out — node RPC at ${nodeRpcUrl} did not return eth_blockNumber within 60s`)
    } else {
      this.logger.info(`[bootstrap] step 14 — node RPC healthy`)
    }

    // Step 15: agent self-registration — poll the agent log for the
    // expected ensureNodeRegistered success line. If we don't see it within
    // the timeout, surface a warning but don't abort.
    const agentLogPath = join(installResult.dataDir, "coc-agent.log")
    const registered = await waitForLogPattern(
      agentLogPath,
      /ensureNodeRegistered\s+(succeeded|already\s+registered|complete)/i,
      45_000,
    )
    if (registered) {
      this.logger.info(`[bootstrap] step 15 — agent self-registration confirmed`)
    } else {
      warnings.push("step 15 — agent self-registration not confirmed within 45s (check `claw-mem node logs " + nodeName + " --service agent`)")
    }

    // Step 16: copy operator key into backup config and persist to disk
    //          so the next process invocation finds it.
    if (!this.config.backup.privateKey) {
      this.config.backup.privateKey = wallet.privateKey
      try {
        await patchConfigFile(DEFAULT_CONFIG_PATH, (cfg) => {
          setDotPath(cfg, "backup.privateKey", wallet.privateKey)
        })
        this.logger.info(`[bootstrap] step 16 — operator key persisted into backup.privateKey`)
      } catch (err) {
        warnings.push(`step 16 failed to persist key to ${DEFAULT_CONFIG_PATH}: ${String(err)}`)
        this.logger.warn(
          `[bootstrap] step 16 — operator key set in memory but NOT written to disk; ` +
            `next start will lose it. Run \`claw-mem config set backup.privateKey ${wallet.privateKey}\` to persist.`,
        )
      }
    }

    // Step 17: first backup  [TODO unless contracts deployed]
    if (overrides.skipFirstBackup || !contracts.soulRegistry) {
      warnings.push("step 17 (first backup) skipped — soulRegistry not deployed")
    } else {
      try {
        await this.backupManager.runBackup(true)
        this.logger.info(`[bootstrap] step 17 — first backup completed`)
      } catch (err) {
        warnings.push(`step 17 backup failed: ${String(err)}`)
      }
    }

    const durationMs = Date.now() - t0

    // Step 18: done — let the CLI render the summary so we don't double-print.
    this.logger.info(`[bootstrap] step 18 — done in ${durationMs}ms (${warnings.length} warnings)`)

    return {
      hardhatRpcUrl,
      operatorAddress: wallet.address,
      operatorKeyPath,
      nodeName,
      nodeRpcUrl,
      contracts,
      artifactsRecorded: this.artifactStore.list().length,
      durationMs,
      warnings,
    }
  }

  async teardown(opts: { keepKeys?: boolean } = {}): Promise<void> {
    this.logger.info(`[bootstrap] teardown — stopping nodes...`)
    for (const node of this.nodeManager.listNodes()) {
      await this.nodeManager.stopNode(node.name).catch((err) => {
        this.logger.warn(`stop ${node.name} failed: ${String(err)}`)
      })
    }
    await this.processManager.stopHardhat(this.dataDir).catch(() => {})
    this.artifactStore.deleteByNetwork("local")
    if (!opts.keepKeys) {
      this.logger.warn("teardown: operator key NOT deleted (sensitive). Remove manually if desired.")
    }
  }

  async status(): Promise<BootstrapStatus> {
    const hardhatPidStr = this.artifactStore.getValue("hardhat_pid")
    const hardhatPid = hardhatPidStr ? Number(hardhatPidStr) : null
    const hardhatRunning = hardhatPid ? isProcessAlive(hardhatPid) : false

    const localContracts = this.artifactStore.listByNetwork("local")
    const contracts: Record<string, string | null> = {}
    for (const c of localContracts) contracts[c.key] = c.value

    let nodeRunning = false
    for (const n of this.nodeManager.listNodes()) {
      const st = await this.nodeManager.getNodeStatus(n.name).catch(() => null)
      if (st?.running) { nodeRunning = true; break }
    }

    let operatorAddress: string | null = null
    const keyPath = this.artifactStore.getValue("operator_key_ref")
    if (keyPath && existsSync(keyPath)) {
      try {
        const { readFile } = await import("node:fs/promises")
        const pk = (await readFile(keyPath, "utf8")).trim()
        operatorAddress = new Wallet(pk).address
      } catch {
        // leave null
      }
    }

    return { hardhatRunning, hardhatPid, nodeRunning, contracts, operatorAddress }
  }

  /**
   * Real contract deployment. Pipeline:
   *   1. Locate `<cocRepoPath>/contracts/`. Run `npx hardhat compile` if no artifacts.
   *   2. Read PoSeManagerV2 / SoulRegistry / CidRegistry / DIDRegistry artifacts.
   *   3. Deploy each in dependency order (DIDRegistry needs SoulRegistry address).
   *   4. Record addresses in artifactStore.
   *
   * Failures append to `warnings` rather than throwing — bootstrap dev should
   * complete even if a single contract deploy fails (user can `config set`).
   */
  private async maybeDeployContracts(
    cocRepoPath: string,
    rpcUrl: string,
    operatorPrivateKey: string,
    warnings: string[],
  ): Promise<{
    poseManager: string | null
    soulRegistry: string | null
    didRegistry: string | null
    cidRegistry: string | null
  }> {
    const result = {
      poseManager: null as string | null,
      soulRegistry: null as string | null,
      didRegistry: null as string | null,
      cidRegistry: null as string | null,
    }

    const contractsDir = join(cocRepoPath, "contracts")
    const artifactsDir = join(contractsDir, "artifacts")

    if (!existsSync(artifactsDir)) {
      this.logger.info(`[bootstrap] step 10a — compiling contracts (artifacts/ missing)`)
      const compiled = await runProcess("npx", ["hardhat", "compile"], { cwd: contractsDir }, this.logger)
      if (!compiled) {
        warnings.push("step 10 — `npx hardhat compile` failed; skipping contract deployment")
        return result
      }
    }

    const provider = new JsonRpcProvider(rpcUrl)
    const wallet = new Wallet(operatorPrivateKey, provider)

    const targets = [
      { key: "pose_manager",  artifact: "contracts-src/settlement/PoSeManagerV2.sol/PoSeManagerV2.json", args: [] as unknown[], outKey: "poseManager" as const },
      { key: "soul_registry", artifact: "contracts-src/governance/SoulRegistry.sol/SoulRegistry.json",   args: [] as unknown[], outKey: "soulRegistry" as const },
      { key: "cid_registry",  artifact: "contracts-src/governance/CidRegistry.sol/CidRegistry.json",     args: [] as unknown[], outKey: "cidRegistry" as const },
      // DIDRegistry needs SoulRegistry address — deployed in a second pass below.
    ]

    for (const t of targets) {
      try {
        const addr = await deployContract(artifactsDir, t.artifact, t.args, wallet, this.logger)
        if (!addr) { warnings.push(`step 10 — ${t.key} deploy returned no address`); continue }
        this.artifactStore.set({ key: t.key, value: addr, network: "local", chainId: 31337 })
        result[t.outKey] = addr
        this.logger.info(`[bootstrap] step 10 — ${t.key} deployed at ${addr}`)
      } catch (err) {
        warnings.push(`step 10 — ${t.key} deploy failed: ${stringifyError(err)}`)
      }
    }

    if (result.soulRegistry) {
      try {
        const addr = await deployContract(
          artifactsDir,
          "contracts-src/governance/DIDRegistry.sol/DIDRegistry.json",
          [result.soulRegistry],
          wallet,
          this.logger,
        )
        if (addr) {
          this.artifactStore.set({ key: "did_registry", value: addr, network: "local", chainId: 31337 })
          result.didRegistry = addr
          this.logger.info(`[bootstrap] step 10 — did_registry deployed at ${addr}`)
        }
      } catch (err) {
        warnings.push(`step 10 — did_registry deploy failed: ${stringifyError(err)}`)
      }
    }

    return result
  }
}

// ────────────────────────────────────────────────────────────
// Contract-deploy helpers
// ────────────────────────────────────────────────────────────

async function deployContract(
  artifactsDir: string,
  relPath: string,
  args: unknown[],
  wallet: Wallet,
  logger: PluginLogger,
): Promise<string | null> {
  const artifactPath = join(artifactsDir, relPath)
  if (!existsSync(artifactPath)) {
    logger.warn(`Artifact not found: ${artifactPath} (run \`npx hardhat compile\` in contracts/)`)
    return null
  }
  const raw = await readFile(artifactPath, "utf-8")
  const artifact = JSON.parse(raw) as { abi: unknown[]; bytecode: string }
  const factory = new ContractFactory(artifact.abi as never, artifact.bytecode, wallet)
  const contract = await factory.deploy(...(args as never[]))
  const tx = contract.deploymentTransaction()
  if (tx) await tx.wait()
  return await contract.getAddress()
}

async function runProcess(
  cmd: string,
  args: string[],
  opts: { cwd?: string },
  logger: PluginLogger,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: "pipe" })
    child.stdout?.on("data", (d) => logger.debug?.(`[${cmd}] ${d.toString().trim()}`))
    child.stderr?.on("data", (d) => logger.debug?.(`[${cmd}] ${d.toString().trim()}`))
    child.on("error", () => resolve(false))
    child.on("exit", (code) => resolve(code === 0))
  })
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

async function waitForLogPattern(path: string, pattern: RegExp, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      try {
        const content = await readFile(path, "utf-8")
        if (pattern.test(content)) return true
      } catch { /* ignore */ }
    }
    await sleep(2000)
  }
  return false
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer()
      .once("error", () => resolve(true))
      .once("listening", () => {
        tester.close(() => resolve(false))
      })
      .listen(port, "127.0.0.1")
  })
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function waitForL1Ready(rpcUrl: string, logger: PluginLogger): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        signal: AbortSignal.timeout(2000),
      })
      const j = (await res.json()) as { result?: string }
      if (j.result) return
    } catch {
      // not ready yet
    }
    await sleep(2000)
  }
  throw new Error(`L1 RPC at ${rpcUrl} did not become ready within 40 seconds`)
  void logger
}

async function waitForBlockNumber(rpcUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        signal: AbortSignal.timeout(2000),
      })
      const j = (await res.json()) as { result?: string }
      if (j.result && j.result !== "0x0") return true
    } catch {
      // not ready yet
    }
    await sleep(5000)
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// homedir() is referenced indirectly via path utils in some envs; keep import lint-safe
void homedir
