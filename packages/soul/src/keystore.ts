// Local agent keystore.
//
// When the user has not configured `backup.privateKey`, the soul layer
// auto-generates an EOA on first use and persists it to a chmod-600 file.
// Path resolution priority:
//
//   1. explicit `keyPath` option (e.g. plugin activate() passes a workspace
//      path injected by the host)
//   2. `COC_SOUL_KEYSTORE_PATH` env var (operator override)
//   3. `~/.claw-mem/keys/agent.key` (default)
//   4. `<os.tmpdir()>/coc-soul/keys/agent.key` (fallback when (3) is not
//      writable — e.g. read-only HOME inside a sandbox)
//
// Manual override: set `backup.privateKey` in config to bypass the keystore
// (e.g. when using an existing mainnet account). Manual privateKey always
// wins; the keystore file is never overwritten if config supplies one.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  accessSync,
  constants as fsConst,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Wallet } from "ethers"

import type { Logger } from "./types.ts"

export const DEFAULT_KEYSTORE_PATH = join(homedir(), ".claw-mem", "keys", "agent.key")
export const FALLBACK_KEYSTORE_PATH = join(tmpdir(), "coc-soul", "keys", "agent.key")

export interface EnsureAgentKeyOptions {
  /** Override key file location. Wins over env var and defaults. */
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

function isWritable(path: string): boolean {
  // existing file: must be writable
  if (existsSync(path)) {
    try {
      accessSync(path, fsConst.R_OK | fsConst.W_OK)
      return true
    } catch {
      return false
    }
  }
  // missing file: parent (or first existing ancestor) must be writable
  let cursor = dirname(path)
  for (let i = 0; i < 16; i++) {
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

function resolveKeyPath(opts: EnsureAgentKeyOptions): string {
  if (opts.keyPath) return opts.keyPath
  const envOverride = process.env.COC_SOUL_KEYSTORE_PATH
  if (envOverride && envOverride.length > 0) return envOverride
  if (isWritable(DEFAULT_KEYSTORE_PATH)) return DEFAULT_KEYSTORE_PATH
  if (opts.logger) {
    opts.logger.warn(
      `[coc-soul] default keystore path ${DEFAULT_KEYSTORE_PATH} not writable; falling back to ${FALLBACK_KEYSTORE_PATH}`,
    )
  }
  return FALLBACK_KEYSTORE_PATH
}

/**
 * Read or generate the local agent keystore. Generated key is written
 * with mode 0o600 to a directory created with mode 0o700.
 *
 * Caller is responsible for not calling this if `config.privateKey` is
 * already set — the keystore is a fallback, not a default.
 */
export function ensureAgentKey(opts: EnsureAgentKeyOptions = {}): AgentKey {
  const keyPath = resolveKeyPath(opts)
  if (existsSync(keyPath)) {
    const privateKey = readFileSync(keyPath, "utf-8").trim()
    const wallet = new Wallet(privateKey)
    return { privateKey, address: wallet.address, generated: false, keyPath }
  }

  const wallet = Wallet.createRandom()
  const privateKey = wallet.privateKey
  try {
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 })
    writeFileSync(keyPath, privateKey, { mode: 0o600 })
    try { chmodSync(keyPath, 0o600) } catch { /* best effort */ }
  } catch (err) {
    // Last-resort fallback: write to tmpdir even if everything else fails.
    if (keyPath !== FALLBACK_KEYSTORE_PATH) {
      if (opts.logger) {
        opts.logger.warn(
          `[coc-soul] writing to ${keyPath} failed (${String(err).slice(0, 120)}); retrying at ${FALLBACK_KEYSTORE_PATH}`,
        )
      }
      mkdirSync(dirname(FALLBACK_KEYSTORE_PATH), { recursive: true, mode: 0o700 })
      writeFileSync(FALLBACK_KEYSTORE_PATH, privateKey, { mode: 0o600 })
      try { chmodSync(FALLBACK_KEYSTORE_PATH, 0o600) } catch { /* best effort */ }
      if (opts.logger) {
        opts.logger.info(`[coc-soul] auto-generated agent key at ${FALLBACK_KEYSTORE_PATH}`)
        opts.logger.info(`[coc-soul] agent address: ${wallet.address}`)
        opts.logger.info(`[coc-soul] fund this address on the target network to enable on-chain ops`)
      }
      return { privateKey, address: wallet.address, generated: true, keyPath: FALLBACK_KEYSTORE_PATH }
    }
    throw err
  }

  if (opts.logger) {
    opts.logger.info(`[coc-soul] auto-generated agent key at ${keyPath}`)
    opts.logger.info(`[coc-soul] agent address: ${wallet.address}`)
    opts.logger.info(`[coc-soul] fund this address on the target network to enable on-chain ops`)
  }

  return { privateKey, address: wallet.address, generated: true, keyPath }
}
