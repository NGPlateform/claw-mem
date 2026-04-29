// PoC hook handlers — multi-channel / multi-user markdown memory.
//
// Uses OpenClaw's real `(event, ctx)` two-arg hook signature. The existing
// claw-mem hooks declare only `(event)` and silently drop `ctx`; this file
// proves we can pick up channelId / senderId from `ctx` and route per
// (channel, user) into separate markdown files. PoC only — gated behind
// config.poc.enabled. Coexists with the existing SQLite pipeline.

import type { ClawMemConfig } from "../config.ts"
import type { PluginApi, PluginLogger } from "../types.ts"
import { read, write } from "./markdown-store.ts"
import { pathFor } from "./path-router.ts"

// Minimal local mirrors of OpenClaw's plugin context types. We don't import
// from @openclaw/openclaw because claw-mem isn't a build-time dep of the
// gateway — these types must be tolerated as unknown shapes at runtime.

interface PocAgentCtx {
  agentId?: string
  channelId?: string
  messageProvider?: string
  sessionKey?: string
  sessionId?: string
}

interface PocMessageCtx {
  channelId: string
  senderId?: string
  conversationId?: string
  accountId?: string
  sessionKey?: string
  runId?: string
  messageId?: string
}

interface PocMessageEvent {
  from?: string
  content?: string
  text?: string
  metadata?: Record<string, unknown>
}

interface PocPromptBuildEvent {
  prompt?: string
  messages?: unknown[]
}

// PoC routing key cached per agent so that hooks without a senderId in ctx
// (e.g. before_prompt_build) can still route to the correct user file.
interface PocRoute {
  channel: string
  user: string
  lastMessageContent?: string
  lastSeenAt: number
}

export interface PocHookOutcome {
  /** Did the PoC handler do something? Useful for tests/logs. */
  acted: boolean
  /** What was the routed (channel, user) for the call? */
  route?: { channel: string; user: string }
  /** Markdown that was injected into the system prompt (before_prompt_build). */
  prependContext?: string
}

/**
 * Build a function that, given (channelId, senderId), normalizes them into
 * a (channel, user) route — collapses missing fields to fallbacks from
 * config.poc.{fallbackChannel,fallbackUser} and applies the same path-router
 * charset constraints to keep filesystem layout stable.
 */
function makeRouter(config: ClawMemConfig) {
  const fallbackChannel = config.poc.fallbackChannel || "default"
  const fallbackUser = config.poc.fallbackUser || "default"
  const SAFE = /^[a-zA-Z0-9._-]{1,64}$/
  const RESERVED = new Set([".", "..", "_global"])
  const sanitize = (raw: string | undefined, fallback: string): string => {
    if (!raw) return fallback
    if (!SAFE.test(raw)) return fallback
    if (RESERVED.has(raw)) return fallback
    return raw
  }
  return (channelId: string | undefined, senderId: string | undefined) => ({
    channel: sanitize(channelId, fallbackChannel),
    user: sanitize(senderId, fallbackUser),
  })
}

