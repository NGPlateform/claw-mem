// Verifies that bootstrapServicesSync layers user-persisted
// ~/.claw-mem/config.json under OpenClaw's pluginConfig (passed via
// configOverride). Regression test for the bug where `coc config set`
// writes were ignored when invoked via `openclaw coc ...`, because an
// empty `configOverride: {}` shadowed the disk config entirely.

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { bootstrapServicesSync } from "../src/cli/bootstrap-services.ts"
import type { PluginLogger } from "../src/types.ts"

function silentLogger(): PluginLogger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
}

describe("bootstrapServicesSync config merging", () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "claw-mem-bootstrap-"))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it("reads disk config when configOverride is an empty object", async () => {
    const configPath = join(tmp, "config.json")
    await writeFile(
      configPath,
      JSON.stringify({
        dataDir: tmp,
        backup: { rpcUrl: "http://disk.example:1111" },
      }),
    )

    const services = bootstrapServicesSync({
      configPath,
      configOverride: {},
      logger: silentLogger(),
    })

    try {
      assert.equal(services.config.backup.rpcUrl, "http://disk.example:1111")
    } finally {
      services.db.close()
    }
  })

  it("lets configOverride deep-merge over disk config", async () => {
    const configPath = join(tmp, "config.json")
    await writeFile(
      configPath,
      JSON.stringify({
        dataDir: tmp,
        backup: {
          rpcUrl: "http://disk.example:1111",
          ipfsUrl: "http://disk-ipfs.example:5001",
        },
      }),
    )

    const services = bootstrapServicesSync({
      configPath,
      configOverride: {
        backup: { rpcUrl: "http://override.example:2222" },
      },
      logger: silentLogger(),
    })

    try {
      // Overridden key wins.
      assert.equal(services.config.backup.rpcUrl, "http://override.example:2222")
      // Sibling untouched key survives from disk (merge, not replace).
      assert.equal(services.config.backup.ipfsUrl, "http://disk-ipfs.example:5001")
    } finally {
      services.db.close()
    }
  })

  it("still falls back to disk defaults when no override is supplied", async () => {
    const configPath = join(tmp, "config.json")
    await writeFile(
      configPath,
      JSON.stringify({
        dataDir: tmp,
        backup: { rpcUrl: "http://disk.example:1111" },
      }),
    )

    const services = bootstrapServicesSync({
      configPath,
      logger: silentLogger(),
    })

    try {
      assert.equal(services.config.backup.rpcUrl, "http://disk.example:1111")
    } finally {
      services.db.close()
    }
  })
})
