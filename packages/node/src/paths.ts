// Path resolvers for the COC integration in claw-mem.
//
// Unlike the original coc-nodeops, claw-mem may live outside the COC repo,
// so the COC root is taken from `config.bootstrap.cocRepoPath` or discovered
// by walking up looking for marker files. Data dirs all live under
// `~/.claw-mem` by default.

import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"

export interface CocRepoLocator {
  cocRepoPath?: string
  searchStartDir?: string
}

const COC_MARKERS = [
  join("contracts", "hardhat.config.cjs"),
  join("node", "src", "index.ts"),
  join("runtime", "coc-agent.ts"),
]

export function expandTilde(p: string): string {
  if (!p) return p
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  if (p === "~") return homedir()
  return p
}

/**
 * Resolve the COC repository root.
 *
 * Priority:
 *  1. Explicit `cocRepoPath` (expanded ~).
 *  2. `COC_REPO_PATH` env var.
 *  3. Walk up from `searchStartDir` (default cwd) looking for marker files.
 *
 * Throws if not found.
 */
export function resolveCocRoot(locator: CocRepoLocator = {}): string {
  const candidates: string[] = []
  if (locator.cocRepoPath) candidates.push(expandTilde(locator.cocRepoPath))
  const envPath = process.env.COC_REPO_PATH
  if (envPath) candidates.push(expandTilde(envPath))

  for (const candidate of candidates) {
    const abs = isAbsolute(candidate) ? candidate : resolve(candidate)
    if (looksLikeCocRoot(abs)) return abs
  }

  // Walk up from searchStartDir looking for marker files
  let cursor = locator.searchStartDir ? resolve(locator.searchStartDir) : process.cwd()
  for (let i = 0; i < 32; i++) {
    if (looksLikeCocRoot(cursor)) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }

  // Fallback: try $HOME/COC and ../COC relative to cwd
  const homeCoc = join(homedir(), "COC")
  if (looksLikeCocRoot(homeCoc)) return homeCoc

  throw new Error(
    "COC repository not found. Set bootstrap.cocRepoPath in claw-mem config " +
      "or COC_REPO_PATH env var, or place this process inside the COC repo.",
  )
}

export function looksLikeCocRoot(dir: string): boolean {
  return COC_MARKERS.some((marker) => existsSync(join(dir, marker)))
}

export function resolveRuntimeDir(locator: CocRepoLocator = {}): string {
  return join(resolveCocRoot(locator), "runtime")
}

export function resolveContractsDir(locator: CocRepoLocator = {}): string {
  return join(resolveCocRoot(locator), "contracts")
}

export function resolveNodeEntryScript(locator: CocRepoLocator = {}): string {
  return join(resolveCocRoot(locator), "node", "src", "index.ts")
}

/**
 * Verify the COC repo is usable for spawning processes (node/agent/relayer).
 * Returns a `{ ok, root, missing }` report — does not throw.
 *
 * Used by `claw-mem doctor` and as a pre-check inside `node install` / `node
 * start` so failures don't manifest as opaque ENOENT from process spawn.
 */
export interface CocRepoCheck {
  ok: boolean
  root: string | null
  missing: string[]
  error?: string
}

export function checkCocRepo(locator: CocRepoLocator = {}): CocRepoCheck {
  let root: string
  try {
    root = resolveCocRoot(locator)
  } catch (err) {
    return {
      ok: false,
      root: null,
      missing: COC_MARKERS,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const required = [
    join("node", "src", "index.ts"),
    join("runtime", "coc-agent.ts"),
    join("runtime", "coc-relayer.ts"),
    join("contracts", "hardhat.config.cjs"),
  ]
  const missing = required.filter((rel) => !existsSync(join(root, rel)))
  return { ok: missing.length === 0, root, missing }
}

export function describeCocRepoCheck(check: CocRepoCheck): string {
  if (check.ok) return `COC repo at ${check.root}`
  if (!check.root) {
    return (
      `COC repo not located. Set bootstrap.cocRepoPath via ` +
      `\`claw-mem config set bootstrap.cocRepoPath <abs-path>\` or run \`claw-mem init\`.`
    )
  }
  return (
    `COC repo at ${check.root} is incomplete; missing: ${check.missing.join(", ")}. ` +
    `Did you \`git submodule update --init\` and \`npm install\` inside contracts/?`
  )
}
