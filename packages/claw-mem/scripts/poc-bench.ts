#!/usr/bin/env -S node --experimental-strip-types
// PoC benchmark: measure before_prompt_build latency at scale (Q6).
//
// Setup: 100 mock users × 100 facts in MEMORY.md each (10k facts total),
// also a SOUL.md and per-user USER.md.
//
// Measure: 100 calls to onBeforePromptBuild for a single (channel, user)
// after warming up. Report p50 / p95 / p99 / max.
//
// Q6 target: p95 < 100 ms. Failure means we need a markdown cache layer
// before the existing SQLite pipeline (Phase 1 first task).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ClawMemConfigSchema } from "../src/config.ts"
import { createPocHookHandlers } from "../src/poc/hooks.ts"
import { pathFor } from "../src/poc/path-router.ts"

const root = await mkdtemp(join(tmpdir(), "claw-mem-poc-bench-"))
process.env.CLAW_MEM_POC_ROOT = root

const N_USERS = 100
const N_FACTS_PER_USER = 100
const N_ITERATIONS = 100
const WARMUP_RUNS = 10
const CHANNEL = "telegram"

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }
const config = ClawMemConfigSchema.parse({ poc: { enabled: true } })
const handlers = createPocHookHandlers(config, silentLogger)

console.log(`── PoC benchmark: ${N_USERS} users × ${N_FACTS_PER_USER} facts ──`)
console.log(`root: ${root}\n`)

// ──────────────────────────────────────────────────────────────────────────
// Seed fixture
// ──────────────────────────────────────────────────────────────────────────

console.log("Seeding fixture...")
const seedStart = performance.now()

await mkdir(join(root, "memories", "_global"), { recursive: true })
await writeFile(
  pathFor({ kind: "soul" }),
  "# Soul\n\n- name: bench-bot\n- tone: terse\n- never echo PII\n",
  "utf-8",
)

const userIds: string[] = []
for (let u = 0; u < N_USERS; u++) {
  const userId = `user-${String(u).padStart(3, "0")}`
  userIds.push(userId)

  const memoryDir = join(root, "memories", "channels", CHANNEL, "users", userId)
  await mkdir(memoryDir, { recursive: true })

  const factLines: string[] = [`# MEMORY for ${CHANNEL} / ${userId}`, ""]
  for (let f = 0; f < N_FACTS_PER_USER; f++) {
    factLines.push(
      `- 2026-04-29T${String(8 + Math.floor(f / 60)).padStart(2, "0")}:${String(f % 60).padStart(2, "0")}:00.000Z user said: synthetic fact ${f} for ${userId} with some realistic length to mimic a real chat message body and ensure we exercise reasonable token budgets`,
    )
  }
  await writeFile(join(memoryDir, "MEMORY.md"), factLines.join("\n") + "\n", "utf-8")
  await writeFile(
    join(memoryDir, "USER.md"),
    `# Profile for ${userId}\n- timezone: UTC+${u % 12}\n- joined: 2026-${String((u % 12) + 1).padStart(2, "0")}-15\n`,
    "utf-8",
  )
}
console.log(`seeded ${N_USERS} users in ${(performance.now() - seedStart).toFixed(0)}ms\n`)

// ──────────────────────────────────────────────────────────────────────────
// Warmup the route cache for one specific user (mimics real usage where
// message_received already fired before before_prompt_build).
// ──────────────────────────────────────────────────────────────────────────

const targetUser = userIds[42]!
const targetAgent = `agent-${targetUser}`
await handlers.onMessageReceived(
  { content: "warmup message" },
  { channelId: CHANNEL, senderId: targetUser, agentId: targetAgent } as any,
)

// ──────────────────────────────────────────────────────────────────────────
// Warmup runs
// ──────────────────────────────────────────────────────────────────────────

console.log(`Warmup (${WARMUP_RUNS} runs)...`)
for (let i = 0; i < WARMUP_RUNS; i++) {
  await handlers.onBeforePromptBuild(
    { prompt: "warmup", messages: [] },
    { agentId: targetAgent, channelId: CHANNEL },
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Measure
// ──────────────────────────────────────────────────────────────────────────

console.log(`Measuring (${N_ITERATIONS} runs)...`)
const samples: number[] = []
for (let i = 0; i < N_ITERATIONS; i++) {
  const t0 = performance.now()
  const out = await handlers.onBeforePromptBuild(
    { prompt: `iteration ${i}`, messages: [] },
    { agentId: targetAgent, channelId: CHANNEL },
  )
  const t1 = performance.now()
  samples.push(t1 - t0)
  if (i === 0 && out.acted) {
    console.log(`  first injection: ${out.prependContext!.length} chars (~${Math.ceil(out.prependContext!.length / 4)} tokens)`)
  }
}

samples.sort((a, b) => a - b)
const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))]
const stats = {
  p50: p(0.5),
  p95: p(0.95),
  p99: p(0.99),
  max: samples[samples.length - 1],
  mean: samples.reduce((s, v) => s + v, 0) / samples.length,
}

console.log("\n── Latency (ms) ──")
console.log(`  p50:  ${stats.p50.toFixed(2)}`)
console.log(`  p95:  ${stats.p95.toFixed(2)}`)
console.log(`  p99:  ${stats.p99.toFixed(2)}`)
console.log(`  max:  ${stats.max.toFixed(2)}`)
console.log(`  mean: ${stats.mean.toFixed(2)}`)

console.log("\n── Q6 verdict ──")
const target = 100
if (stats.p95 < target) {
  console.log(`✅ p95 = ${stats.p95.toFixed(2)} ms < ${target} ms target — Q6 GO`)
} else {
  console.log(`✗ p95 = ${stats.p95.toFixed(2)} ms ≥ ${target} ms target — Q6 NO-GO; need cache layer`)
}

// Cleanup
await rm(root, { recursive: true, force: true })
process.exit(stats.p95 < target ? 0 : 1)
