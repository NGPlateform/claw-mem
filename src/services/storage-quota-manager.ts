// StorageQuotaManager — enforces the 256 MiB minimum P2P storage contribution
// by reserving a placeholder file at dataDir and rejecting installs that would
// push directory usage beyond the configured quota.
//
// Reservation strategy (in priority order):
//   1. `fallocate -l N path` (Linux ext4/xfs/btrfs — actual reservation)
//   2. `truncate -s N path`  (POSIX sparse — no real reservation)
//   3. node fs.truncate(path, N)  (Node fallback — sparse on most FS)
//
// Tests can opt out of the actual reservation by setting `reservedBytes: 0`.

import { spawn } from "node:child_process"
import { stat, mkdir, rm, readdir, truncate } from "node:fs/promises"
import { existsSync, statfsSync } from "node:fs"
import { dirname, join } from "node:path"

import type { StorageConfig } from "../config.ts"
import type { PluginLogger } from "../types.ts"

export class QuotaExceededError extends Error {
  readonly currentBytes: number
  readonly addedBytes: number
  readonly quotaBytes: number

  constructor(opts: { currentBytes: number; addedBytes: number; quotaBytes: number }) {
    const { currentBytes, addedBytes, quotaBytes } = opts
    super(
      `Storage quota exceeded: would use ${humanize(currentBytes + addedBytes)} ` +
        `(current ${humanize(currentBytes)} + ${humanize(addedBytes)}), ` +
        `but quota is ${humanize(quotaBytes)}`,
    )
    this.name = "QuotaExceededError"
    this.currentBytes = currentBytes
    this.addedBytes = addedBytes
    this.quotaBytes = quotaBytes
  }
}

interface CachedUsage {
  bytes: number
  expiresAt: number
}

const USAGE_CACHE_TTL_MS = 500

export interface StorageQuotaManagerOptions {
  config: StorageConfig
  logger: PluginLogger
  dataDir: string
}

export class StorageQuotaManager {
  private readonly config: StorageConfig
  private readonly logger: PluginLogger
  private readonly dataDir: string
  private readonly usageCache = new Map<string, CachedUsage>()

  constructor(opts: StorageQuotaManagerOptions) {
    this.config = opts.config
    this.logger = opts.logger
    this.dataDir = opts.dataDir
  }

  getQuotaBytes(): number { return this.config.quotaBytes }
  getAdvertisedBytes(): number { return this.config.advertisedBytes }
  getReservedBytes(): number { return this.config.reservedBytes }
  getReservePath(): string { return join(this.dataDir, this.config.reserveFile) }
  isQuotaEnforced(): boolean { return this.config.enforceQuota }

  /**
   * Pre-allocate the placeholder file. Idempotent — if the file already exists
   * with the right size, do nothing. If `reservedBytes === 0`, do nothing.
   *
   * Falls back through fallocate → truncate(1) → node fs.truncate.
   */
  async ensureReserved(): Promise<{ reserved: number; method: string; path: string }> {
    const target = this.config.reservedBytes
    const path = this.getReservePath()

    if (target <= 0) {
      return { reserved: 0, method: "skipped", path }
    }

    await mkdir(dirname(path), { recursive: true })

    // Skip if existing reservation is already large enough.
    if (existsSync(path)) {
      try {
        const st = await stat(path)
        if (st.size >= target) {
          return { reserved: st.size, method: "existing", path }
        }
      } catch {
        // fall through to re-create
      }
    }

    // Pre-flight: ensure disk has the space at all (works on Node 18.15+).
    try {
      const fs = statfsSync(this.dataDir)
      const available = Number(fs.bavail) * Number(fs.bsize)
      if (available < target) {
        throw new Error(
          `Cannot reserve ${humanize(target)}: only ${humanize(available)} available on filesystem`,
        )
      }
    } catch (error) {
      // statfsSync may throw on some platforms; treat as soft warning
      this.logger.debug?.(`statfs check failed: ${String(error)}`)
    }

    // Method 1: fallocate
    if (await tryRun("fallocate", ["-l", String(target), path])) {
      return { reserved: target, method: "fallocate", path }
    }

    // Method 2: truncate(1)
    if (await tryRun("truncate", ["-s", String(target), path])) {
      return { reserved: target, method: "truncate(1)", path }
    }

    // Method 3: Node fs
    await truncate(path, target).catch(async () => {
      // truncate fails if file doesn't exist; create it first
      const { writeFile } = await import("node:fs/promises")
      await writeFile(path, "")
      await truncate(path, target)
    })
    return { reserved: target, method: "fs.truncate", path }
  }

  async releaseReserved(): Promise<boolean> {
    const path = this.getReservePath()
    if (!existsSync(path)) return false
    await rm(path, { force: true })
    return true
  }

  /**
   * Report total bytes used inside dataDir (recursive). Excludes the
   * reservation file from the count so reservation doesn't trip the quota.
   * Result is cached for {@link USAGE_CACHE_TTL_MS} ms per path.
   */
  async getUsage(path = this.dataDir): Promise<number> {
    const cached = this.usageCache.get(path)
    if (cached && Date.now() < cached.expiresAt) return cached.bytes

    const reservePath = this.getReservePath()
    const bytes = await diskUsage(path, reservePath)

    this.usageCache.set(path, {
      bytes,
      expiresAt: Date.now() + USAGE_CACHE_TTL_MS,
    })
    return bytes
  }

  /**
   * Throws if `current + bytes > quota`. Bypassed when `enforceQuota=false`.
   */
  async assertCanAdd(bytes: number): Promise<void> {
    if (!this.config.enforceQuota) return
    if (bytes < 0) throw new Error(`Negative byte count: ${bytes}`)

    const current = await this.getUsage()
    if (current + bytes > this.config.quotaBytes) {
      throw new QuotaExceededError({
        currentBytes: current,
        addedBytes: bytes,
        quotaBytes: this.config.quotaBytes,
      })
    }
  }

  invalidateCache(path?: string): void {
    if (path) this.usageCache.delete(path)
    else this.usageCache.clear()
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

async function diskUsage(path: string, excludePath: string): Promise<number> {
  let total = 0
  let stack: string[] = [path]
  while (stack.length) {
    const next = stack.pop()!
    let st
    try {
      st = await stat(next)
    } catch {
      continue  // Skip unreadable / disappeared entries.
    }
    if (next === excludePath) continue

    if (st.isDirectory()) {
      let entries: string[]
      try {
        entries = await readdir(next)
      } catch {
        continue
      }
      stack = stack.concat(entries.map((e) => join(next, e)))
    } else if (st.isFile()) {
      total += st.size
    }
  }
  return total
}

function tryRun(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "ignore" })
    child.on("error", () => resolve(false))
    child.on("exit", (code) => resolve(code === 0))
  })
}

function humanize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GiB`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(2)} MiB`
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(2)} KiB`
  return `${bytes} B`
}
