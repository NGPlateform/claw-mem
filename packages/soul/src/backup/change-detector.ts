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
const FILE_RULES: Array<{ pattern: RegExp; category: FileCategory; encrypt: boolean }> = [
  // Identity-level markdown files (root-level OR under workspace/)
  { pattern: /^(workspace\/)?IDENTITY\.md$/, category: "identity", encrypt: false },
  { pattern: /^(workspace\/)?SOUL\.md$/, category: "identity", encrypt: false },
  // Identity / config files at fixed locations
  { pattern: /^identity\/device\.json$/, category: "config", encrypt: true },
  { pattern: /^auth\.json$/, category: "config", encrypt: true },
  // Memory markdown files (root-level OR under workspace/)
  { pattern: /^(workspace\/)?MEMORY\.md$/, category: "memory", encrypt: false },
  { pattern: /^(workspace\/)?USER\.md$/, category: "memory", encrypt: false },
  { pattern: /^memory\/.*\.md$/, category: "memory", encrypt: false },
  // Recovery context (generated on restore for agent context injection)
  { pattern: /^(workspace\/)?RECOVERY_CONTEXT\.md$/, category: "memory", encrypt: false },
  // Workspace markdown / state
  { pattern: /^(workspace\/)?AGENTS\.md$/, category: "workspace", encrypt: false },
  { pattern: /^workspace-state\.json$/, category: "workspace", encrypt: false },
  // Chat sessions
  { pattern: /^agents\/.*\/sessions\/.*\.jsonl$/, category: "chat", encrypt: false },
  { pattern: /^agents\/.*\/sessions\/sessions\.json$/, category: "chat", encrypt: false },
  // Database files (SQLite memory index, LanceDB vector store)
  { pattern: /^memory\/[^/]+\.sqlite$/, category: "database", encrypt: true },
  { pattern: /^memory\/lancedb\/.*/, category: "database", encrypt: true },
  // OpenClaw config and plugin manifests
  { pattern: /^openclaw\.json$/, category: "config", encrypt: true },
  { pattern: /^plugins\/.*\/openclaw\.plugin\.json$/, category: "config", encrypt: false },
  // Credentials
  { pattern: /^credentials\/.*/, category: "config", encrypt: true },
  // Context snapshot
  { pattern: /^\.coc-backup\/context-snapshot\.json$/, category: "workspace", encrypt: false },
  // Semantic snapshot (claw-mem observations + summaries)
  { pattern: /^\.coc-backup\/semantic-snapshot\.json$/, category: "memory", encrypt: false },
]

function classifyFile(relativePath: string): { category: FileCategory; encrypt: boolean } | null {
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
        // Skip hidden dirs except .claude
        if (entry.name.startsWith(".") && entry.name !== ".claude" && entry.name !== ".coc-backup") continue
        await walk(fullPath)
      } else if (entry.isFile()) {
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
