// Shared data-dir resolver for @chainofclaw/soul.
//
// Mirrors the resolution chain used by @chainofclaw/claw-mem so that both
// plugins share the same on-disk root by default — operators can move them
// together with one env var, and a sandboxed host that's writable for one is
// writable for the other.
//
// Two related concerns live here:
//
//   1. resolveSoulDataDir() — where soul writes its OWN files (keystore,
//      config.json, carrier scratch dirs). Returns the first WRITABLE path
//      from the candidate chain, throws an actionable error if none works.
//      /tmp is intentionally NOT a fallback: it's volatile and not a valid
//      home for a long-lived agent identity.
//
//   2. resolveClawMemDbPath() — where claw-mem's READABLE SQLite database
//      probably lives. Returns the first EXISTING file (not just writable),
//      so the soul backup pipeline can opportunistically include claw-mem's
//      semantic snapshot when claw-mem is co-installed. Returns null if no
//      file is found — semantic snapshot is opt-in.

import { existsSync, accessSync, constants as fsConst } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

/**
 * Default soul data root — shared with claw-mem.
 *
 * Computed lazily at each call so tests can override `$HOME` mid-process. The
 * returned function is the `~/.claw-mem` directory at the moment of the call.
 */
export function defaultSoulDataDir(): string {
  return join(homedir(), ".claw-mem")
}

/** Eager constant for callers that captured the path at module-load time. */
export const DEFAULT_SOUL_DATA_DIR = defaultSoulDataDir()

/** Default claw-mem DB filename. */
export const CLAW_MEM_DB_FILENAME = "claw-mem.db"

export interface ResolveDataDirOptions {
  /** Per-instance plugin config; wins over env vars. */
  configDataDir?: string
  /** Optional logger for debug breadcrumbs. */
  logger?: { debug?(msg: string): void }
}

interface Candidate {
  path: string
  label: string
}

function expandTilde(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p
}

function isPathWritable(path: string): boolean {
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

function buildSoulCandidates(opts: ResolveDataDirOptions): Candidate[] {
  const out: Candidate[] = []
  if (opts.configDataDir && opts.configDataDir.length > 0) {
    out.push({ path: expandTilde(opts.configDataDir), label: "config.dataDir" })
  }
  const envOverride = process.env.CLAW_MEM_DATA_DIR
  if (envOverride && envOverride.length > 0) {
    out.push({ path: expandTilde(envOverride), label: "env CLAW_MEM_DATA_DIR" })
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR
  if (stateDir && stateDir.length > 0) {
    out.push({ path: join(stateDir, "coc-soul"), label: "$OPENCLAW_STATE_DIR/coc-soul" })
  }
  out.push({ path: defaultSoulDataDir(), label: "default ~/.claw-mem" })
  // Last-resort auto-fallback to OpenClaw's per-host runtime state dir.
  // ONLY tried when ~/.claw-mem isn't writable (e.g. pre-existing dir owned
  // by the wrong uid in a Docker-style multi-user host). 1.2.2+. Sits at the
  // end so existing users with a writable ~/.claw-mem get unchanged behavior.
  out.push({ path: join(homedir(), ".openclaw", "state", "coc-soul"), label: "auto ~/.openclaw/state/coc-soul" })
  return out
}

/**
 * Resolve where soul should write its own data (keystore, config, scratch).
 * Returns the first writable candidate; throws an actionable error if none.
 */
export function resolveSoulDataDir(opts: ResolveDataDirOptions = {}): string {
  const candidates = buildSoulCandidates(opts)
  const tried: string[] = []
  for (const c of candidates) {
    tried.push(`${c.path} (${c.label})`)
    if (isPathWritable(c.path)) return c.path
    opts.logger?.debug?.(`[coc-soul] data-dir candidate not writable: ${c.path} (${c.label})`)
  }
  // No candidate worked. The dollar sign in the heredoc-style hints below
  // is intentional — we want the user to literally export the variable.
  const home = homedir()
  throw new Error(
    `Could not find a writable directory for coc-soul data. Tried:\n` +
      tried.map((p) => `  - ${p}`).join("\n") +
      `\n\nQuick fix (copy-paste, then restart the gateway):\n` +
      `  mkdir -p ${home}/.openclaw/state/coc-soul\n` +
      `  export CLAW_MEM_DATA_DIR=${home}/.openclaw/state\n` +
      `\nOr pick one of these alternatives:\n` +
      `  • CLAW_MEM_DATA_DIR=<absolute writable dir>  (shared with @chainofclaw/claw-mem)\n` +
      `  • OPENCLAW_STATE_DIR=<absolute writable dir> (OpenClaw's standard state-dir convention)\n` +
      `  • plugins.entries.coc-soul.config.backup.dataDir = "<absolute writable dir>"  (per-instance)\n` +
      `  • chown the existing ~/.claw-mem to the user running the gateway\n` +
      `\nUid context: process.getuid()=${(process as unknown as { getuid?(): number }).getuid?.() ?? "n/a"}, ` +
      `HOME=${home}`,
  )
}

/**
 * Resolve where claw-mem's SQLite database probably lives. Returns the path
 * to the first EXISTING file in the candidate chain, or null if claw-mem is
 * not installed / hasn't initialized yet.
 *
 * Mirrors @chainofclaw/claw-mem's own resolveDataDir() chain so the two
 * plugins agree on disk by default.
 */
export function resolveClawMemDbPath(opts: ResolveDataDirOptions = {}): string | null {
  const candidates: Candidate[] = []
  if (opts.configDataDir && opts.configDataDir.length > 0) {
    candidates.push({
      path: join(expandTilde(opts.configDataDir), CLAW_MEM_DB_FILENAME),
      label: "config.dataDir",
    })
  }
  const env = process.env.CLAW_MEM_DATA_DIR
  if (env && env.length > 0) {
    candidates.push({ path: join(expandTilde(env), CLAW_MEM_DB_FILENAME), label: "env CLAW_MEM_DATA_DIR" })
  }
  const state = process.env.OPENCLAW_STATE_DIR
  if (state && state.length > 0) {
    candidates.push({
      path: join(state, "claw-mem", CLAW_MEM_DB_FILENAME),
      label: "$OPENCLAW_STATE_DIR/claw-mem",
    })
  }
  candidates.push({
    path: join(defaultSoulDataDir(), CLAW_MEM_DB_FILENAME),
    label: "default ~/.claw-mem",
  })

  for (const c of candidates) {
    if (existsSync(c.path)) return c.path
    opts.logger?.debug?.(`[coc-soul] claw-mem DB not found at ${c.path} (${c.label})`)
  }
  return null
}
