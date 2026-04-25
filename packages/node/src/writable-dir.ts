// Resolve a writable data directory with sandbox-safe fallback.
//
// Used by `coc-node` plugin / standalone CLI to find a base dir for
// JsonNodeRegistry (`nodes.json`), per-node data dirs, and storage
// reservation files. When the configured path or the default
// `~/.chainofclaw` is read-only (sandbox / locked HOME), falls back
// through env-var override and finally `os.tmpdir()`.

import {
  existsSync,
  accessSync,
  mkdirSync,
  constants as fsConst,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { Logger } from "./types.ts"

export const DEFAULT_DATA_DIR = join(homedir(), ".chainofclaw")
export const FALLBACK_DATA_DIR = join(tmpdir(), "coc-node")

export interface ResolveDataDirOptions {
  /** Explicit path candidate (e.g. config.dataDir). Wins if writable. */
  candidate?: string
  logger?: Logger
}

/**
 * Probe whether `path` (file or directory) can be written. For paths that
 * don't exist yet, walks up the parent chain until a directory does exist
 * and checks `W_OK` on it.
 */
export function isPathWritable(path: string): boolean {
  let cursor = path
  for (let i = 0; i < 32; i++) {
    if (existsSync(cursor)) {
      try {
        accessSync(cursor, fsConst.W_OK)
        return true
      } catch {
        return false
      }
    }
    const parent = dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
  return false
}

/**
 * Resolve a base data directory and ensure it's mkdir-able.
 *
 * Priority (highest first):
 *   1. opts.candidate (typically config.dataDir injected by activate())
 *   2. process.env.COC_NODE_DATA_DIR
 *   3. ~/.chainofclaw (default)
 *   4. <os.tmpdir()>/coc-node (last-resort fallback)
 *
 * The chosen directory is mkdir'd with `recursive: true` before return.
 * If even (4) fails, throws — at that point the runtime is hopelessly broken.
 */
export function resolveWritableDataDir(opts: ResolveDataDirOptions = {}): string {
  const candidates: Array<{ path: string; label: string }> = []
  if (opts.candidate && opts.candidate.length > 0) {
    candidates.push({ path: opts.candidate, label: "candidate" })
  }
  const envOverride = process.env.COC_NODE_DATA_DIR
  if (envOverride && envOverride.length > 0) {
    candidates.push({ path: envOverride, label: "env COC_NODE_DATA_DIR" })
  }
  candidates.push({ path: DEFAULT_DATA_DIR, label: "default" })
  candidates.push({ path: FALLBACK_DATA_DIR, label: "tmpdir fallback" })

  for (const { path, label } of candidates) {
    if (!isPathWritable(path)) continue
    try {
      mkdirSync(path, { recursive: true })
      if (label !== "candidate" && label !== "default") {
        opts.logger?.warn(`[coc-node] using ${label} dataDir at ${path}`)
      }
      return path
    } catch (err) {
      opts.logger?.warn(
        `[coc-node] mkdir failed at ${path} (${label}): ${String(err).slice(0, 120)}`,
      )
      continue
    }
  }

  // Final attempt: just throw at the tmpdir path so the error is concrete.
  mkdirSync(FALLBACK_DATA_DIR, { recursive: true })
  return FALLBACK_DATA_DIR
}
