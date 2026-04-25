// Resolve a writable data directory.
//
// Used by `coc-node` plugin / standalone CLI to find a base dir for
// JsonNodeRegistry (`nodes.json`), per-node data directories, and storage
// reservation files.
//
// Resolution priority (highest first):
//   1. opts.candidate (typically config.dataDir injected by activate())
//   2. process.env.COC_NODE_DATA_DIR
//   3. <OPENCLAW_STATE_DIR>/coc-node (OpenClaw's sandbox-managed state
//      dir; the recommended location when running as a plugin)
//   4. ~/.chainofclaw (default for standalone use outside OpenClaw)
//
// /tmp is intentionally NOT used as a fallback: it's volatile and not a
// valid place for the persistent node registry. If none of (1)-(4) are
// writable, the resolver throws so the operator can fix the deployment
// instead of silently losing nodes.json on next reboot.

import {
  existsSync,
  accessSync,
  mkdirSync,
  constants as fsConst,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type { Logger } from "./types.ts"

export const DEFAULT_DATA_DIR = join(homedir(), ".chainofclaw")

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
 * Throws an actionable error if no candidate is writable.
 */
export function resolveWritableDataDir(opts: ResolveDataDirOptions = {}): string {
  const candidates: Array<{ path: string; label: string }> = []
  if (opts.candidate && opts.candidate.length > 0) {
    candidates.push({ path: opts.candidate, label: "candidate (config.dataDir)" })
  }
  const envOverride = process.env.COC_NODE_DATA_DIR
  if (envOverride && envOverride.length > 0) {
    candidates.push({ path: envOverride, label: "env COC_NODE_DATA_DIR" })
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR
  if (stateDir && stateDir.length > 0) {
    candidates.push({
      path: join(stateDir, "coc-node"),
      label: "OpenClaw state dir ($OPENCLAW_STATE_DIR)",
    })
  }
  candidates.push({ path: DEFAULT_DATA_DIR, label: "default ~/.chainofclaw" })

  const triedPaths: string[] = []
  for (const { path, label } of candidates) {
    triedPaths.push(`${path} (${label})`)
    if (!isPathWritable(path)) {
      opts.logger?.debug?.(`[coc-node] candidate not writable: ${path} (${label})`)
      continue
    }
    try {
      mkdirSync(path, { recursive: true })
      if (label.startsWith("OpenClaw state") || label.startsWith("env")) {
        opts.logger?.info(`[coc-node] using ${label} dataDir at ${path}`)
      }
      return path
    } catch (err) {
      opts.logger?.warn(
        `[coc-node] mkdir at ${path} (${label}) failed: ${String(err).slice(0, 120)}; trying next candidate`,
      )
    }
  }

  throw new Error(
    `Could not find a writable data directory for coc-node. Tried:\n` +
      triedPaths.map((p) => `  - ${p}`).join("\n") +
      `\n\nFix: set one of:\n` +
      `  • config.dataDir in your claw-mem config (per-instance)\n` +
      `  • COC_NODE_DATA_DIR=<absolute writable dir> (operator override)\n` +
      `  • OPENCLAW_STATE_DIR=<writable dir> (OpenClaw's standard state-dir convention)\n` +
      `  • mount a writable filesystem at ~/.chainofclaw`,
  )
}