export function createPocHookHandlers(config: ClawMemConfig, logger: PluginLogger) {
  const route = makeRouter(config)
  // Per-agent route cache: when before_prompt_build fires it has agentId +
  // channelId in ctx but NO senderId. We cache the last (channel, user) seen
  // for that agent's most recent message so we can route the prompt build
  // to the right user file. Map keyed by agentId.
  const lastRouteByAgent = new Map<string, PocRoute>()

  function logRoute(prefix: string, agentId: string | undefined, r: { channel: string; user: string }) {
    logger.info(
      `[claw-mem/poc] ${prefix} agent=${agentId ?? "(unknown)"} ` +
        `channel=${r.channel} user=${r.user}`,
    )
  }

  // ──────────────────────────────────────────────────────
  // message_received(event, ctx) — cache route + append to MEMORY.md
  // ──────────────────────────────────────────────────────
  async function onMessageReceived(
    event: PocMessageEvent,
    ctx: PocMessageCtx,
  ): Promise<PocHookOutcome> {
    const r = route(ctx.channelId, ctx.senderId)
    const text = (event?.content ?? event?.text ?? "").trim()
    const agentId = (ctx as { agentId?: string }).agentId
    lastRouteByAgent.set(agentId ?? "default", {
      ...r,
      lastMessageContent: text,
      lastSeenAt: Date.now(),
    })

    if (!text) return { acted: false, route: r }

    const memoryPath = pathFor({ kind: "memory", channel: r.channel, user: r.user })
    const existing = (await read(memoryPath)) ?? ""
    const stamp = new Date().toISOString()
    const line = `- ${stamp} user said: ${oneLine(text, 500)}\n`
    const next = existing.length === 0
      ? `# MEMORY for ${r.channel} / ${r.user}\n\n${line}`
      : existing.endsWith("\n")
        ? existing + line
        : existing + "\n" + line
    await write(memoryPath, next)
    logRoute("message_received", agentId, r)
    return { acted: true, route: r }
  }

  // ──────────────────────────────────────────────────────
  // message_sent(event, ctx) — append assistant reply (optional)
  // ──────────────────────────────────────────────────────
  async function onMessageSent(
    event: PocMessageEvent,
    ctx: PocMessageCtx,
  ): Promise<PocHookOutcome> {
    const r = route(ctx.channelId, ctx.senderId)
    const text = (event?.content ?? event?.text ?? "").trim()
    if (!text) return { acted: false, route: r }
    const memoryPath = pathFor({ kind: "memory", channel: r.channel, user: r.user })
    const existing = (await read(memoryPath)) ?? ""
    const stamp = new Date().toISOString()
    const line = `- ${stamp} agent said: ${oneLine(text, 500)}\n`
    const next = existing.length === 0
      ? `# MEMORY for ${r.channel} / ${r.user}\n\n${line}`
      : existing.endsWith("\n")
        ? existing + line
        : existing + "\n" + line
    await write(memoryPath, next)
    logRoute("message_sent", undefined, r)
    return { acted: true, route: r }
  }

  // ──────────────────────────────────────────────────────
  // before_prompt_build(event, ctx) — inject SOUL + USER + MEMORY
  // ──────────────────────────────────────────────────────
  async function onBeforePromptBuild(
    _event: PocPromptBuildEvent,
    ctx: PocAgentCtx,
  ): Promise<PocHookOutcome> {
    // ctx in this hook doesn't carry senderId. Fall back to the cache
    // populated by the most recent message_received for this agent.
    const cached = lastRouteByAgent.get(ctx.agentId ?? "default")
    const r = cached
      ? { channel: cached.channel, user: cached.user }
      : route(ctx.channelId, undefined)

    const [soul, profile, memory] = await Promise.all([
      read(pathFor({ kind: "soul" })),
      read(pathFor({ kind: "user", channel: r.channel, user: r.user })),
      read(pathFor({ kind: "memory", channel: r.channel, user: r.user })),
    ])

    const segments: string[] = []
    if (soul) segments.push(`<!-- claw-mem/poc:soul -->\n${soul}`)
    if (profile) segments.push(`<!-- claw-mem/poc:user(${r.channel}/${r.user}) -->\n${profile}`)
    if (memory) segments.push(`<!-- claw-mem/poc:memory(${r.channel}/${r.user}) -->\n${memory}`)

    if (segments.length === 0) return { acted: false, route: r }
    const prependContext = segments.join("\n\n")
    logger.info(
      `[claw-mem/poc] before_prompt_build agent=${ctx.agentId ?? "(unknown)"} ` +
        `channel=${r.channel} user=${r.user} injected=${segments.length}-segments ` +
        `tokens~${Math.ceil(prependContext.length / 4)}`,
    )
    return { acted: true, route: r, prependContext }
  }

  return {
    onMessageReceived,
    onMessageSent,
    onBeforePromptBuild,
    /** Test-only accessor for the per-agent cache. */
    _getCachedRoute(agentId: string): PocRoute | undefined {
      return lastRouteByAgent.get(agentId)
    },
  }
}

/** Register the PoC hook chain on a PluginApi. Idempotent — safe to call once at activation. */
export function registerPocHooks(
  api: PluginApi,
  config: ClawMemConfig,
  logger: PluginLogger,
): void {
  if (!config.poc.enabled) return
  const handlers = createPocHookHandlers(config, logger)

  // Wrap handlers so the OpenClaw runner sees the right shape:
  //   message_received → returns void
  //   message_sent     → returns void
  //   before_prompt_build → returns { prependContext } | undefined
  const onMessageReceived = async (event: unknown, ctx: unknown) => {
    try {
      await handlers.onMessageReceived(event as PocMessageEvent, ctx as PocMessageCtx)
    } catch (err) {
      logger.error(`[claw-mem/poc] message_received error: ${String(err)}`)
    }
  }
  const onMessageSent = async (event: unknown, ctx: unknown) => {
    try {
      await handlers.onMessageSent(event as PocMessageEvent, ctx as PocMessageCtx)
    } catch (err) {
      logger.error(`[claw-mem/poc] message_sent error: ${String(err)}`)
    }
  }
  const onBeforePromptBuild = async (event: unknown, ctx: unknown) => {
    try {
      const outcome = await handlers.onBeforePromptBuild(event as PocPromptBuildEvent, ctx as PocAgentCtx)
      if (outcome.acted && outcome.prependContext) {
        return { prependContext: outcome.prependContext }
      }
      return undefined
    } catch (err) {
      logger.error(`[claw-mem/poc] before_prompt_build error: ${String(err)}`)
      return undefined
    }
  }

  if (api.on) {
    api.on("message_received", onMessageReceived)
    api.on("message_sent", onMessageSent)
    // Higher priority (lower number runs first) so PoC runs before the
    // existing SQLite-based onBeforePromptBuild (which is at priority 50).
    api.on("before_prompt_build", onBeforePromptBuild, { priority: 40 })
  } else if (api.registerHook) {
    api.registerHook("message_received", onMessageReceived)
    api.registerHook("message_sent", onMessageSent)
    // Legacy registerHook expects Promise<void>; drop the structured return.
    api.registerHook("before_prompt_build", async (event: unknown, ctx: unknown) => {
      await onBeforePromptBuild(event, ctx)
    })
  } else {
    logger.warn("[claw-mem/poc] PluginApi exposes neither api.on nor api.registerHook; not registered")
  }

  logger.info("[claw-mem/poc] PoC hooks registered (multi-channel markdown engine, 3.0 preview)")
}

// One-line truncation: collapse newlines, trim, cap at maxLen.
function oneLine(text: string, maxLen: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= maxLen ? flat : flat.slice(0, maxLen - 1) + "…"
}
