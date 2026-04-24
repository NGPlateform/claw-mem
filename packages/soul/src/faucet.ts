// Auto-faucet client.
//
// COC testnet exposes a public faucet at http://199.192.16.79:3003 that
// drips 10 COC per request, gated by a 24-hour per-address cooldown +
// per-IP rate limit. We call it once when the keystore generates a fresh
// agent key so write-path commands (DID register, soul backup, etc.)
// have gas the moment the user runs them.
//
// Set `backup.faucetUrl: ""` in config to disable.

import type { Logger } from "./types.ts"

export interface FaucetDripResult {
  txHash: string
  amount: string
  unit: string
}

export interface RequestFaucetDripOptions {
  /** Faucet base URL (e.g. http://199.192.16.79:3003). Empty string disables. */
  url: string
  /** EOA address to fund. */
  address: string
  /** Hard timeout. Default 10s. */
  timeoutMs?: number
  logger?: Logger
}

/**
 * Best-effort faucet drip. Always resolves: returns result on success, null
 * on any failure (network, rate-limit, cooldown, malformed response). Logs
 * warn-level diagnostics so the user sees why it didn't fund.
 */
export async function requestFaucetDrip(
  opts: RequestFaucetDripOptions,
): Promise<FaucetDripResult | null> {
  const base = opts.url.replace(/\/$/, "")
  if (!base) return null

  const timeoutMs = opts.timeoutMs ?? 10_000
  try {
    const res = await fetch(`${base}/faucet/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: opts.address }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) {
      let detail = ""
      try { detail = (await res.text()).slice(0, 200) } catch { /* ignore */ }
      opts.logger?.warn(
        `[coc-soul] faucet drip failed (${res.status}): ${detail || "no body"}`,
      )
      return null
    }

    const data = (await res.json()) as Partial<FaucetDripResult>
    if (!data.txHash || !data.amount) {
      opts.logger?.warn(`[coc-soul] faucet returned malformed response`)
      return null
    }

    opts.logger?.info(
      `[coc-soul] faucet dripped ${data.amount} ${data.unit ?? "COC"} to ${opts.address} (tx ${data.txHash.slice(0, 10)}...)`,
    )
    return data as FaucetDripResult
  } catch (err) {
    const msg = String(err).slice(0, 200)
    opts.logger?.warn(`[coc-soul] faucet unavailable: ${msg}`)
    return null
  }
}
