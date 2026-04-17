import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { extractObservation } from "../src/observer/extractor.ts"

describe("extractObservation", () => {
  it("extracts Read observation", () => {
    const obs = extractObservation({
      toolName: "Read",
      toolInput: { file_path: "/src/utils/cache.ts" },
      toolOutput: "1\timport { createHash } from 'node:crypto'\n2\t\n3\texport function hash(data: string) {\n4\t  return createHash('sha256').update(data).digest('hex')\n5\t}",
      sessionId: "s1",
      agentId: "a1",
      promptNumber: 1,
    })

    assert.ok(obs)
    assert.equal(obs!.type, "discovery")
    assert.ok(obs!.title.includes("cache.ts"))
    assert.ok(obs!.filesRead.includes("/src/utils/cache.ts"))
    assert.ok(obs!.concepts.includes("typescript"))
  })

  it("extracts Edit observation", () => {
    const obs = extractObservation({
      toolName: "Edit",
      toolInput: {
        file_path: "/src/app.ts",
        old_string: "const x = 1",
        new_string: "const x = 2\nconst y = 3",
      },
      toolOutput: "File edited successfully",
      sessionId: "s1",
      agentId: "a1",
      promptNumber: 2,
    })

    assert.ok(obs)
    assert.equal(obs!.type, "change")
    assert.ok(obs!.title.includes("app.ts"))
    assert.ok(obs!.filesModified.includes("/src/app.ts"))
  })

  it("extracts Bash observation with error detection", () => {
    const obs = extractObservation({
      toolName: "Bash",
      toolInput: { command: "npm test" },
      toolOutput: "PASS src/utils.test.ts\n5 tests passed\nok 5 - all tests pass",
      sessionId: "s1",
      agentId: "a1",
      promptNumber: 3,
    })

    assert.ok(obs)
    assert.equal(obs!.type, "change")
    assert.ok(obs!.title.includes("npm test"))
    assert.ok(obs!.facts.some((f) => f.includes("Tests passing")))
    assert.ok(obs!.concepts.includes("testing"))
  })

  it("extracts Grep observation", () => {
    const obs = extractObservation({
      toolName: "Grep",
      toolInput: { pattern: "TODO" },
      toolOutput: "src/a.ts:10\nsrc/b.ts:20\nsrc/c.ts:30",
      sessionId: "s1",
      agentId: "a1",
      promptNumber: 4,
    })

    assert.ok(obs)
    assert.equal(obs!.type, "discovery")
    assert.ok(obs!.title.includes("TODO"))
    assert.ok(obs!.facts.some((f) => f.includes("3 matches")))
  })

  it("returns null for empty output", () => {
    const obs = extractObservation({
      toolName: "Read",
      toolInput: { file_path: "/empty" },
      toolOutput: "",
      sessionId: "s1",
      agentId: "a1",
      promptNumber: 1,
    })

    assert.equal(obs, null)
  })

  it("returns null for very short output", () => {
    const obs = extractObservation({
      toolName: "Bash",
      toolInput: { command: "pwd" },
      toolOutput: "/home/user",
      sessionId: "s1",
      agentId: "a1",
      promptNumber: 1,
    })

    assert.equal(obs, null)
  })

  it("handles unknown tool names", () => {
    const obs = extractObservation({
      toolName: "CustomTool",
      toolInput: { foo: "bar", baz: 42 },
      toolOutput: "This is a long enough output to be captured as an observation for the system",
      sessionId: "s1",
      agentId: "a1",
      promptNumber: 1,
    })

    assert.ok(obs)
    assert.equal(obs!.type, "discovery")
    assert.ok(obs!.title.includes("CustomTool"))
  })
})
