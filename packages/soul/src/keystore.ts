// Local agent keystore.
//
// When the user has not configured `backup.privateKey`, the soul layer
// auto-generates an EOA on first use and persists it to a chmod-600 file.
// Path resolution priority (highest first):
//
//   1. explicit `keyPath` option (plugin activate() can pass an
//      OpenClaw-injected workspace path)
//   2. `COC_SOUL_KEYSTORE_PATH` env var (operator override)
//   3. `<OPENCLAW_STATE_DIR>/coc-soul/keys/agent.key` (OpenClaw's
//      sandbox-managed state dir; the recommended location when
//      running as a plugin)
//   4. `~/.claw-mem/keys/agent.key` (default for standalone use
//      outside OpenClaw)
//
// /tmp is intentionally NOT used as a fallback: it's volatile and not a
// valid place for a long-lived agent identity. If none of (1)-(4) are
// writable, the keystore throws an actionable error so the operator can
// fix the deployment instead of silently losing the key on next reboot.
//
// Manual override: set `backup.privateKey` in config to bypass the keystore
// entirely (e.g. when using an existing mainnet account).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  accessSync,
  constants as fsConst,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Wallet } from "ethers"

import type { Logger } from "./types.ts"

export const DEFAULT_KEYSTORE_PATH = join(homedir(), ".claw-mem", "keys", "agent.key")

export interface EnsureAgentKeyOptions {
  /** Override key file location. Wins over env var, OpenClaw state dir, and default. */
  keyPath?: string
  logger?: Logger
}

export interface AgentKey {
  privateKey: string
  address: string
  /** True if this call generated a fresh key; false if loaded from disk. */
  generated: boolean
  /** Where the key actually lives on disk. */
  keyPath: string
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

function buildCandidatePaths(opts: EnsureAgentKeyOptions): Array<{ path: string; label: string }> {
  const candidates: Array<{ path: string; label: string }> = []
  if (opts.keyPath && opts.keyPath.length > 0) {
    candidates.push({ path: opts.keyPath, label: "explicit keyPath" })
  }
  const envOverride = process.env.COC_SOUL_KEYSTORE_PATH
  if (envOverride && envOverride.length > 0) {
    candidates.push({ path: envOverride, label: "env COC_SOUL_KEYSTORE_PATH" })
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR
  if (stateDir && stateDir.length > 0) {
    candidates.push({
      path: join(stateDir, "coc-soul", "keys", "agent.key"),
      label: "OpenClaw state dir ($OPENCLAW_STATE_DIR)",
    })
  }
  candidates.push({ path: DEFAULT_KEYSTORE_PATH, label: "default ~/.claw-mem" })
  return candidates
}

/**
 * Read or generate the local agent keystore. Walks candidate paths in
 * priority order, picks the first writable winner, and either loads an
 * existing key from it or generates + writes a fresh one.
 *
 * Critically, the search does NOT cross candidates looking for an
 * existing file — that would let a low-priority path (e.g. ~/.claw-mem)
 * shadow what the operator set via OPENCLAW_STATE_DIR. The winner is
 * decided purely by writability + priority order.
 *
 * Caller is responsible for not calling this if `config.privateKey` is
 * already set — the keystore is a fallback, not a default.
 */
export function ensureAgentKey(opts: EnsureAgentKeyOptions = {}): AgentKey {
  const candidates = buildCandidatePaths(opts)
  const triedPaths: string[] = []

  for (const { path, label } of candidates) {
    triedPaths.push(`${path} (${label})`)
    if (!isPathWritable(path)) {
      opts.logger?.debug?.(`[coc-soul] candidate not writable: ${path} (${label})`)
      continue
    }

    // If a key already exists at the chosen winner, load it.
    if (existsSync(path)) {
      try {
        const privateKey = readFileSync(path, "utf-8").trim()
        const wallet = new Wallet(privateKey)
        return { privateKey, address: wallet.address, generated: false, keyPath: path }
      } catch (err) {
        opts.logger?.warn(
          `[coc-soul] keystore at ${path} unreadable (${String(err).slice(0, 120)}); trying next candidate`,
        )
        continue
      }
    }

    // Otherwise, generate + persist.
    const wallet = Wallet.createRandom()
    const privateKey = wallet.privateKey
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      writeFileSync(path, privateKey, { mode: 0o600 })
      try { chmodSync(path, 0o600) } catch { /* best effort */ }
      opts.logger?.info(`[coc-soul] auto-generated agent key at ${path} (${label})`)
      opts.logger?.info(`[coc-soul] agent address: ${wallet.address}`)
      opts.logger?.info(`[coc-soul] fund this address on the target network to enable on-chain ops`)
      return { privateKey, address: wallet.address, generated: true, keyPath: path }
    } catch (err) {
      opts.logger?.warn(
        `[coc-soul] writing keystore to ${path} failed (${String(err).slice(0, 120)}); trying next candidate`,
      )
    }
  }

  throw new Error(
    `Could not find a writable location for the agent keystore. Tried:\n` +
      triedPaths.map((p) => `  - ${p}`).join("\n") +
      `\n\nFix: set one of:\n` +
      `  • COC_SOUL_KEYSTORE_PATH=<absolute path to a writable file> (operator override)\n` +
      `  • OPENCLAW_STATE_DIR=<writable dir> (OpenClaw's standard state-dir convention)\n` +
      `  • backup.privateKey in your claw-mem config (skip the keystore entirely)\n` +
      `  • mount a writable filesystem at ~/.claw-mem`,
  )
}
