import { test } from "node:test"
import assert from "node:assert/strict"

import { requestFaucetDrip } from "../src/faucet.ts"

const SILENT_LOGGER = { info: () => {}, warn: () => {}, error: () => {} }

test("faucet drip — empty url short-circuits to null", async () => {
  const r = await requestFaucetDrip({ url: "", address: "0x1", logger: SILENT_LOGGER })
  assert.equal(r, null)
})

test("faucet drip — happy path returns parsed result", async () => {
  const origFetch = globalThis.fetch
  let captured: { url?: string; body?: string } = {}
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.url = String(url)
    captured.body = String(init?.body ?? "")
    return new Response(
      JSON.stringify({ txHash: "0xabc", amount: "10.0", unit: "COC" }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as typeof fetch

  try {
    const r = await requestFaucetDrip({
      url: "http://faucet.example/",
      address: "0xdeadbeef",
      logger: SILENT_LOGGER,
    })
    assert.deepEqual(r, { txHash: "0xabc", amount: "10.0", unit: "COC" })
    assert.equal(captured.url, "http://faucet.example/faucet/request")
    assert.equal(captured.body, JSON.stringify({ address: "0xdeadbeef" }))
  } finally {
    globalThis.fetch = origFetch
  }
})

test("faucet drip — non-2xx returns null", async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Cooldown active" }), { status: 429 })) as typeof fetch
  try {
    const r = await requestFaucetDrip({
      url: "http://faucet.example",
      address: "0x1",
      logger: SILENT_LOGGER,
    })
    assert.equal(r, null)
  } finally {
    globalThis.fetch = origFetch
  }
})

test("faucet drip — network error returns null (does not throw)", async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED")
  }) as typeof fetch
  try {
    const r = await requestFaucetDrip({
      url: "http://faucet.example",
      address: "0x1",
      logger: SILENT_LOGGER,
    })
    assert.equal(r, null)
  } finally {
    globalThis.fetch = origFetch
  }
})

test("faucet drip — malformed response returns null", async () => {
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch
  try {
    const r = await requestFaucetDrip({
      url: "http://faucet.example",
      address: "0x1",
      logger: SILENT_LOGGER,
    })
    assert.equal(r, null)
  } finally {
    globalThis.fetch = origFetch
  }
})
