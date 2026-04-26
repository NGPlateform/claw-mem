import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { scoreImportance, isEmojiOnly } from "../src/observer/importance.ts"

describe("isEmojiOnly", () => {
  it("returns true for empty / whitespace-only", () => {
    assert.equal(isEmojiOnly(""), true)
    assert.equal(isEmojiOnly("   "), true)
  })

  it("returns true for emoji-only turns", () => {
    assert.equal(isEmojiOnly("👍"), true)
    assert.equal(isEmojiOnly("👍👍👍"), true)
    assert.equal(isEmojiOnly("🎉🎊"), true)
  })

  it("returns true for punctuation-only turns", () => {
    assert.equal(isEmojiOnly("!!!"), true)
    assert.equal(isEmojiOnly("。。。"), true)
  })

  it("returns false for any letter / number / CJK content", () => {
    assert.equal(isEmojiOnly("ok"), false)
    assert.equal(isEmojiOnly("好"), false)
    assert.equal(isEmojiOnly("123"), false)
    assert.equal(isEmojiOnly("👍 OK"), false)
    assert.equal(isEmojiOnly("🎉 完成"), false)
  })
})

describe("scoreImportance", () => {
  const baseUser = { role: "user" as const, hasExplicitCue: false, hasPreferenceCue: false }

  it("baseline 0.5 for a plain user message", () => {
    const score = scoreImportance({ ...baseUser, text: "let's pick a different approach" })
    assert.ok(score >= 0.45 && score <= 0.6, `expected ~0.5, got ${score}`)
  })

  it("explicit cue significantly bumps score", () => {
    const plain = scoreImportance({ ...baseUser, text: "deploy at 3pm tomorrow" })
    const cued = scoreImportance({ ...baseUser, hasExplicitCue: true, text: "deploy at 3pm tomorrow" })
    assert.ok(cued > plain + 0.3, `cued=${cued} should be much higher than plain=${plain}`)
  })

  it("preference cue bumps score (less than explicit)", () => {
    const plain = scoreImportance({ ...baseUser, text: "I like spaces over tabs" })
    const cued = scoreImportance({ ...baseUser, hasPreferenceCue: true, text: "I like spaces over tabs" })
    assert.ok(cued > plain + 0.2, `pref cued=${cued} should be higher than plain=${plain}`)
  })

  it("URL / email bumps score", () => {
    const plain = scoreImportance({ ...baseUser, text: "the site is broken right now" })
    const url = scoreImportance({ ...baseUser, text: "the site https://example.com is broken right now" })
    assert.ok(url > plain, `url=${url} > plain=${plain}`)
  })

  it("date references bump score", () => {
    const plain = scoreImportance({ ...baseUser, text: "we discussed the launch plan" })
    const dated = scoreImportance({ ...baseUser, text: "we discussed the launch plan for 2026-04-26" })
    assert.ok(dated > plain, `dated=${dated} > plain=${plain}`)
  })

  it("chitchat tokens get penalty", () => {
    const score = scoreImportance({ ...baseUser, text: "ok" })
    assert.ok(score < 0.25, `expected low, got ${score}`)
  })

  it("Chinese chitchat: 好的 / 嗯 / 收到 get penalty", () => {
    assert.ok(scoreImportance({ ...baseUser, text: "好的" }) < 0.25)
    assert.ok(scoreImportance({ ...baseUser, text: "嗯" }) < 0.25)
    assert.ok(scoreImportance({ ...baseUser, text: "收到" }) < 0.25)
  })

  it("emoji-only turn gets heavy penalty", () => {
    const score = scoreImportance({ ...baseUser, text: "👍👍👍" })
    assert.ok(score < 0.1, `emoji-only should be near floor, got ${score}`)
  })

  it("explicit cue + URL stacks", () => {
    const score = scoreImportance({
      ...baseUser,
      hasExplicitCue: true,
      text: "remember this: the staging URL is https://staging.example.com",
    })
    assert.ok(score >= 0.95, `expected near max, got ${score}`)
  })

  it("assistant messages get small penalty when no explicit cue", () => {
    const user = scoreImportance({ ...baseUser, text: "I'll update the docs tomorrow" })
    const asst = scoreImportance({ ...baseUser, role: "assistant", text: "I'll update the docs tomorrow" })
    assert.ok(asst < user, `assistant=${asst} should be slightly lower than user=${user}`)
  })

  it("score always clamps to [0, 1]", () => {
    const high = scoreImportance({
      ...baseUser,
      hasExplicitCue: true,
      text: "remember this date 2026-04-26 url https://x.com email a@b.com const x = `code` 12345 " + "x".repeat(300),
    })
    const low = scoreImportance({ ...baseUser, text: "" })
    assert.ok(high <= 1.0 && high >= 0)
    assert.ok(low >= 0 && low <= 1.0)
  })
})
