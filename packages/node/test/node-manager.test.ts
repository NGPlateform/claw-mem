// Adapted from COC/extensions/coc-nodeops/src/runtime/node-manager.test.ts.
// NodeManager now talks to a NodeRegistry port; this suite uses the default
// JSON-file-backed registry shipped with @chainofclaw/node.

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { JsonNodeRegistry } from "../src/json-registry.ts"
import { NodeManager } from "../src/node-manager.ts"
import { ProcessManager } from "../src/process-manager.ts"
import type { Logger, NodeLifecycleConfig } from "../src/types.ts"

function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }
}

function defaultLifecycleConfig(): NodeLifecycleConfig {
  return {
    node: {
      enabled: true,
      runtimeDir: undefined,
      defaultType: "dev",
      defaultNetwork: "local",
      port: 18780,
      bind: "127.0.0.1",
      agent: { enabled: true, intervalMs: 60_000, batchSize: 5, sampleSize: 2 },
      relayer: { enabled: false, intervalMs: 60_000 },
      autoAdvertiseStorage: true,
    },
    storage: {
      quotaBytes: 268_435_456,
      advertisedBytes: 268_435_456,
      reservedBytes: 268_435_456,
      enforceQuota: true,
      reserveFile: ".quota.reserved",
    },
    bootstrap: {},
  }
}

interface Harness {
  tempDir: string
  registry: JsonNodeRegistry
  manager: NodeManager
}

async function buildHarness(): Promise<Harness> {
  const tempDir = await mkdtemp(join(tmpdir(), "claw-nm-test-"))
  const config = defaultLifecycleConfig()
  const registry = new JsonNodeRegistry({ baseDir: tempDir })
  const processManager = new ProcessManager(silentLogger())
  const manager = new NodeManager({
    nodeRegistry: registry,
    processManager,
    config,
    logger: silentLogger(),
    baseDir: tempDir,
  })
  await manager.init()
  return { tempDir, registry, manager }
}

async function teardown(h: Harness): Promise<void> {
  await rm(h.tempDir, { recursive: true, force: true })
}

describe("NodeManager", () => {
  let h: Harness

  beforeEach(async () => { h = await buildHarness() })
  afterEach(async () => { await teardown(h) })

  it("starts with empty node list", () => {
    assert.strictEqual(h.manager.listNodes().length, 0)
  })

  it("install creates a node and persists it", async () => {
    const result = await h.manager.install({ type: "dev", network: "local", name: "test-1" })
    assert.equal(result.name, "test-1")
    assert.equal(result.type, "dev")
    assert.equal(result.advertisedBytes, 268_435_456)
    assert.deepEqual(result.services, ["node"])

    const all = h.manager.listNodes()
    assert.equal(all.length, 1)
    assert.equal(h.manager.getNode("test-1")?.type, "dev")
  })

  it("install rejects duplicate names", async () => {
    await h.manager.install({ type: "dev", network: "local", name: "dup" })
    await assert.rejects(
      h.manager.install({ type: "dev", network: "local", name: "dup" }),
      /already exists/,
    )
  })

  it("install rejects invalid names", async () => {
    await assert.rejects(
      h.manager.install({ type: "dev", network: "local", name: "bad name with spaces" }),
      /alphanumeric/,
    )
  })

  it("install respects custom advertisedBytes", async () => {
    const result = await h.manager.install({
      type: "dev",
      network: "local",
      name: "big",
      advertisedBytes: 536_870_912,
    })
    assert.equal(result.advertisedBytes, 536_870_912)
    assert.equal(h.manager.getNode("big")?.advertisedBytes, 536_870_912)
  })

  it("install writes node-config.json with advertisedStorageBytes", async () => {
    await h.manager.install({ type: "dev", network: "local", name: "cfg-test" })
    const cfg = await h.manager.getNodeConfig("cfg-test")
    assert.equal(cfg.advertisedStorageBytes, 268_435_456)
    assert.equal(cfg.chainId, 18780)
    assert.ok(typeof cfg.nodeId === "string")
    assert.ok((cfg.nodeId as string).startsWith("0x"))  // ETH-derived
  })

  it("install merges configOverrides into node-config.json", async () => {
    await h.manager.install({
      type: "dev",
      network: "local",
      name: "ovr",
      configOverrides: { poseManagerAddress: "0xPOSE", chainId: 31337 },
    })
    const cfg = await h.manager.getNodeConfig("ovr")
    assert.equal(cfg.poseManagerAddress, "0xPOSE")
    assert.equal(cfg.chainId, 31337)  // override wins
  })

  it("removes a node and deletes data dir", async () => {
    const result = await h.manager.install({ type: "dev", network: "local", name: "to-remove" })
    const removed = await h.manager.removeNode(result.name, true)
    assert.strictEqual(removed, true)
    assert.strictEqual(h.manager.listNodes().length, 0)
    assert.strictEqual(h.manager.getNode("to-remove"), undefined)
  })

  it("removeNode returns false for non-existent node", async () => {
    const removed = await h.manager.removeNode("ghost", false)
    assert.strictEqual(removed, false)
  })

  it("nodeDir returns the canonical path", () => {
    const dir = h.manager.nodeDir("my-node")
    assert.ok(dir.endsWith("/nodes/my-node"))
  })

  it("persists across NodeManager instances (via JsonNodeRegistry)", async () => {
    await h.manager.install({ type: "validator", network: "testnet", name: "persist-test" })

    const config = defaultLifecycleConfig()
    const registry2 = new JsonNodeRegistry({ baseDir: h.tempDir })
    const manager2 = new NodeManager({
      nodeRegistry: registry2,
      processManager: new ProcessManager(silentLogger()),
      config,
      logger: silentLogger(),
      baseDir: h.tempDir,
    })
    await manager2.init()

    assert.equal(manager2.listNodes().length, 1)
    assert.equal(manager2.getNode("persist-test")?.type, "validator")
  })

  it("getNodeStatus throws for non-existent node", async () => {
    await assert.rejects(() => h.manager.getNodeStatus("ghost"), /not found/i)
  })

  it("getNodeConfig throws for non-existent node", async () => {
    await assert.rejects(() => h.manager.getNodeConfig("ghost"), /not found/i)
  })

  it("multiple nodes coexist", async () => {
    await h.manager.install({ type: "dev", network: "local", name: "node-a" })
    await h.manager.install({ type: "validator", network: "testnet", name: "node-b" })
    assert.strictEqual(h.manager.listNodes().length, 2)
    assert.strictEqual(h.manager.getNode("node-a")?.type, "dev")
    assert.strictEqual(h.manager.getNode("node-b")?.type, "validator")
  })

  it("auto-generates node names when omitted", async () => {
    const r1 = await h.manager.install({ type: "validator", network: "local" })
    assert.match(r1.name, /^val-\d+$/)
    const r2 = await h.manager.install({ type: "fullnode", network: "local" })
    assert.match(r2.name, /^fn-\d+$/)
  })
})
