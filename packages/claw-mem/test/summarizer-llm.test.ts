import { test } from "node:test"
import assert from "node:assert/strict"

import { summarizeSessionWithLLM, summarizeSessionWithOpenClaw, createSummarizer } from "../src/observer/index.ts"
import type { SummarizerLLMConfig, SummarizerOpenClawConfig } from "../src/config.ts"
import type { Observation } from "../src/types.ts"

const OPENCLAW_STUB: SummarizerOpenClawConfig = {
  bin: "openclaw",
  timeoutMs: 30000,
  fallbackOnError: true,
  forceLocal: false,
  forceGateway: false,
}

const OBS: Observation[] = [
  {
    id: 1,
    sessionId: "s1",
    agentId: "a1",
    type: "discovery",
    title: "found an indexer bug",
    facts: ["FTS index rebuild misses rows added during vacuum"],
    narrative: null,
    concepts: ["sqlite", "fts"],
    filesRead: ["src/db/migrations.ts"],
    filesModified: [],
    toolName: "Read",
    promptNumber: 1,
    tokenEstimate: 40,
    contentHash: "abc123",
    createdAt: "2026-04-24T14:00:00Z",
    createdAtEpoch: 1777000000,
  },
  {
    id: 2,
    sessionId: "s1",
    agentId: "a1",
    type: "change",
    title: "patched rebuild loop",
    facts: ["switch from INSERT to INSERT OR REPLACE"],
    narrative: null,
    concepts: ["sqlite"],
    filesRead: [],
    filesModified: ["src/db/migrations.ts"],
    toolName: "Edit",
    promptNumber: 2,
    tokenEstimate: 20,
    contentHash: "def456",
    createdAt: "2026-04-24T14:05:00Z",
    createdAtEpoch: 1777000300,
  },
]

const BASE_CONFIG: SummarizerLLMConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  apiKey: "sk-stub",
  maxTokens: 512,
  timeoutMs: 10000,
  fallbackOnError: true,
}

function fakeJson(text: string) {
  return async () => ({ content: [{ type: "text", text }] })
}

test("llm summarizer — happy path parses JSON into SummaryInput", async () => {
  const payload = JSON.stringify({
    investigated: "read migrations.ts; traced FTS rebuild path",
    learned: "INSERT OR REPLACE is the correct primitive for idempotent reindex",
    completed: "patched rebuild loop in migrations.ts",
    nextSteps: null,
    notes: "regression test pending",
  })

  const summary = await summarizeSessionWithLLM("s1", "a1", OBS, "fix fts rebuild", BASE_CONFIG, {
    messagesCreate: fakeJson(payload),
  })

  assert.equal(summary.sessionId, "s1")
  assert.equal(summary.agentId, "a1")
  assert.equal(summary.observationCount, 2)
  assert.equal(summary.request, "fix fts rebuild")
  assert.equal(summary.investigated, "read migrations.ts; traced FTS rebuild path")
  assert.equal(summary.learned, "INSERT OR REPLACE is the correct primitive for idempotent reindex")
  assert.equal(summary.completed, "patched rebuild loop in migrations.ts")
  assert.equal(summary.nextSteps, null)
  assert.equal(summary.notes, "regression test pending")
})

test("llm summarizer — tolerates ```json fences", async () => {
  const fenced = "```json\n" + JSON.stringify({ investigated: "x", learned: null, completed: null, nextSteps: null, notes: null }) + "\n```"
  const summary = await summarizeSessionWithLLM("s1", "a1", OBS, undefined, BASE_CONFIG, {
    messagesCreate: fakeJson(fenced),
  })
  assert.equal(summary.investigated, "x")
})

test("llm summarizer — malformed JSON falls back to heuristic when fallbackOnError", async () => {
  const summary = await summarizeSessionWithLLM("s1", "a1", OBS, "go", BASE_CONFIG, {
    messagesCreate: fakeJson("not json at all"),
  })
  // Heuristic summary must populate investigated from discovery title
  assert.equal(summary.sessionId, "s1")
  assert.equal(summary.observationCount, 2)
  assert.equal(summary.investigated, "found an indexer bug")
  assert.equal(summary.completed, "patched rebuild loop")
})

test("llm summarizer — malformed JSON throws when fallbackOnError is false", async () => {
  await assert.rejects(
    summarizeSessionWithLLM(
      "s1",
      "a1",
      OBS,
      "go",
      { ...BASE_CONFIG, fallbackOnError: false },
      { messagesCreate: fakeJson("nope") },
    ),
    /malformed JSON/,
  )
})

