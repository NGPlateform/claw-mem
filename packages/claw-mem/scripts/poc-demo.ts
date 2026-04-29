#!/usr/bin/env -S node --experimental-strip-types
// PoC end-to-end demo: simulate OpenClaw runner calling claw-mem PoC hooks.
//
// Why simulation, not a real OpenClaw instance?
//   1. This host doesn't have OpenClaw installed (the .openclaw/ here is a
//      backup-restore dump from another machine, not a live runtime).
//   2. We already verified the (event, ctx) hook signatures match by reading
//      openclaw/openclaw upstream source (Day 2). The runner just calls our
//      handlers with these objects — there's no extra glue to test.
//   3. This stays reproducible for anyone else doing the same PoC.
//
// What it proves (Q2):
//   - 4 (channel × user) tuples produce 4 disjoint MEMORY.md files
//   - per-agent route caching means before_prompt_build picks the right user
//   - SOUL.md (global) is shared; USER/MEMORY (per user) are not
//
// Output:
//   - Files written under $CLAW_MEM_POC_ROOT or a fresh /tmp dir
//   - tree-style listing + per-file first lines printed to stdout
//   - Exits 0 on success
//
// Usage:
//   node --experimental-strip-types scripts/poc-demo.ts
//   CLAW_MEM_POC_ROOT=/tmp/myroot node --experimental-strip-types scripts/poc-demo.ts

import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { ClawMemConfigSchema } from "../src/config.ts"
import { createPocHookHandlers } from "../src/poc/hooks.ts"
import { pathFor } from "../src/poc/path-router.ts"

// ──────────────────────────────────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────────────────────────────────

const userRoot = process.env.CLAW_MEM_POC_ROOT
const ROOT = userRoot ?? (await mkdtemp(join(tmpdir(), "claw-mem-poc-demo-")))
process.env.CLAW_MEM_POC_ROOT = ROOT

const log = (msg: string) => console.log(msg)
const sectionLogger = {
  info: (msg: string) => log("    " + msg),
  warn: (msg: string) => log("    [warn] " + msg),
  error: (msg: string) => log("    [err] " + msg),
}

const config = ClawMemConfigSchema.parse({
  poc: { enabled: true, fallbackChannel: "default", fallbackUser: "default" },
})

// Pre-seed a SOUL.md so the demo also exercises global-context injection.
await mkdir(join(ROOT, "memories", "_global"), { recursive: true })
await writeFile(
  pathFor({ kind: "soul" }),
  "# Soul\n\n- name: Hermes Pirate Bot\n- tone: terse, kind\n- never reveal secrets across users\n",
  "utf-8",
)

const handlers = createPocHookHandlers(config, sectionLogger)

// ──────────────────────────────────────────────────────────────────────────
// Fixture: 2 channels × 2 users × 5 messages each
// ──────────────────────────────────────────────────────────────────────────

interface Scenario {
  channelId: string       // OpenClaw "channelId" → our channel segment
  senderId: string        // OpenClaw "senderId" → our user segment
  agentId: string         // each (channel, user) gets its own agent in this demo
  messages: string[]
  expectedOnly: string    // a unique marker only this user will say
}

