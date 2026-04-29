// PoC markdown store: minimal read/write/list with atomic writes.
// Zero deps — node:fs/promises only. Atomic writes via tmpfile + rename
// guard against partial writes if the process dies mid-write.

import { readFile, writeFile, mkdir, rename, readdir, stat } from "node:fs/promises"
import { dirname, join, sep } from "node:path"
import { randomBytes } from "node:crypto"

export async function read(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8")
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") return null
    throw err
  }
}

export async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  // Atomic publish: write to a tempfile in the same directory, then rename.
  // Rename is atomic on POSIX when source/dest are on the same filesystem.
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`
  try {
    await writeFile(tmp, content, { encoding: "utf-8", flag: "w" })
    await rename(tmp, path)
  } catch (err) {
    // Best-effort cleanup of the tempfile on error.
    try {
      const { unlink } = await import("node:fs/promises")
      await unlink(tmp)
    } catch {
      // ignore — tempfile may not exist if writeFile failed before creating it
    }
    throw err
  }
}

/**
 * Walk a directory tree and return absolute paths of files whose relative path
 * (from `prefix`) matches the optional filter. Returns an empty array if
 * `prefix` does not exist.
 */
export async function list(prefix: string, filter?: (relPath: string) => boolean): Promise<string[]> {
  const found: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "ENOENT") return
      throw err
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (filter) {
        const rel = full.startsWith(prefix + sep) ? full.slice(prefix.length + 1) : full
        if (!filter(rel)) continue
      }
      found.push(full)
    }
  }

  await walk(prefix)
  return found
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
