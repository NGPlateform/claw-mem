import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { buildContext } from "../src/context/builder.ts"
import type { Observation, SessionSummary } from "../src/types.ts"

const now = Date.now()

const mockObservations: Observation[] = [
  {
    id: 1,
    sessionId: "s1",
    agentId: "a1",
    type: "decision",
    title: "Added Redis caching",
    facts: ["Reduced queries by 60%"],
    narrative: "Implemented Redis to reduce load",
    concepts: ["redis"],
    filesRead: [],
    filesModified: ["src/cache.ts"],
    toolName: "Edit",
    promptNumber: 1,
    tokenEstimate: 30,
    contentHash: "abc",
    createdAt: new Date(now).toISOString(),
    createdAtEpoch: Math.floor(now / 1000),
  },
  {
    id: 2,
    sessionId: "s1",
    agentId: "a1",
    type: "discovery",
    title: "Found N+1 query bug",
    facts: ["200 queries per page"],
    narrative: null,
    concepts: ["sql"],
    filesRead: ["src/dashboard.ts"],
    filesModified: [],
    toolName: "Grep",
    promptNumber: 2,
    tokenEstimate: 20,
    contentHash: "def",
    createdAt: new Date(now - 1000).toISOString(),
    createdAtEpoch: Math.floor((now - 1000) / 1000),
  },
]

const mockSummaries: SessionSummary[] = [
  {
    id: 1,
    sessionId: "s0",
    agentId: "a1",
    request: "Fix database performance",
    investigated: "Query patterns",
    learned: "Connection pooling helps",
    completed: "Added pooling",
    nextSteps: "Monitor latency",
    notes: null,
    observationCount: 3,
    tokenEstimate: 50,
    createdAt: new Date(now - 3600000).toISOString(),
    createdAtEpoch: Math.floor((now - 3600000) / 1000),
  },
]

describe("buildContext", () => {
  it("builds markdown context with summaries and observations", () => {
    const result = buildContext({
      observations: mockObservations,
      summaries: mockSummaries,
      tokenBudget: 8000,
      agentId: "a1",
    })

    assert.ok(result.markdown.includes("<claw-mem-context>"))
    assert.ok(result.markdown.includes("</claw-mem-context>"))
    assert.ok(result.markdown.includes("Recent Sessions"))
    assert.ok(result.markdown.includes("Fix database performance"))
    assert.ok(result.markdown.includes("Recent Observations"))
    assert.ok(result.markdown.includes("Added Redis caching"))
    assert.equal(result.summaryCount, 1)
    assert.equal(result.observationCount, 2)
    assert.ok(result.tokensUsed > 0)
  })

  it("respects token budget", () => {
    const result = buildContext({
      observations: mockObservations,
      summaries: mockSummaries,
      tokenBudget: 40, // Very small budget — only fits summary
      agentId: "a1",
    })

    // Summary is 50 tokens, observations are 30+20=50
    // With 40 token budget, should fit nothing or just partial
    assert.ok(result.tokensUsed <= 40)
  })

  it("returns empty context when no data", () => {
    const result = buildContext({
      observations: [],
      summaries: [],
      tokenBudget: 8000,
      agentId: "a1",
    })

    assert.equal(result.markdown, "")
    assert.equal(result.tokensUsed, 0)
    assert.equal(result.observationCount, 0)
    assert.equal(result.summaryCount, 0)
  })

  it("prioritizes summaries over observations", () => {
    const result = buildContext({
      observations: mockObservations,
      summaries: mockSummaries,
      tokenBudget: 60, // Enough for summary (50) + 1 obs (30 > remaining 10)
      agentId: "a1",
    })

    // Should have the summary but may not fit observations
    assert.equal(result.summaryCount, 1)
  })
})
