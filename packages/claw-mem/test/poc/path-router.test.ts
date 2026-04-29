import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathFor, parseFromPath, getPocRoot } from "../../src/poc/path-router.ts"

let tmpRoot: string
let prevEnv: string | undefined

before(async () => {
  prevEnv = process.env.CLAW_MEM_POC_ROOT
  tmpRoot = await mkdtemp(join(tmpdir(), "claw-mem-poc-router-"))
  process.env.CLAW_MEM_POC_ROOT = tmpRoot
})

after(async () => {
  if (prevEnv === undefined) {
    delete process.env.CLAW_MEM_POC_ROOT
  } else {
    process.env.CLAW_MEM_POC_ROOT = prevEnv
  }
  await rm(tmpRoot, { recursive: true, force: true })
})

describe("path-router: pathFor", () => {
  it("kind=soul returns _global/SOUL.md", () => {
    const p = pathFor({ kind: "soul" })
    assert.equal(p, join(tmpRoot, "memories", "_global", "SOUL.md"))
  })

  it("kind=agents returns _global/AGENTS.md", () => {
    const p = pathFor({ kind: "agents" })
    assert.equal(p, join(tmpRoot, "memories", "_global", "AGENTS.md"))
  })

  it("kind=memory + channel only → channel-level MEMORY.md", () => {
    const p = pathFor({ kind: "memory", channel: "mock-tg" })
    assert.equal(p, join(tmpRoot, "memories", "channels", "mock-tg", "MEMORY.md"))
  })

  it("kind=memory + channel + user → per-user MEMORY.md", () => {
    const p = pathFor({ kind: "memory", channel: "mock-tg", user: "A" })
    assert.equal(
      p,
      join(tmpRoot, "memories", "channels", "mock-tg", "users", "A", "MEMORY.md"),
    )
  })

  it("kind=user requires channel + user", () => {
    const p = pathFor({ kind: "user", channel: "mock-slack", user: "U456" })
    assert.equal(
      p,
      join(tmpRoot, "memories", "channels", "mock-slack", "users", "U456", "USER.md"),
    )
  })

  it("kind=soul rejects channel/user", () => {
    assert.throws(() => pathFor({ kind: "soul", channel: "mock-tg" }))
    assert.throws(() => pathFor({ kind: "soul", user: "A" }))
  })

  it("kind=memory without channel throws", () => {
    assert.throws(() => pathFor({ kind: "memory" }))
  })

  it("kind=user without channel or user throws", () => {
    assert.throws(() => pathFor({ kind: "user", channel: "mock-tg" }))
    assert.throws(() => pathFor({ kind: "user", user: "A" }))
  })

  it("rejects path traversal in channel", () => {
    assert.throws(() => pathFor({ kind: "memory", channel: "../escape" }))
    assert.throws(() => pathFor({ kind: "memory", channel: "a/b" }))
    assert.throws(() => pathFor({ kind: "memory", channel: ".." }))
  })

  it("rejects path traversal in user", () => {
    assert.throws(() => pathFor({ kind: "user", channel: "ok", user: "../boom" }))
    assert.throws(() => pathFor({ kind: "user", channel: "ok", user: "a/b" }))
    assert.throws(() => pathFor({ kind: "memory", channel: "ok", user: "" }))
  })

  it("accepts safe characters: alnum, dot, underscore, hyphen", () => {
    assert.doesNotThrow(() =>
      pathFor({ kind: "memory", channel: "tg.bot-1", user: "user_42" }),
    )
    assert.doesNotThrow(() =>
      pathFor({ kind: "memory", channel: "slack-2026", user: "U.A.123" }),
    )
  })

  it("rejects spaces in segments", () => {
    assert.throws(() => pathFor({ kind: "memory", channel: "with space" }))
  })
})

describe("path-router: parseFromPath", () => {
  it("roundtrips kind=soul", () => {
    const p = pathFor({ kind: "soul" })
    assert.deepEqual(parseFromPath(p), { kind: "soul" })
  })

  it("roundtrips kind=agents", () => {
    const p = pathFor({ kind: "agents" })
    assert.deepEqual(parseFromPath(p), { kind: "agents" })
  })

  it("roundtrips kind=memory channel-level", () => {
    const p = pathFor({ kind: "memory", channel: "mock-tg" })
    assert.deepEqual(parseFromPath(p), { kind: "memory", channel: "mock-tg" })
  })

  it("roundtrips kind=memory + user", () => {
    const p = pathFor({ kind: "memory", channel: "mock-tg", user: "A" })
    assert.deepEqual(parseFromPath(p), {
      kind: "memory",
      channel: "mock-tg",
      user: "A",
    })
  })

  it("roundtrips kind=user", () => {
    const p = pathFor({ kind: "user", channel: "mock-slack", user: "U456" })
    assert.deepEqual(parseFromPath(p), {
      kind: "user",
      channel: "mock-slack",
      user: "U456",
    })
  })

  it("rejects paths outside the PoC root", () => {
    assert.equal(parseFromPath("/etc/passwd"), null)
    assert.equal(parseFromPath(join(tmpRoot, "../something/else")), null)
  })

  it("rejects unknown filenames inside the layout", () => {
    const fake = join(tmpRoot, "memories", "_global", "OTHER.md")
    assert.equal(parseFromPath(fake), null)
  })

  it("rejects relative paths", () => {
    assert.equal(parseFromPath("memories/_global/SOUL.md"), null)
  })

  it("rejects malformed channel/user segments", () => {
    const evil = join(
      tmpRoot,
      "memories",
      "channels",
      "with space",
      "MEMORY.md",
    )
    assert.equal(parseFromPath(evil), null)
  })
})

describe("path-router: getPocRoot", () => {
  it("uses CLAW_MEM_POC_ROOT env when set", () => {
    assert.equal(getPocRoot(), tmpRoot)
  })
})