test("llm summarizer — empty observations short-circuits to heuristic (no API call)", async () => {
  let called = false
  const summary = await summarizeSessionWithLLM("s1", "a1", [], "only-a-question", BASE_CONFIG, {
    messagesCreate: async () => {
      called = true
      return { content: [{ type: "text", text: "{}" }] }
    },
  })
  assert.equal(called, false)
  assert.equal(summary.observationCount, 0)
  assert.equal(summary.request, "only-a-question")
})

test("llm summarizer — API error falls back to heuristic", async () => {
  const summary = await summarizeSessionWithLLM("s1", "a1", OBS, undefined, BASE_CONFIG, {
    messagesCreate: async () => {
      throw new Error("rate limit")
    },
  })
  assert.equal(summary.investigated, "found an indexer bug")
})

test("createSummarizer — heuristic mode ignores llm config", async () => {
  const summarizer = createSummarizer({
    mode: "heuristic",
    llm: BASE_CONFIG,
    openclaw: OPENCLAW_STUB,
  })
  const summary = await summarizer("s1", "a1", OBS, "hi")
  assert.equal(summary.investigated, "found an indexer bug")
})

test("createSummarizer — llm mode uses injected dep", async () => {
  const summarizer = createSummarizer(
    {
      mode: "llm",
      llm: BASE_CONFIG,
      openclaw: OPENCLAW_STUB,
    },
    {
      llmDeps: {
        messagesCreate: fakeJson(
          JSON.stringify({
            investigated: "via LLM",
            learned: null,
            completed: null,
            nextSteps: null,
            notes: null,
          }),
        ),
      },
    },
  )
  const summary = await summarizer("s1", "a1", OBS, undefined)
  assert.equal(summary.investigated, "via LLM")
})

test("openclaw summarizer — happy path parses JSON returned by openclaw infer", async () => {
  const summary = await summarizeSessionWithOpenClaw("s1", "a1", OBS, "fix indexer", OPENCLAW_STUB, {
    runOpenClaw: async () =>
      JSON.stringify({
        investigated: "indexer rebuild path",
        learned: "INSERT OR REPLACE handles vacuum race",
        completed: "patched migrations.ts",
        nextSteps: null,
        notes: null,
      }),
  })
  assert.equal(summary.investigated, "indexer rebuild path")
  assert.equal(summary.learned, "INSERT OR REPLACE handles vacuum race")
  assert.equal(summary.completed, "patched migrations.ts")
  assert.equal(summary.observationCount, 2)
})

test("openclaw summarizer — spawn failure falls back to heuristic", async () => {
  const summary = await summarizeSessionWithOpenClaw("s1", "a1", OBS, undefined, OPENCLAW_STUB, {
    runOpenClaw: async () => {
      throw new Error("openclaw not on PATH")
    },
  })
  assert.equal(summary.investigated, "found an indexer bug")
})

test("openclaw summarizer — malformed JSON falls back to heuristic", async () => {
  const summary = await summarizeSessionWithOpenClaw("s1", "a1", OBS, undefined, OPENCLAW_STUB, {
    runOpenClaw: async () => "not even close to JSON",
  })
  assert.equal(summary.investigated, "found an indexer bug")
})

test("createSummarizer — openclaw mode dispatches via injected dep", async () => {
  const summarizer = createSummarizer(
    {
      mode: "openclaw",
      llm: BASE_CONFIG,
      openclaw: OPENCLAW_STUB,
    },
    {
      openclawDeps: {
        runOpenClaw: async () =>
          JSON.stringify({
            investigated: "via openclaw",
            learned: null,
            completed: null,
            nextSteps: null,
            notes: null,
          }),
      },
    },
  )
  const summary = await summarizer("s1", "a1", OBS, undefined)
  assert.equal(summary.investigated, "via openclaw")
})

test("llm summarizer — prompt caching control flag is sent on system block", async () => {
  let capturedSystem: unknown = null
  await summarizeSessionWithLLM("s1", "a1", OBS, undefined, BASE_CONFIG, {
    messagesCreate: async (args) => {
      capturedSystem = (args as { system: unknown }).system
      return { content: [{ type: "text", text: JSON.stringify({ investigated: "ok", learned: null, completed: null, nextSteps: null, notes: null }) }] }
    },
  })
  assert.ok(Array.isArray(capturedSystem), "system should be passed as an array of blocks for caching")
  const blocks = capturedSystem as Array<{ type: string; cache_control?: { type: string } }>
  assert.equal(blocks[0]?.type, "text")
  assert.equal(blocks[0]?.cache_control?.type, "ephemeral")
})
