import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  listChannels,
  listUsersOfChannel,
  renderOverview,
  renderChannel,
  renderUser,
} from "../../src/poc/cli-dashboard.ts"

let root: string

before(async () => {
  root = await mkdtemp(join(tmpdir(), "claw-mem-poc-cli-"))

  // Synthetic fixture: 2 channels × 2 users each, 3 facts each.
  await mkdir(join(root, "memories", "_global"), { recursive: true })
  await writeFile(join(root, "memories", "_global", "SOUL.md"), "# Soul\n- tone: terse\n")

  for (const channel of ["telegram", "slack"]) {
    for (const user of ["user-a", "user-b"]) {
      const dir = join(root, "memories", "channels", channel, "users", user)
      await mkdir(dir, { recursive: true })
      const facts = [
        `- 2026-04-29T10:00 user said: hello from ${channel}/${user}`,
        `- 2026-04-29T10:01 user said: I prefer X`,
        `- 2026-04-29T10:02 user said: byebye`,
      ].join("\n")
      await writeFile(join(dir, "MEMORY.md"), `# MEMORY for ${channel} / ${user}\n\n${facts}\n`)
      // Add USER.md only for user-a to test mixed presence.
      if (user === "user-a") {
        await writeFile(join(dir, "USER.md"), `# Profile for ${user}\n- tz: UTC+8\n`)
      }
    }
  }
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

// ──────────────────────────────────────────────────────────────────────────
// Pure data inspection
// ──────────────────────────────────────────────────────────────────────────

describe("cli-dashboard: listChannels", () => {
  it("returns all channels with correct user/fact counts", async () => {
    const channels = await listChannels(root)
    assert.equal(channels.length, 2)
    const slack = channels.find((c) => c.name === "slack")
    const telegram = channels.find((c) => c.name === "telegram")
    assert.ok(slack && telegram)
    for (const ch of channels) {
      assert.equal(ch.userCount, 2)
      assert.equal(ch.factCount, 6, `${ch.name} should have 2 users × 3 facts = 6`)
    }
  })

  it("returns empty list for non-existent root", async () => {
    const channels = await listChannels("/tmp/does-not-exist-claw-mem-poc-zzz")
    assert.deepEqual(channels, [])
  })
})

describe("cli-dashboard: listUsersOfChannel", () => {
  it("returns all users with their stats", async () => {
    const users = await listUsersOfChannel(root, "telegram")
    assert.equal(users.length, 2)
    const a = users.find((u) => u.user === "user-a")
    const b = users.find((u) => u.user === "user-b")
    assert.ok(a && b)
    assert.equal(a!.factCount, 3)
    assert.equal(a!.hasUserMd, true)
    assert.equal(b!.hasUserMd, false)
    assert.ok(typeof a!.lastModifiedMs === "number" && a!.lastModifiedMs > 0)
  })

  it("returns empty list for unknown channel", async () => {
    const users = await listUsersOfChannel(root, "discord")
    assert.deepEqual(users, [])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Renderers — content checks (we don't snapshot exact strings to stay flexible)
// ──────────────────────────────────────────────────────────────────────────

describe("cli-dashboard: renderOverview", () => {
  it("includes total counts and each channel name", async () => {
    const out = await renderOverview(root, { colors: false })
    // Title and root
    assert.match(out, /claw-mem PoC dashboard/)
    assert.match(out, /root:/)
    // Aggregate stats
    assert.match(out, /Channels:.*2/)
    assert.match(out, /Users:.*4/)
    assert.match(out, /Facts:.*12/)
    // Each channel listed with right user/fact count
    assert.match(out, /telegram\s+2\s+6/)
    assert.match(out, /slack\s+2\s+6/)
  })

  it("emits no ANSI escape codes when colors=false", async () => {
    const out = await renderOverview(root, { colors: false })
    // eslint-disable-next-line no-control-regex
    assert.equal(/\x1b\[/.test(out), false)
  })

  it("emits ANSI escape codes when colors=true", async () => {
    const out = await renderOverview(root, { colors: true })
    // eslint-disable-next-line no-control-regex
    assert.equal(/\x1b\[/.test(out), true)
  })

  it("shows a friendly empty state for a fresh root", async () => {
    const empty = await mkdtemp(join(tmpdir(), "claw-mem-poc-empty-"))
    try {
      const out = await renderOverview(empty, { colors: false })
      assert.match(out, /No channels yet/)
      assert.match(out, /Channels:.*0/)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})

describe("cli-dashboard: renderChannel", () => {
  it("lists users with fact counts and USER.md presence", async () => {
    const out = await renderChannel(root, "telegram", { colors: false })
    assert.match(out, /Channel: telegram/)
    assert.match(out, /2 users/)
    assert.match(out, /user-a\s+3\s+yes/)
    assert.match(out, /user-b\s+3\s+no/)
  })

  it("warns helpfully for an unknown channel", async () => {
    const out = await renderChannel(root, "discord", { colors: false })
    assert.match(out, /No users for channel 'discord'/)
  })
})

describe("cli-dashboard: renderUser", () => {
  it("renders both USER.md and MEMORY.md when both exist", async () => {
    const out = await renderUser(root, "telegram", "user-a", { colors: false })
    assert.match(out, /User: telegram\/user-a/)
    assert.match(out, /USER\.md/)
    assert.match(out, /Profile for user-a/)
    assert.match(out, /tz: UTC\+8/)
    assert.match(out, /MEMORY\.md/)
    assert.match(out, /hello from telegram\/user-a/)
  })

  it("notes missing USER.md but shows MEMORY.md when only MEMORY exists", async () => {
    const out = await renderUser(root, "telegram", "user-b", { colors: false })
    assert.match(out, /\(no USER\.md\)/)
    assert.match(out, /MEMORY\.md/)
    assert.match(out, /hello from telegram\/user-b/)
  })

  it("explicitly indicates a user with no markdown at all", async () => {
    const out = await renderUser(root, "telegram", "ghost-user", { colors: false })
    assert.match(out, /\(no MEMORY\.md/)
  })
})
