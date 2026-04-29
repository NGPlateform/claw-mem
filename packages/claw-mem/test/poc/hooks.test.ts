import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ClawMemConfigSchema } from "../../src/config.ts"
import { createPocHookHandlers, registerPocHooks } from "../../src/poc/hooks.ts"
import { pathFor } from "../../src/poc/path-router.ts"
import { read } from "../../src/poc/markdown-store.ts"

let tmpRoot: string
let prevEnv: string | undefined

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

function buildConfig(overrides: Partial<{ enabled: boolean; fallbackChannel: string; fallbackUser: string }> = {}) {
  return ClawMemConfigSchema.parse({
    poc: {
      enabled: overrides.enabled ?? true,
      fallbackChannel: overrides.fallbackChannel ?? "default",
      fallbackUser: overrides.fallbackUser ?? "default",
    },
  })
}

beforeEach(async () => {
  prevEnv = process.env.CLAW_MEM_POC_ROOT
  tmpRoot = await mkdtemp(join(tmpdir(), "claw-mem-poc-hooks-"))
  process.env.CLAW_MEM_POC_ROOT = tmpRoot
})

afterEach(async () => {
  if (prevEnv === undefined) {
    delete process.env.CLAW_MEM_POC_ROOT
  } else {
    process.env.CLAW_MEM_POC_ROOT = prevEnv
  }
  await rm(tmpRoot, { recursive: true, force: true })
})

// ──────────────────────────────────────────────────────────────────────────
// registerPocHooks gating
// ──────────────────────────────────────────────────────────────────────────

