// Tests for the COC admin-RPC bearer-token helper module.

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

import {
  resolveRpcAuthToken,
  authedJsonHeaders,
  createAuthedProvider,
} from "../src/services/rpc-auth.ts"

describe("resolveRpcAuthToken", () => {
  let originalEnv: string | undefined
  beforeEach(() => {
    originalEnv = process.env.COC_RPC_AUTH_TOKEN
    delete process.env.COC_RPC_AUTH_TOKEN
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.COC_RPC_AUTH_TOKEN
    else process.env.COC_RPC_AUTH_TOKEN = originalEnv
  })

  it("returns the explicit token when one is passed", () => {
    assert.equal(resolveRpcAuthToken("explicit-tok"), "explicit-tok")
  })

  it("falls back to COC_RPC_AUTH_TOKEN env var", () => {
    process.env.COC_RPC_AUTH_TOKEN = "env-tok"
    assert.equal(resolveRpcAuthToken(), "env-tok")
  })

  it("explicit token wins over env var", () => {
    process.env.COC_RPC_AUTH_TOKEN = "env-tok"
    assert.equal(resolveRpcAuthToken("explicit-tok"), "explicit-tok")
  })

  it("returns undefined when neither is set", () => {
    assert.equal(resolveRpcAuthToken(), undefined)
  })

  it("treats empty-string env var as 'unset'", () => {
    process.env.COC_RPC_AUTH_TOKEN = ""
    assert.equal(resolveRpcAuthToken(), undefined)
  })
})

describe("authedJsonHeaders", () => {
  let originalEnv: string | undefined
  beforeEach(() => {
    originalEnv = process.env.COC_RPC_AUTH_TOKEN
    delete process.env.COC_RPC_AUTH_TOKEN
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.COC_RPC_AUTH_TOKEN
    else process.env.COC_RPC_AUTH_TOKEN = originalEnv
  })

  it("returns Content-Type only when no token resolved", () => {
    const headers = authedJsonHeaders()
    assert.deepEqual(headers, { "Content-Type": "application/json" })
  })

  it("adds Authorization: Bearer when explicit token given", () => {
    const headers = authedJsonHeaders("tok-1")
    assert.equal(headers["Authorization"], "Bearer tok-1")
    assert.equal(headers["Content-Type"], "application/json")
  })

  it("adds Authorization from env when no explicit token", () => {
    process.env.COC_RPC_AUTH_TOKEN = "env-2"
    const headers = authedJsonHeaders()
    assert.equal(headers["Authorization"], "Bearer env-2")
  })
})

describe("createAuthedProvider", () => {
  it("constructs a provider with no auth when no token", () => {
    const provider = createAuthedProvider("http://127.0.0.1:0")
    assert.ok(provider)
  })

  it("constructs a provider with bearer auth when token is given", () => {
    const provider = createAuthedProvider("http://127.0.0.1:0", "tok-x")
    assert.ok(provider)
  })
})
