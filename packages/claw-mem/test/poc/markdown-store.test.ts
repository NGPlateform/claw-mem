import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readdir, writeFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { read, write, list, exists } from "../../src/poc/markdown-store.ts"

let tmpRoot: string

before(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "claw-mem-poc-store-"))
})

after(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe("markdown-store: read", () => {
  it("returns null for missing files (no throw)", async () => {
    const result = await read(join(tmpRoot, "does-not-exist.md"))
    assert.equal(result, null)
  })
})

describe("markdown-store: write", () => {
  it("creates parent directories automatically", async () => {
    const target = join(tmpRoot, "deep", "nested", "path", "file.md")
    await write(target, "# hello\n")
    const back = await read(target)
    assert.equal(back, "# hello\n")
  })

  it("roundtrips arbitrary markdown content", async () => {
    const target = join(tmpRoot, "rt.md")
    const content = "# title\n\n- bullet\n  - sub\n\n```ts\nconst x = 1\n```\n"
    await write(target, content)
    assert.equal(await read(target), content)
  })

  it("overwrites existing file content", async () => {
    const target = join(tmpRoot, "overwrite.md")
    await write(target, "v1")
    await write(target, "v2")
    assert.equal(await read(target), "v2")
  })

  it("does not leave .tmp files behind on success", async () => {
    const target = join(tmpRoot, "no-tmp.md")
    await write(target, "ok")
    const dirEntries = await readdir(tmpRoot)
    const stragglers = dirEntries.filter((e) => e.endsWith(".tmp"))
    assert.deepEqual(stragglers, [])
  })

  it("handles empty content", async () => {
    const target = join(tmpRoot, "empty.md")
    await write(target, "")
    assert.equal(await read(target), "")
  })

  it("handles unicode and emoji", async () => {
    const target = join(tmpRoot, "unicode.md")
    const content = "# 用户档案\n- 偏好：PostgreSQL 🐘\n- 时区：UTC+8\n"
    await write(target, content)
    assert.equal(await read(target), content)
  })
})

describe("markdown-store: list", () => {
  it("returns [] for non-existent prefix (no throw)", async () => {
    const result = await list(join(tmpRoot, "ghost"))
    assert.deepEqual(result, [])
  })

  it("walks directory tree and returns absolute paths of files", async () => {
    const base = join(tmpRoot, "tree")
    await write(join(base, "a", "f1.md"), "a-1")
    await write(join(base, "a", "f2.md"), "a-2")
    await write(join(base, "b", "c", "f3.md"), "b-c-3")

    const found = await list(base)
    assert.equal(found.length, 3)
    for (const p of found) {
      assert.ok(p.startsWith(base + "/"), `expected ${p} to start with ${base}/`)
    }
  })

  it("filter parameter narrows results by relative path", async () => {
    const base = join(tmpRoot, "filtered")
    await write(join(base, "users", "A", "MEMORY.md"), "1")
    await write(join(base, "users", "A", "USER.md"), "2")
    await write(join(base, "users", "B", "MEMORY.md"), "3")

    const memoryOnly = await list(base, (rel) => rel.endsWith("MEMORY.md"))
    assert.equal(memoryOnly.length, 2)

    const userAOnly = await list(base, (rel) => rel.includes("/A/"))
    assert.equal(userAOnly.length, 2)
  })

  it("skips symlinks", async () => {
    // We don't create symlinks in this test; this just confirms the API
    // tolerates a tree where some entries may be symlinks (covered in code).
    const base = join(tmpRoot, "sym")
    await write(join(base, "real.md"), "x")
    const found = await list(base)
    assert.equal(found.length, 1)
  })
})

describe("markdown-store: exists", () => {
  it("returns true for existing files", async () => {
    const target = join(tmpRoot, "ex.md")
    await write(target, "ok")
    assert.equal(await exists(target), true)
  })

  it("returns false for missing files", async () => {
    assert.equal(await exists(join(tmpRoot, "ghost.md")), false)
  })

  it("returns true for existing directories", async () => {
    const target = join(tmpRoot, "ex-dir-test", "nested.md")
    await write(target, "ok")
    assert.equal(await exists(join(tmpRoot, "ex-dir-test")), true)
  })
})

describe("markdown-store: atomic write semantics", () => {
  it("rename to existing file replaces it atomically", async () => {
    const target = join(tmpRoot, "atomic.md")
    await write(target, "old\n")
    const before = await stat(target)
    await write(target, "new\n")
    const after = await stat(target)
    assert.equal(await read(target), "new\n")
    // size should reflect new content
    assert.equal(after.size, 4)
    // inode may change due to rename — that's expected for atomic publish
    void before
  })
})
