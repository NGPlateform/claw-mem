// Tests for the SoulClient / DIDClient / ValidatorMonitor Bearer-token
// plumbing. We can't easily inspect an ethers FetchRequest from outside, so
// we verify behaviour indirectly by:
//   1. Constructing clients with rpcAuthToken — they should not throw.
//   2. Constructing clients without rpcAuthToken — same.
// More thorough end-to-end coverage lives in integration tests that hit a
// live admin-RPC-gated node.

import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("rpcAuthToken plumbing — constructors accept optional token", () => {
  const dummyKey = "0x" + "22".repeat(32)
  const dummyRpc = "http://127.0.0.1:0"
  const dummyAddr = "0x" + "33".repeat(20)

  it("SoulClient — token-less construction", async () => {
    const { SoulClient } = await import("../src/soul-client.ts")
    assert.doesNotThrow(() => new SoulClient(dummyRpc, dummyAddr, dummyKey))
  })

  it("SoulClient — with Bearer token", async () => {
    const { SoulClient } = await import("../src/soul-client.ts")
    assert.doesNotThrow(() => new SoulClient(dummyRpc, dummyAddr, dummyKey, "tok-123"))
  })

  it("DIDClient — token-less construction", async () => {
    const { DIDClient } = await import("../src/did-client.ts")
    assert.doesNotThrow(() => new DIDClient(dummyRpc, dummyAddr, dummyKey))
  })

  it("DIDClient — with Bearer token", async () => {
    const { DIDClient } = await import("../src/did-client.ts")
    assert.doesNotThrow(() => new DIDClient(dummyRpc, dummyAddr, dummyKey, "tok-abc"))
  })

  it("ValidatorMonitor — token-less construction", async () => {
    const { ValidatorMonitor } = await import("../src/validator-monitor.ts")
    assert.doesNotThrow(
      () =>
        new ValidatorMonitor({
          rpcUrl: dummyRpc,
          contractAddress: dummyAddr,
        }),
    )
  })

  it("ValidatorMonitor — with Bearer token", async () => {
    const { ValidatorMonitor } = await import("../src/validator-monitor.ts")
    assert.doesNotThrow(
      () =>
        new ValidatorMonitor({
          rpcUrl: dummyRpc,
          contractAddress: dummyAddr,
          rpcAuthToken: "tok-xyz",
        }),
    )
  })

  it("ValidatorMonitor.fromChainId resolves address from 88780 manifest", async () => {
    const { ValidatorMonitor } = await import("../src/validator-monitor.ts")
    const monitor = ValidatorMonitor.fromChainId(88780, dummyRpc, { rpcAuthToken: "tok-99" })
    assert.ok(monitor)
  })
})