describe("registerPocHooks: gating", () => {
  it("does nothing when poc.enabled = false", () => {
    const calls: Array<{ name: string }> = []
    const fakeApi: any = {
      logger: silentLogger,
      registerTool: () => {},
      on: (name: string) => calls.push({ name }),
    }
    registerPocHooks(fakeApi, buildConfig({ enabled: false }), silentLogger)
    assert.equal(calls.length, 0)
  })

  it("registers 3 hooks via api.on when poc.enabled = true", () => {
    const calls: Array<{ name: string; priority?: number }> = []
    const fakeApi: any = {
      logger: silentLogger,
      registerTool: () => {},
      on: (name: string, _h: unknown, opts?: { priority?: number }) =>
        calls.push({ name, priority: opts?.priority }),
    }
    registerPocHooks(fakeApi, buildConfig({ enabled: true }), silentLogger)
    const names = calls.map((c) => c.name).sort()
    assert.deepEqual(names, ["before_prompt_build", "message_received", "message_sent"])
    const promptHook = calls.find((c) => c.name === "before_prompt_build")
    assert.equal(promptHook?.priority, 40)
  })

  it("falls back to api.registerHook when api.on not available", () => {
    const calls: string[] = []
    const fakeApi: any = {
      logger: silentLogger,
      registerTool: () => {},
      registerHook: (name: string) => calls.push(name),
    }
    registerPocHooks(fakeApi, buildConfig({ enabled: true }), silentLogger)
    assert.deepEqual(calls.sort(), ["before_prompt_build", "message_received", "message_sent"])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// message_received → cache + append
// ──────────────────────────────────────────────────────────────────────────

describe("PoC hooks: message_received", () => {
  it("appends user message to per-(channel,user) MEMORY.md", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    const outcome = await handlers.onMessageReceived(
      { from: "Bao", content: "I prefer PostgreSQL" },
      { channelId: "telegram", senderId: "123" },
    )
    assert.equal(outcome.acted, true)
    assert.deepEqual(outcome.route, { channel: "telegram", user: "123" })

    const written = await read(pathFor({ kind: "memory", channel: "telegram", user: "123" }))
    assert.ok(written, "MEMORY.md should exist after message_received")
    assert.match(written!, /# MEMORY for telegram \/ 123/)
    assert.match(written!, /user said: I prefer PostgreSQL/)
  })

  it("caches the route by agentId for later before_prompt_build lookup", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    await handlers.onMessageReceived(
      { content: "hello" },
      { channelId: "slack", senderId: "U456", agentId: "agent-1" } as any,
    )
    const cached = handlers._getCachedRoute("agent-1")
    assert.ok(cached)
    assert.equal(cached!.channel, "slack")
    assert.equal(cached!.user, "U456")
  })

  it("uses fallback channel/user when ctx is missing them", async () => {
    const handlers = createPocHookHandlers(
      buildConfig({ fallbackChannel: "fallback-ch", fallbackUser: "anonymous" }),
      silentLogger,
    )
    const outcome = await handlers.onMessageReceived(
      { content: "hi" },
      // ctx with no senderId; channelId required by type but try empty
      { channelId: "" } as any,
    )
    assert.equal(outcome.route?.channel, "fallback-ch")
    assert.equal(outcome.route?.user, "anonymous")
  })

  it("rejects unsafe channel names by falling back", async () => {
    const handlers = createPocHookHandlers(
      buildConfig({ fallbackChannel: "safe-default" }),
      silentLogger,
    )
    const outcome = await handlers.onMessageReceived(
      { content: "x" },
      { channelId: "../escape", senderId: "ok" } as any,
    )
    assert.equal(outcome.route?.channel, "safe-default")
  })

  it("does not write when message body is empty", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    const outcome = await handlers.onMessageReceived(
      { content: "   " },
      { channelId: "telegram", senderId: "A" },
    )
    assert.equal(outcome.acted, false)
    const written = await read(pathFor({ kind: "memory", channel: "telegram", user: "A" }))
    assert.equal(written, null)
  })

  it("two users on same channel get separate files (Q2: no cross-pollution)", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    await handlers.onMessageReceived(
      { content: "A's message" },
      { channelId: "telegram", senderId: "A" },
    )
    await handlers.onMessageReceived(
      { content: "B's message" },
      { channelId: "telegram", senderId: "B" },
    )

    const aMemory = await read(pathFor({ kind: "memory", channel: "telegram", user: "A" }))
    const bMemory = await read(pathFor({ kind: "memory", channel: "telegram", user: "B" }))

    assert.ok(aMemory)
    assert.ok(bMemory)
    assert.match(aMemory!, /A's message/)
    assert.doesNotMatch(aMemory!, /B's message/)
    assert.match(bMemory!, /B's message/)
    assert.doesNotMatch(bMemory!, /A's message/)
  })

  it("same user on different channels gets separate files (Q2)", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    await handlers.onMessageReceived(
      { content: "via TG" },
      { channelId: "telegram", senderId: "X" },
    )
    await handlers.onMessageReceived(
      { content: "via Slack" },
      { channelId: "slack", senderId: "X" },
    )

    const tg = await read(pathFor({ kind: "memory", channel: "telegram", user: "X" }))
    const slack = await read(pathFor({ kind: "memory", channel: "slack", user: "X" }))

    assert.match(tg!, /via TG/)
    assert.doesNotMatch(tg!, /via Slack/)
    assert.match(slack!, /via Slack/)
    assert.doesNotMatch(slack!, /via TG/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// before_prompt_build → inject markdown
// ──────────────────────────────────────────────────────────────────────────

describe("PoC hooks: before_prompt_build", () => {
  it("returns no context when there is no markdown to inject", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    const outcome = await handlers.onBeforePromptBuild(
      { prompt: "hello" },
      { agentId: "agent-1", channelId: "telegram" },
    )
    assert.equal(outcome.acted, false)
    assert.equal(outcome.prependContext, undefined)
  })

  it("uses cached route from prior message_received", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    // 1) record a message so route gets cached for agent-1
    await handlers.onMessageReceived(
      { content: "I like Python" },
      { channelId: "telegram", senderId: "user-A", agentId: "agent-1" } as any,
    )
    // 2) now prompt build for the same agent — should pick up user-A's MEMORY.md
    const outcome = await handlers.onBeforePromptBuild(
      { prompt: "..." },
      { agentId: "agent-1", channelId: "telegram" },
    )
    assert.equal(outcome.acted, true)
    assert.equal(outcome.route?.channel, "telegram")
    assert.equal(outcome.route?.user, "user-A")
    assert.match(outcome.prependContext!, /I like Python/)
    assert.match(outcome.prependContext!, /claw-mem\/poc:memory\(telegram\/user-A\)/)
  })

  it("injects SOUL.md as global preamble when present", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    // pre-populate SOUL.md and a per-user MEMORY.md
    const soulPath = pathFor({ kind: "soul" })
    await mkdir(join(tmpRoot, "memories", "_global"), { recursive: true })
    await writeFile(soulPath, "# Soul\n- tone: concise\n", "utf-8")

    await handlers.onMessageReceived(
      { content: "hello" },
      { channelId: "tg", senderId: "U", agentId: "agent-2" } as any,
    )
    const outcome = await handlers.onBeforePromptBuild(
      { prompt: "..." },
      { agentId: "agent-2", channelId: "tg" },
    )
    assert.match(outcome.prependContext!, /tone: concise/)
    assert.match(outcome.prependContext!, /claw-mem\/poc:soul/)
  })

  it("injects USER.md when present", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    const userPath = pathFor({ kind: "user", channel: "tg", user: "U" })
    await mkdir(join(tmpRoot, "memories", "channels", "tg", "users", "U"), {
      recursive: true,
    })
    await writeFile(userPath, "# User Profile\n- timezone: UTC+8\n", "utf-8")

    await handlers.onMessageReceived(
      { content: "hi" },
      { channelId: "tg", senderId: "U", agentId: "agent-3" } as any,
    )
    const outcome = await handlers.onBeforePromptBuild(
      { prompt: "" },
      { agentId: "agent-3", channelId: "tg" },
    )
    assert.match(outcome.prependContext!, /timezone: UTC\+8/)
    assert.match(outcome.prependContext!, /claw-mem\/poc:user\(tg\/U\)/)
  })

  it("returns disjoint markdown for different agents on different channels (Q2)", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    await handlers.onMessageReceived(
      { content: "A on tg" },
      { channelId: "tg", senderId: "A", agentId: "agent-tg" } as any,
    )
    await handlers.onMessageReceived(
      { content: "B on slack" },
      { channelId: "slack", senderId: "B", agentId: "agent-slack" } as any,
    )

    const tgOutcome = await handlers.onBeforePromptBuild(
      { prompt: "" },
      { agentId: "agent-tg", channelId: "tg" },
    )
    const slackOutcome = await handlers.onBeforePromptBuild(
      { prompt: "" },
      { agentId: "agent-slack", channelId: "slack" },
    )

    assert.match(tgOutcome.prependContext!, /A on tg/)
    assert.doesNotMatch(tgOutcome.prependContext!, /B on slack/)
    assert.match(slackOutcome.prependContext!, /B on slack/)
    assert.doesNotMatch(slackOutcome.prependContext!, /A on tg/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// message_sent → assistant capture
// ──────────────────────────────────────────────────────────────────────────

describe("PoC hooks: message_sent", () => {
  it("appends agent reply to the same per-user MEMORY.md as user input", async () => {
    const handlers = createPocHookHandlers(buildConfig(), silentLogger)
    await handlers.onMessageReceived(
      { content: "what's the weather?" },
      { channelId: "discord", senderId: "user-A" },
    )
    await handlers.onMessageSent(
      { content: "I don't know yet — looking it up" },
      { channelId: "discord", senderId: "user-A" },
    )

    const written = await read(pathFor({ kind: "memory", channel: "discord", user: "user-A" }))
    assert.match(written!, /user said: what's the weather/)
    assert.match(written!, /agent said: I don't know yet/)
  })
})
