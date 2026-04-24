// Migrated from COC/extensions/coc-nodeops/src/{network-presets,node-types}.test.ts.

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  NETWORK_LABELS,
  NETWORK_PRESETS,
  NODE_TYPE_LABELS,
  NODE_TYPE_PRESETS,
  getNetworkPreset,
  isValidNetworkId,
  isValidNodeType,
  type NetworkId,
  type NodeType,
} from "../src/presets.ts"

describe("network-presets", () => {
  it("defines testnet, mainnet, local presets", () => {
    const ids: Array<Exclude<NetworkId, "custom">> = ["testnet", "mainnet", "local"]
    for (const id of ids) {
      const preset = NETWORK_PRESETS[id]
      assert.ok(preset, `Missing preset for ${id}`)
      assert.ok(typeof preset.chainId === "number")
      assert.ok(Array.isArray(preset.bootstrapPeers))
      assert.ok(typeof preset.rpcPort === "number")
    }
  })

  it("testnet has correct chainId and bootstrap peers", () => {
    const t = NETWORK_PRESETS.testnet
    assert.strictEqual(t.chainId, 18780)
    assert.ok(t.bootstrapPeers.length > 0)
    assert.ok(t.dhtBootstrapPeers.length > 0)
  })

  it("testnet points at real endpoints, not placeholder domains", () => {
    const t = NETWORK_PRESETS.testnet
    // Guard against regression to the fake testnet-boot{1,2}.coc.network
    // placeholders that never resolved.
    for (const p of t.bootstrapPeers) {
      assert.ok(!p.url.includes("testnet-boot"), `stale placeholder in peer url: ${p.url}`)
    }
    for (const p of t.dhtBootstrapPeers) {
      assert.ok(!p.address.includes("testnet-boot"), `stale placeholder in dht addr: ${p.address}`)
    }
  })

  it("testnet declares validators and prefund for fullnode joins", () => {
    const t = NETWORK_PRESETS.testnet
    // Needed so fullnodes can verify upstream-signed blocks.
    assert.ok(Array.isArray(t.validators) && t.validators.length >= 1)
    for (const v of t.validators) {
      assert.match(v, /^0x[0-9a-fA-F]{40}$/)
    }
    // Needed so genesis stateRoot matches upstream — otherwise every post-
    // genesis block fails stateRoot verification.
    assert.ok(Array.isArray(t.prefund) && (t.prefund?.length ?? 0) >= 1)
    for (const entry of t.prefund ?? []) {
      assert.match(entry.address, /^0x[0-9a-fA-F]{40}$/)
      assert.ok(typeof entry.balanceEth === "string")
    }
  })

  it("local has localhost defaults", () => {
    const l = NETWORK_PRESETS.local
    assert.strictEqual(l.chainId, 18780)
    assert.strictEqual(l.rpcPort, 18780)
    assert.strictEqual(l.p2pPort, 19780)
    assert.strictEqual(l.wirePort, 19781)
  })

  it("mainnet is placeholder with chainId 1", () => {
    const m = NETWORK_PRESETS.mainnet
    assert.strictEqual(m.chainId, 1)
    assert.strictEqual(m.bootstrapPeers.length, 0)
  })

  it("labels cover all network ids", () => {
    const allIds: NetworkId[] = ["testnet", "mainnet", "local", "custom"]
    for (const id of allIds) {
      assert.ok(NETWORK_LABELS[id], `Missing label for ${id}`)
    }
  })

  it("isValidNetworkId validates correctly", () => {
    assert.strictEqual(isValidNetworkId("testnet"), true)
    assert.strictEqual(isValidNetworkId("mainnet"), true)
    assert.strictEqual(isValidNetworkId("local"), true)
    assert.strictEqual(isValidNetworkId("custom"), true)
    assert.strictEqual(isValidNetworkId("devnet"), false)
    assert.strictEqual(isValidNetworkId(""), false)
  })

  it("getNetworkPreset returns correct preset", () => {
    const preset = getNetworkPreset("testnet")
    assert.strictEqual(preset.chainId, 18780)
  })
})

describe("node-types", () => {
  it("defines all 5 node types", () => {
    const types: NodeType[] = ["validator", "fullnode", "archive", "gateway", "dev"]
    for (const t of types) {
      assert.ok(NODE_TYPE_PRESETS[t], `Missing preset for ${t}`)
      assert.ok(NODE_TYPE_LABELS[t], `Missing label for ${t}`)
      assert.ok(NODE_TYPE_PRESETS[t].description.length > 0)
      assert.ok(NODE_TYPE_PRESETS[t].services.length > 0)
    }
  })

  it("validator enables BFT, wire, DHT, snap sync", () => {
    const v = NODE_TYPE_PRESETS.validator
    assert.strictEqual(v.configOverrides.enableBft, true)
    assert.strictEqual(v.configOverrides.enableWireProtocol, true)
    assert.strictEqual(v.configOverrides.enableDht, true)
    assert.strictEqual(v.configOverrides.enableSnapSync, true)
    assert.deepStrictEqual(v.services, ["node", "agent"])
  })

  it("fullnode disables BFT, clears validators", () => {
    const f = NODE_TYPE_PRESETS.fullnode
    assert.strictEqual(f.configOverrides.enableBft, false)
    assert.deepStrictEqual(f.configOverrides.validators, [])
    assert.deepStrictEqual(f.services, ["node"])
  })

  it("archive disables pruning", () => {
    const a = NODE_TYPE_PRESETS.archive
    const storage = a.configOverrides.storage as Record<string, unknown>
    assert.strictEqual(storage.enablePruning, false)
  })

  it("gateway uses memory backend and disables all protocols", () => {
    const g = NODE_TYPE_PRESETS.gateway
    const storage = g.configOverrides.storage as Record<string, unknown>
    assert.strictEqual(storage.backend, "memory")
    assert.strictEqual(g.configOverrides.enableBft, false)
    assert.strictEqual(g.configOverrides.enableWireProtocol, false)
    assert.strictEqual(g.configOverrides.enableDht, false)
  })

  it("dev uses single-node validator with test prefund", () => {
    const d = NODE_TYPE_PRESETS.dev
    assert.deepStrictEqual(d.configOverrides.validators, ["dev-node"])
    const prefund = d.configOverrides.prefund as Array<{ address: string }>
    assert.ok(prefund.length >= 3)
    assert.ok(prefund[0].address.startsWith("0x"))
  })

  it("isValidNodeType validates correctly", () => {
    assert.strictEqual(isValidNodeType("validator"), true)
    assert.strictEqual(isValidNodeType("fullnode"), true)
    assert.strictEqual(isValidNodeType("archive"), true)
    assert.strictEqual(isValidNodeType("gateway"), true)
    assert.strictEqual(isValidNodeType("dev"), true)
    assert.strictEqual(isValidNodeType("unknown"), false)
    assert.strictEqual(isValidNodeType(""), false)
  })
})
