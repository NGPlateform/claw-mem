// Helpers for attaching admin-RPC bearer authentication to JsonRpcProvider
// and direct fetch() calls.
//
// Background: COC node v0.2+ gates `admin_*` RPC methods behind a two-layer
// check — `enableAdminRpc=true` AND (`Authorization: Bearer <token>` OR a
// loopback request). When a user-supplied token is configured (either via
// the `backup.rpcAuthToken` config key or the `COC_RPC_AUTH_TOKEN`
// environment variable), we forward it on every outbound RPC call.

import { FetchRequest, JsonRpcProvider } from "ethers"

/**
 * Resolve the effective RPC auth token. Precedence:
 *   1. Explicit `token` parameter (e.g. from config)
 *   2. `COC_RPC_AUTH_TOKEN` environment variable
 *   3. `undefined` (no auth header sent)
 */
export function resolveRpcAuthToken(token?: string): string | undefined {
  if (token) return token
  const env = process.env.COC_RPC_AUTH_TOKEN
  return env && env.length > 0 ? env : undefined
}

/**
 * Construct a JsonRpcProvider that automatically attaches the bearer token
 * (when present) to every request. Falls back to a plain JsonRpcProvider
 * when no token is resolved, so existing unauthenticated flows are
 * unaffected.
 */
export function createAuthedProvider(rpcUrl: string, token?: string): JsonRpcProvider {
  const resolved = resolveRpcAuthToken(token)
  if (!resolved) {
    return new JsonRpcProvider(rpcUrl)
  }
  const fetchReq = new FetchRequest(rpcUrl)
  fetchReq.setHeader("Authorization", `Bearer ${resolved}`)
  return new JsonRpcProvider(fetchReq)
}

/**
 * Build header object suitable for a raw `fetch()` call. Always returns the
 * `Content-Type: application/json` baseline; the Authorization header is
 * only added when a token is resolved.
 */
export function authedJsonHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const resolved = resolveRpcAuthToken(token)
  if (resolved) headers.Authorization = `Bearer ${resolved}`
  return headers
}
