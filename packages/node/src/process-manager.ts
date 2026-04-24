// Process lifecycle manager for coc-node / coc-agent / coc-relayer subprocesses.
// Migrated from COC/extensions/coc-nodeops/src/runtime/process-manager.ts and
// extended with `spawnHardhat` for the dev bootstrap flow.

import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { access, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { Logger } from "./types.ts"
import { resolveNodeEntryScript, resolveRuntimeDir, type CocRepoLocator } from "./paths.ts"

export type CocProcessKind = "node" | "agent" | "relayer"

export interface CocProcessConfig {
  dataDir: string
  nodePort: number
  nodeBind: string
  agentIntervalMs: number
  agentBatchSize: number
  agentSampleSize: number
  relayerIntervalMs: number
  nodeUrl: string
  l1RpcUrl?: string
  l2RpcUrl?: string
  cocRepo?: CocRepoLocator
}

export interface ProcessStatus {
  pid?: number
  running: boolean
}

export class ProcessManager {
  private readonly logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  async start(kind: CocProcessKind, config: CocProcessConfig): Promise<void> {
    const dataDir = config.dataDir
    await mkdir(dataDir, { recursive: true })

    const pidPath = this.pidPath(dataDir, kind)
    const existingPid = await this.readPid(pidPath)
    if (existingPid && this.isRunning(existingPid)) {
      this.logger.warn(`COC ${kind} already running: ${existingPid}`)
      return
    }

    // The "node" service uses the full blockchain entry point (node/src/index.ts);
    // "agent" and "relayer" use runtime scripts (runtime/coc-*.ts).
    const scriptPath = kind === "node"
      ? resolveNodeEntryScript(config.cocRepo)
      : join(resolveRuntimeDir(config.cocRepo), `coc-${kind}.ts`)
    await access(scriptPath)

    const logPath = join(dataDir, `coc-${kind}.log`)
    const env = {
      ...process.env,
      COC_DATA_DIR: dataDir,
      COC_NODE_BIND: config.nodeBind,
      COC_NODE_PORT: String(config.nodePort),
      COC_AGENT_INTERVAL_MS: String(config.agentIntervalMs),
      COC_AGENT_BATCH_SIZE: String(config.agentBatchSize),
      COC_AGENT_SAMPLE_SIZE: String(config.agentSampleSize),
      COC_RELAYER_INTERVAL_MS: String(config.relayerIntervalMs),
      COC_NODE_URL: config.nodeUrl,
      COC_L1_RPC_URL: config.l1RpcUrl ?? "",
      COC_L2_RPC_URL: config.l2RpcUrl ?? "",
    }

    const logHandle = await open(logPath, "a")
    const child = spawn(process.execPath, ["--experimental-strip-types", scriptPath], {
      env,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
      detached: true,
    })
    await logHandle.close()

    child.unref()
    await writeFile(pidPath, String(child.pid))

    this.logger.info(`COC ${kind} started: ${child.pid}`)
  }

  async stop(kind: CocProcessKind, dataDir: string): Promise<void> {
    const pidPath = this.pidPath(dataDir, kind)
    const pid = await this.readPid(pidPath)
    if (!pid) {
      this.logger.warn(`COC ${kind} not running`)
      return
    }

    try {
      process.kill(pid, "SIGTERM")
      await unlink(pidPath)
      this.logger.info(`COC ${kind} stopped: ${pid}`)
    } catch (error) {
      this.logger.error(`Stop failed: ${String(error)}`)
      throw error
    }
  }

  async status(kind: CocProcessKind, dataDir: string): Promise<ProcessStatus> {
    const pidPath = this.pidPath(dataDir, kind)
    const pid = await this.readPid(pidPath)
    if (!pid) return { running: false }
    return { pid, running: this.isRunning(pid) }
  }

  async readLogs(kind: CocProcessKind, dataDir: string): Promise<string> {
    const logPath = join(dataDir, `coc-${kind}.log`)
    try {
      return await readFile(logPath, "utf-8")
    } catch {
      return ""
    }
  }

  /**
   * Spawn a detached `npx hardhat node` for the dev bootstrap flow.
   * Returns the child PID; PID is also written to `dataDir/hardhat.pid`.
   */
  async spawnHardhat(opts: {
    contractsDir: string
    dataDir: string
    port: number
    hostname?: string
    logFile?: string
  }): Promise<number> {
    const { contractsDir, dataDir, port } = opts
    const hostname = opts.hostname ?? "127.0.0.1"
    const logFile = opts.logFile ?? join(dataDir, "hardhat.log")

    await mkdir(dataDir, { recursive: true })
    const logHandle = await open(logFile, "a")

    const child: ChildProcess = spawn(
      "npx",
      ["hardhat", "node", "--port", String(port), "--hostname", hostname],
      {
        cwd: contractsDir,
        env: process.env,
        stdio: ["ignore", logHandle.fd, logHandle.fd],
        detached: true,
      },
    )
    await logHandle.close()
    child.unref()

    if (!child.pid) {
      throw new Error("Failed to spawn hardhat (no pid)")
    }
    await writeFile(join(dataDir, "hardhat.pid"), String(child.pid))
    this.logger.info(`hardhat node started on ${hostname}:${port}: ${child.pid}`)
    return child.pid
  }

  async stopHardhat(dataDir: string): Promise<void> {
    const pidPath = join(dataDir, "hardhat.pid")
    const pid = await this.readPid(pidPath)
    if (!pid) return
    try {
      process.kill(pid, "SIGTERM")
      await unlink(pidPath)
      this.logger.info(`hardhat node stopped: ${pid}`)
    } catch (error) {
      this.logger.warn(`Failed to stop hardhat ${pid}: ${String(error)}`)
    }
  }

  private pidPath(dataDir: string, kind: CocProcessKind): string {
    return join(dataDir, `coc-${kind}.pid`)
  }

  private async readPid(path: string): Promise<number | undefined> {
    try {
      const raw = await readFile(path, "utf-8")
      const pid = Number(raw.trim())
      return Number.isFinite(pid) ? pid : undefined
    } catch {
      return undefined
    }
  }

  private isRunning(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}
