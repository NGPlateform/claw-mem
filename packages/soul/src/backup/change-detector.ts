// Change detection: compare current files against previous manifest
// Uses mtime for fast pre-filter, then SHA-256 for confirmation

import { readdir, stat, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

const MAX_FILE_BYTES = 100 * 1024 * 1024 // 100 MB
import { sha256Hex } from "../crypto.ts"
import type { FileState, FileCategory, ChangeSet, SnapshotManifest } from "../backup-types.ts"
import type { CocBackupConfig } from "../backup-config-schema.ts"

// File classification rules.
//
// Identity / memory / workspace markdowns historically lived at the root of
// `~/.openclaw/`. OpenClaw later moved them into `~/.openclaw/workspace/`.
// Patterns below accept BOTH layouts via the optional `(workspace/)?` prefix
// so backups don't silently miss IDENTITY.md / SOUL.md / MEMORY.md / etc.
// when they live under workspace/. Operator-side report (2026-04-26)
// confirmed `workspace/IDENTITY.md` was being skipped by the old regex
// `^IDENTITY\.md$`, leaving restored agents without their assigned name.
//
// 1.2.9 audit added: TOOLS / HEARTBEAT / BOOTSTRAP markdowns under
// workspace/, daily memory entries under workspace/memory/, the actual
// `workspace-state.json` location (`workspace/.openclaw/...`), the paired
// `device-auth.json`, the agent's `models.json` (now holds literal LLM
// API keys post-1.2.6 — encrypted!), and `exec-approvals.json`.
const FILE_RULES: Array<{ pattern: RegExp; category: FileCategory; encrypt: boolean }> = [
  // Identity-level markdown files (root-level OR under workspace/)
  { pattern: /^(workspace\/)?IDENTITY\.md$/, category: "identity", encrypt: false },
  { pattern: /^(workspace\/)?SOUL\.md$/, category: "identity", encrypt: false },
  { pattern: /^(workspace\/)?BOOTSTRAP\.md$/, category: "identity", encrypt: false },
  // Identity / config files at fixed locations
  { pattern: /^identity\/device\.json$/, category: "config", encrypt: true },
  { pattern: /^identity\/device-auth\.json$/, category: "config", encrypt: true },
  { pattern: /^auth\.json$/, category: "config", encrypt: true },
  // Memory markdown files (root-level OR under workspace/)
  { pattern: /^(workspace\/)?MEMORY\.md$/, category: "memory", encrypt: false },
  { pattern: /^(workspace\/)?USER\.md$/, category: "memory", encrypt: false },
  // Daily / per-topic memory entries: memory/*.md OR workspace/memory/*.md
  { pattern: /^(workspace\/)?memory\/.*\.md$/, category: "memory", encrypt: false },
  // Recovery context (generated on restore for agent context injection)
  { pattern: /^(workspace\/)?RECOVERY_CONTEXT\.md$/, category: "memory", encrypt: false },
  // Workspace markdown / state
  { pattern: /^(workspace\/)?AGENTS\.md$/, category: "workspace", encrypt: false },
  { pattern: /^(workspace\/)?TOOLS\.md$/, category: "workspace", encrypt: false },
  { pattern: /^(workspace\/)?HEARTBEAT\.md$/, category: "workspace", encrypt: false },
  // Workspace state — historical root-level layout AND current
  // `workspace/.openclaw/workspace-state.json` location
  { pattern: /^workspace-state\.json$/, category: "workspace", encrypt: false },
  { pattern: /^workspace\/\.openclaw\/workspace-state\.json$/, category: "workspace", encrypt: false },
  // Chat sessions
  { pattern: /^agents\/.*\/sessions\/.*\.jsonl$/, category: "chat", encrypt: false },
  { pattern: /^agents\/.*\/sessions\/sessions\.json$/, category: "chat", encrypt: false },
  // Note: agents/<id>/agent/models.json and auth-profiles.json are
  // intentionally NOT backed up (1.2.10+). They hold host-local provider
  // tokens / OAuth profiles that must NOT travel across hosts. Target
  // host's operator owns this state and configures it locally per the
  // gateway-auth preservation rule in references/backup.md.
  // Database files (SQLite memory index, LanceDB vector store)
  { pattern: /^memory\/[^/]+\.sqlite$/, category: "database", encrypt: true },
  { pattern: /^memory\/lancedb\/.*/, category: "database", encrypt: true },
  // OpenClaw config and plugin manifests
  { pattern: /^openclaw\.json$/, category: "config", encrypt: true },
  { pattern: /^plugins\/.*\/openclaw\.plugin\.json$/, category: "config", encrypt: false },
  // Bash / tool approval rules — operator-curated, expensive to rebuild
  { pattern: /^exec-approvals\.json$/, category: "config", encrypt: true },
  // Credentials
  { pattern: /^credentials\/.*/, category: "config", encrypt: true },
  // Context snapshot
  { pattern: /^\.coc-backup\/context-snapshot\.json$/, category: "workspace", encrypt: false },
  // Semantic snapshot (claw-mem observations + summaries)
  { pattern: /^\.coc-backup\/semantic-snapshot\.json$/, category: "memory", encrypt: false },
]

// ──────────────────────────────────────────────────────────────────────────
// Denylist — paths that must NOT be backed up regardless of FILE_RULES.
//
// Most of these are already excluded simply because no whitelist pattern
// matches them, but we encode them explicitly so:
//  (a) the walker can prune entire dirs without reading their contents
//      (huge IO savings for node_modules / install-backup trees), and
//  (b) future additions to FILE_RULES can't accidentally pull them in.
//
// Categories of denylisted content:
//   - operator audit copies          (*.bak, *.pre-*, *.rejected.<ts>, *.last-good)
//   - install-time snapshots         (.openclaw-install-backups, stale-*-backup.tar.gz)
//   - restore audit trail            (.restore-overwrite-backup-<ts>)
//   - source-managed trees           (.git, node_modules)
//   - circular-reference state       (.coc-backup/state.json — backup-chain head)
// ──────────────────────────────────────────────────────────────────────────

/** Directory names skipped at the walker level — never recurse into these. */
const SKIP_DIRS_BY_NAME: ReadonlySet<string> = new Set([
  ".git",                        // git repo state — versioned by git itself
  "node_modules",                // dependency tree — re-installed per host
  ".openclaw-install-backups",   // openclaw plugins install rotation copies
])

/** Directory-name patterns skipped at the walker level. */
const SKIP_DIR_NAME_PATTERNS: readonly RegExp[] = [
  /^\.restore-overwrite-backup-/,  // operator's pre-restore audit copy of openclaw home
]

/** File-name patterns skipped at the walker level — operator audit copies. */
const SKIP_FILE_NAME_PATTERNS: readonly RegExp[] = [
  /\.bak$/,                                       // openclaw.json.bak
  /\.bak\.\d+$/,                                  // openclaw.json.bak.1
  /\.pre-[a-zA-Z0-9-]+$/,                         // openclaw.json.pre-allowlist, models.json.pre-llm-config
  /\.rejected\.[\dTZ:.\-]+$/,                     // openclaw.json.rejected.<iso-ts>
  /\.last-good$/,                                 // openclaw.json.last-good
  /^stale-.*backup.*\.tar\.gz$/,                  // stale-home-node-backup-<ts>.tar.gz
]

/** Specific file relative paths denied even if they would otherwise match a FILE_RULE. */
const SKIP_FILE_RELATIVE_PATHS: ReadonlySet<string> = new Set([
  ".coc-backup/state.json",  // backup chain head — circular reference if backed up
])

function shouldSkipDir(name: string): boolean {
  if (SKIP_DIRS_BY_NAME.has(name)) return true
  for (const re of SKIP_DIR_NAME_PATTERNS) if (re.test(name)) return true
  return false
}

function shouldSkipFileByName(name: string): boolean {
  for (const re of SKIP_FILE_NAME_PATTERNS) if (re.test(name)) return true
  return false
}

function classifyFile(relativePath: string): { category: FileCategory; encrypt: boolean } | null {
  // Hard-coded relative-path denylist wins over the whitelist.
  if (SKIP_FILE_RELATIVE_PATHS.has(relativePath)) return null
  for (const rule of FILE_RULES) {
    if (rule.pattern.test(relativePath)) {
      return { category: rule.category, encrypt: rule.encrypt }
    }
  }
  return null
}

/** Recursively scan directory for backup-eligible files */
async function scanFiles(baseDir: string, config: CocBackupConfig): Promise<FileState[]> {
  const files: FileState[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        // Hard denylist wins (1.2.10+): skip operator audit / install /
        // restore copies regardless of dotfile status.
        if (shouldSkipDir(entry.name)) continue
        // Skip most hidden dirs by default. Allow-listed names get walked
        // because they hold real backup-eligible content:
        //   .claude     — historical agent state
        //   .coc-backup — context-snapshot.json + semantic-snapshot.json
        //   .openclaw   — OpenClaw's per-workspace state dir (e.g.
        //                 workspace/.openclaw/workspace-state.json) — 1.2.9+
        if (
          entry.name.startsWith(".") &&
          entry.name !== ".claude" &&
          entry.name !== ".coc-backup" &&
          entry.name !== ".openclaw"
        ) continue
        await walk(fullPath)
      } else if (entry.isFile()) {
        // File-name denylist (1.2.10+): operator audit copies (*.bak,
        // *.pre-*, *.rejected.<ts>, *.last-good, stale-*-backup.tar.gz)
        // never enter the manifest, even if a future FILE_RULE would
        // otherwise match a similarly-named file.
        if (shouldSkipFileByName(entry.name)) continue
        const relPath = relative(baseDir, fullPath)
        const classification = classifyFile(relPath)
        if (!classification) continue

        // Check if category is enabled
        const catKey = classification.category as keyof typeof config.categories
        if (config.categories[catKey] === false) continue

        const fileStat = await stat(fullPath)
        if (fileStat.size > MAX_FILE_BYTES) continue
        const content = await readFile(fullPath)
        const hash = sha256Hex(content)

        // Memory encryption override
        const shouldEncrypt = classification.encrypt ||
          (classification.category === "memory" && config.encryptMemory)

        files.push({
          relativePath: relPath,
          absolutePath: fullPath,
          hash,
          sizeBytes: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          encrypted: shouldEncrypt,
          category: classification.category,
        })
      }
    }
  }

  await walk(baseDir)
  return files
}

/** Detect changes between current files and previous manifest */
export async function detectChanges(
  baseDir: string,
  config: CocBackupConfig,
  previousManifest: SnapshotManifest | null,
): Promise<ChangeSet> {
  const currentFiles = await scanFiles(baseDir, config)

  if (!previousManifest) {
    // No previous backup — everything is new
    return {
      added: currentFiles,
      modified: [],
      deleted: [],
      unchanged: [],
    }
  }

  const prevFiles = previousManifest.files
  const prevPaths = new Set(Object.keys(prevFiles))

  const added: FileState[] = []
  const modified: FileState[] = []
  const unchanged: FileState[] = []

  for (const file of currentFiles) {
    const prev = prevFiles[file.relativePath]
    if (!prev) {
      added.push(file)
    } else if (prev.hash !== file.hash) {
      modified.push(file)
    } else {
      unchanged.push(file)
    }
    prevPaths.delete(file.relativePath)
  }

  // Remaining paths in prevPaths were deleted
  const deleted = [...prevPaths]

  return { added, modified, deleted, unchanged }
}