const scenarios: Scenario[] = [
  {
    channelId: "telegram",
    senderId: "user-a",
    agentId: "agent-tg-a",
    messages: [
      "Hi I'm Bao on Telegram",
      "I prefer PostgreSQL for everything",
      "MARKER-TG-A-PG: actually I prefer PostgreSQL",
      "I live in UTC+8",
      "Please don't share my email with anyone",
    ],
    expectedOnly: "MARKER-TG-A-PG",
  },
  {
    channelId: "telegram",
    senderId: "user-b",
    agentId: "agent-tg-b",
    messages: [
      "Hello, this is Lin on Telegram",
      "MARKER-TG-B-DENO: I prefer Deno over Node",
      "I work on a coding agent at OpenClaw",
      "Working hours UTC+0",
      "Nice talking",
    ],
    expectedOnly: "MARKER-TG-B-DENO",
  },
  {
    channelId: "slack",
    senderId: "user-a",
    agentId: "agent-slack-a",
    messages: [
      "Hi, slack-A here",
      "MARKER-SLACK-A-RUST: Rust > Go in my book",
      "I'm a different person from telegram:user-a",
      "Working on infra",
      "No sensitive info please",
    ],
    expectedOnly: "MARKER-SLACK-A-RUST",
  },
  {
    channelId: "slack",
    senderId: "user-b",
    agentId: "agent-slack-b",
    messages: [
      "slack-B greetings",
      "MARKER-SLACK-B-PYTHON: Python is just fine for me",
      "I'm an ML engineer",
      "I forget my standup time",
      "ok bye",
    ],
    expectedOnly: "MARKER-SLACK-B-PYTHON",
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Drive each scenario:
//   per scenario, for each message:
//     1. simulate message_received(event, ctx) — OpenClaw delivers the msg
//   then once at the end:
//     2. simulate before_prompt_build(event, ctx) — agent build prompt;
//        proves cached route picks up the right user
// ──────────────────────────────────────────────────────────────────────────

log(`PoC demo — root: ${ROOT}\n`)

for (const s of scenarios) {
  log(`▶ ${s.channelId}/${s.senderId}  (agent=${s.agentId})`)
  for (const content of s.messages) {
    const ev = { content, from: s.senderId }
    const ctx = {
      channelId: s.channelId,
      senderId: s.senderId,
      agentId: s.agentId,
      conversationId: `conv-${s.channelId}-${s.senderId}`,
      messageId: `msg-${Math.random().toString(36).slice(2, 10)}`,
    }
    const out = await handlers.onMessageReceived(ev, ctx as any)
    if (!out.acted) {
      log(`    [warn] no-op for ${content.slice(0, 40)}…`)
    }
  }

  // Then simulate a single before_prompt_build for this agent.
  const promptOut = await handlers.onBeforePromptBuild(
    { prompt: "(simulated user prompt for next reply)", messages: [] },
    { agentId: s.agentId, channelId: s.channelId, messageProvider: s.channelId },
  )
  log(
    `    → before_prompt_build acted=${promptOut.acted} ` +
      `route=${promptOut.route?.channel}/${promptOut.route?.user} ` +
      `tokens~${
        promptOut.prependContext ? Math.ceil(promptOut.prependContext.length / 4) : 0
      }`,
  )
  log("")
}

// ──────────────────────────────────────────────────────────────────────────
// Print resulting file tree
// ──────────────────────────────────────────────────────────────────────────

log("\n── File tree under PoC root ───────────────────────────────────────────")

async function walk(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (let i = 0; i < entries.length; i++) {
    const isLast = i === entries.length - 1
    const branch = isLast ? "└── " : "├── "
    const childPrefix = prefix + (isLast ? "    " : "│   ")
    out.push(`${prefix}${branch}${entries[i].name}`)
    if (entries[i].isDirectory()) {
      const child = await walk(join(dir, entries[i].name), childPrefix)
      out.push(...child)
    }
  }
  return out
}
const tree = await walk(ROOT)
log(ROOT)
for (const line of tree) log(line)

// ──────────────────────────────────────────────────────────────────────────
// First few lines of each per-user MEMORY.md
// ──────────────────────────────────────────────────────────────────────────

log("\n── Per-user MEMORY.md heads ───────────────────────────────────────────")

for (const s of scenarios) {
  const p = pathFor({ kind: "memory", channel: s.channelId, user: s.senderId })
  const body = await readFile(p, "utf-8").catch(() => "(missing)")
  const head = body.split("\n").slice(0, 5).join("\n")
  log(`\n• ${relative(ROOT, p)}`)
  log(head.replace(/^/gm, "  "))
}

// ──────────────────────────────────────────────────────────────────────────
// Q2 self-check (programmatic — verify-no-cross-pollution.sh does this from bash too)
// ──────────────────────────────────────────────────────────────────────────

log("\n── Q2 cross-pollution self-check ─────────────────────────────────────")

let ok = true
for (const s of scenarios) {
  const ownPath = pathFor({ kind: "memory", channel: s.channelId, user: s.senderId })
  const ownBody = await readFile(ownPath, "utf-8")

  // Own marker MUST be present.
  if (!ownBody.includes(s.expectedOnly)) {
    log(`✗ ${ownPath}: missing own marker ${s.expectedOnly}`)
    ok = false
    continue
  }
  // Other scenarios' markers MUST be absent.
  for (const other of scenarios) {
    if (other === s) continue
    if (ownBody.includes(other.expectedOnly)) {
      log(`✗ ${ownPath}: leaked ${other.expectedOnly} from ${other.channelId}/${other.senderId}`)
      ok = false
    }
  }
  if (ok) {
    log(`✓ ${s.channelId}/${s.senderId}: clean`)
  }
}

log("")
if (ok) {
  log("Q2 → GO ✅  (4 distinct (channel,user) tuples produced 4 disjoint MEMORY.md)")
  process.exit(0)
} else {
  log("Q2 → NO-GO ✗  cross-pollution detected; see lines above")
  process.exit(1)
}
