// Local agent keystore.
//
// When the user has not configured `backup.privateKey`, the soul layer
// auto-generates an EOA on first use and persists it to a chmod-600 file
// at ~/.claw-mem/keys/agent.key. This means a fresh `coc-soul` install
// can run on testnet without any pre-config — the user just funds the
// auto-generated address.
//
// Manual override: set `backup.privateKey` in config to bypass the keystore
// (e.g. when using an existing mainnet account). Manual privateKey always
// wins; the keystore file is never overwritten if config supplies one.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Wallet } from "ethers"

import type { Logger } from "./types.ts"

export const DEFAULT_KEYSTORE_PATH = join(homedir(), ".claw-mem", "keys", "agent.key")

export interface EnsureAgentKeyOptions {
  /** Override key file location. Defaults to ~/.claw-mem/keys/agent.key. */
  keyPath?: string
  logger?: Logger
}

export interface AgentKey {
  privateKey: string
  address: string
  /** True if this call generated a fresh key; false if loaded from disk. */
  generated: boolean
}

/**
 * Read or generate the local agent keystore. Generated key is written
 * with mode 0o600 to a directory created with mode 0o700.
 *
 * Caller is responsible for not calling this if `config.privateKey` is
 * already set — the keystore is a fallback, not a default.
 */
export function ensureAgentKey(opts: EnsureAgentKeyOptions = {}): AgentKey {
  const keyPath = opts.keyPath ?? DEFAULT_KEYSTORE_PATH
  if (existsSync(keyPath)) {
    const privateKey = readFileSync(keyPath, "utf-8").trim()
    const wallet = new Wallet(privateKey)
    return { privateKey, address: wallet.address, generated: false }
  }

  const wallet = Wallet.createRandom()
  const privateKey = wallet.privateKey
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 })
  writeFileSync(keyPath, privateKey, { mode: 0o600 })
  // chmod again — some umasks override the create flag.
  try { chmodSync(keyPath, 0o600) } catch { /* best effort */ }

  if (opts.logger) {
    opts.logger.info(`[coc-soul] auto-generated agent key at ${keyPath}`)
    opts.logger.info(`[coc-soul] agent address: ${wallet.address}`)
    opts.logger.info(`[coc-soul] fund this address on the target network to enable on-chain ops`)
  }

  return { privateKey, address: wallet.address, generated: true }
}
