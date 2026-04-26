// Resolve a writable data directory.
//
// Used by `coc-node` plugin / standalone CLI to find a base dir for
// JsonNodeRegistry (`nodes.json`), per-node data directories, and storage
// reservation files.
//
// Resolution priority (highest first):
//   1. opts.candidate (typically config.dataDir injected by activate())
//   2. process.env.COC_NODE_DATA_DIR        (coc-node-specific operator override)
//   3. process.env.CLAW_MEM_DATA_DIR        (shared with claw-mem + soul)
//   4. <OPENCLAW_STATE_DIR>/coc-node        (sandbox-managed state)
//   5. ~/.claw-mem/coc-node                 (default — shared root with claw-mem + soul, scoped subdir)
//   6. ~/.chainofclaw                       (legacy default; retained so pre-1.2.0 users don't lose their nodes.json)
//
// /tmp is intentionally NOT used as a fallback: it's volatile and not a
// valid place for the persistent node registry. If none of (1)-(6) are
// writable, the resolver throws an actionable error so the operator can fix
// the deployment instead of silently losing nodes.json on next reboot.
//
// Default-changed-in-1.2.0 note: prior versions defaulted to ~/.chainofclaw.
// New installs land at ~/.claw-mem/coc-node so the three @chainofclaw plugins
// share one operator-managed dir (one env var moves them all). Existing
// installs with content under ~/.chainofclaw/nodes.json keep working via the
// legacy fallback at the bottom of the chain.

import {
  existsSync,
  accessSync,
  mkdirSync,
  constants as fsConst,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type { Logger } from "./types.ts"

/** Lazy because tests override $HOME. */
export function defaultDataDir(): string {
  return join(homedir(), ".claw-mem", "coc-node")
}

/** Eager constant for callers that captured the path at module load. */
export const DEFAULT_DATA_DIR = defaultDataDir()

/** Lazy legacy default (pre-1.2.0). Probed last; only wins if it already exists with content. */
export function legacyDataDir(): string {
  return join(homedir(), ".chainofclaw")
}

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
  const nodeEnv = process.env.COC_NODE_DATA_DIR
  if (nodeEnv && nodeEnv.length > 0) {
    candidates.push({ path: nodeEnv, label: "env COC_NODE_DATA_DIR" })
  }
  const sharedEnv = process.env.CLAW_MEM_DATA_DIR
  if (sharedEnv && sharedEnv.length > 0) {
    // Shared with claw-mem + soul; scope into a subdir so nodes.json doesn't
    // collide with claw-mem.db or soul's keystore.
    candidates.push({
      path: join(sharedEnv, "coc-node"),
      label: "env CLAW_MEM_DATA_DIR/coc-node (shared with claw-mem + soul)",
    })
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR
  if (stateDir && stateDir.length > 0) {
    candidates.push({
      path: join(stateDir, "coc-node"),
      label: "OpenClaw state dir ($OPENCLAW_STATE_DIR)",
    })
  }
  candidates.push({ path: defaultDataDir(), label: "default ~/.claw-mem/coc-node" })
  // Legacy fallback (pre-1.2.0): only wins if it already exists *with content*,
  // so a fresh install never lands here. Existing installs that have a
  // pre-existing nodes.json keep working without forcing a manual move.
  const legacy = legacyDataDir()
  if (existsSync(join(legacy, "nodes.json"))) {
    candidates.push({ path: legacy, label: "legacy ~/.chainofclaw (pre-1.2.0)" })
  }

  const triedPaths: string[] = []
  for (const { path, label } of candidates) {
    triedPaths.push(`${path} (${label})`)
    if (!isPathWritable(path)) {
      opts.logger?.debug?.(`[coc-node] candidate not writable: ${path} (${label})`)
      continue
    }
    try {
      mkdirSync(path, { recursive: true })
      if (label.startsWith("OpenClaw state") || label.startsWith("env") || label.startsWith("legacy")) {
        opts.logger?.info(`[coc-node] using ${label} dataDir at ${path}`)
      }
      if (label.startsWith("legacy")) {
        opts.logger?.warn(
          `[coc-node] using legacy ~/.chainofclaw — new default is ~/.claw-mem/coc-node. ` +
            `To migrate: move nodes.json to ~/.claw-mem/coc-node/nodes.json (or set $CLAW_MEM_DATA_DIR).`,
        )
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
      `  • CLAW_MEM_DATA_DIR=<absolute writable dir>  (shared with @chainofclaw/claw-mem and @chainofclaw/soul)\n` +
      `  • COC_NODE_DATA_DIR=<absolute writable dir>  (coc-node-specific override)\n` +
      `  • OPENCLAW_STATE_DIR=<writable dir>          (OpenClaw's standard state-dir convention)\n` +
      `  • mount a writable filesystem at ~/.claw-mem`,
  )
}
