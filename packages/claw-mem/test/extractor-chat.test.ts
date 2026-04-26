import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  extractChatObservation,
  DEFAULT_CHAT_CUES,
  type ChatExtractorOptions,
} from "../src/observer/extractor-chat.ts"

const baseOpts: ChatExtractorOptions = {
  enabled: true,
  explicitOnly: false,
  minChars: 8,
  maxNarrativeChars: 500,
  cues: DEFAULT_CHAT_CUES,
  captureAssistant: false,
}

const ev = (text: string, role: "user" | "assistant" = "user") => ({
  role,
  text,
  sessionId: "s1",
  agentId: "a1",
  promptNumber: 1,
})

describe("extractChatObservation", () => {
  it("captures user message with explicit Chinese cue (decision)", () => {
    const obs = extractChatObservation(ev("记一下，下次部署用 staging 环境而不是 prod"), baseOpts)
    assert.ok(obs)
    assert.equal(obs!.type, "decision")
    assert.equal(obs!.toolName, "message_received")
    assert.ok(obs!.facts.some((f) => f.includes("记一下")))
    assert.ok(obs!.title.startsWith("User"))
  })

  it("captures user message with explicit English cue (decision)", () => {
    const obs = extractChatObservation(ev("remember this: the API base is https://staging.example"), baseOpts)
    assert.ok(obs)
    assert.equal(obs!.type, "decision")
    assert.ok(obs!.facts.some((f) => f.includes("remember this")))
  })

  it("captures preference cue as learning", () => {
    const obs = extractChatObservation(ev("我喜欢 tabs 不喜欢 spaces，以后都用 tabs"), baseOpts)
    assert.ok(obs)
    assert.equal(obs!.type, "learning")
  })

  it("captures plain message as low-signal discovery when explicitOnly=false", () => {
    const obs = extractChatObservation(ev("just chatting about the weather today"), baseOpts)
    assert.ok(obs)
    assert.equal(obs!.type, "discovery")
  })

  it("drops plain message when explicitOnly=true", () => {
    const obs = extractChatObservation(
      ev("just chatting about the weather today"),
      { ...baseOpts, explicitOnly: true },
    )
    assert.equal(obs, null)
  })

  it("still captures explicit cue when explicitOnly=true", () => {
    const obs = extractChatObservation(
      ev("note this: never push to main on Friday"),
      { ...baseOpts, explicitOnly: true },
    )
    assert.ok(obs)
    assert.equal(obs!.type, "decision")
  })

  it("drops messages shorter than minChars", () => {
    const obs = extractChatObservation(ev("ok"), baseOpts)
    assert.equal(obs, null)
  })

  it("drops emoji-only / pictograph-only turns at capture time", () => {
    assert.equal(extractChatObservation(ev("👍👍👍👍👍"), baseOpts), null)
    assert.equal(extractChatObservation(ev("🎉🎊✨🌟💫"), baseOpts), null)
  })

  it("sets importance score on the captured observation", () => {
    const cued = extractChatObservation(ev("remember this: never deploy on Friday"), baseOpts)
    const plain = extractChatObservation(ev("just having a normal day chatting"), baseOpts)
    assert.ok(cued && plain)
    assert.ok(typeof cued!.importance === "number")
    assert.ok(typeof plain!.importance === "number")
    assert.ok(cued!.importance! > plain!.importance!, "cued should outrank plain")
  })

  it("drops assistant messages by default", () => {
    const obs = extractChatObservation(ev("Sure, I'll remember that for next time", "assistant"), baseOpts)
    assert.equal(obs, null)
  })

  it("captures assistant messages when captureAssistant=true", () => {
    const obs = extractChatObservation(
      ev("Sure, I'll remember that — never deploy on Friday afternoons.", "assistant"),
      { ...baseOpts, captureAssistant: true },
    )
    assert.ok(obs)
    assert.ok(obs!.title.startsWith("Assistant"))
    assert.equal(obs!.toolName, "message_sent")
  })

  it("returns null when extractor is disabled", () => {
    const obs = extractChatObservation(
      ev("remember this: anything"),
      { ...baseOpts, enabled: false },
    )
    assert.equal(obs, null)
  })

  it("truncates very long titles to ≤120 chars", () => {
    const long = "记住 " + "这是一段非常长的备注，".repeat(20)
    const obs = extractChatObservation(ev(long), baseOpts)
    assert.ok(obs)
    assert.ok(obs!.title.length <= 120, `title too long: ${obs!.title.length}`)
  })

  it("extracts narrative for context preview", () => {
    const obs = extractChatObservation(ev("remember this important note about the schema"), baseOpts)
    assert.ok(obs)
    assert.ok(obs!.narrative)
    assert.ok(obs!.narrative!.includes("schema"))
  })
})
