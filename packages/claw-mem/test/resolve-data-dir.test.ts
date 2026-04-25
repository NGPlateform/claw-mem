import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, chmodSync, rmSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"

import { ClawMemConfigSchema, resolveDataDir } from "../src/config.ts"

const ENV_KEYS = ["CLAW_MEM_DATA_DIR", "OPENCLAW_STATE_DIR"] as const

function withEnv<T>(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => T): T {
  const saved = new Map<string, string | undefined>()
  for (const k of ENV_KEYS) saved.set(k, process.env[k])
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    return fn()
  } finally {
    for (const [k, v] of saved.entries()) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

function tempWritableDir(): string {
  return mkdtempSync(join(tmpdir(), "claw-mem-resolve-"))
}

test("resolveDataDir — explicit config.dataDir wins over env vars", () => {
  const explicit = tempWritableDir()
  const envOverride = tempWritableDir()
  const stateDir = tempWritableDir()
  const config = ClawMemConfigSchema.parse({ dataDir: explicit })
  const resolved = withEnv({ CLAW_MEM_DATA_DIR: envOverride, OPENCLAW_STATE_DIR: stateDir }, () => resolveDataDir(config))
  assert.equal(resolved, explicit)
  rmSync(explicit, { recursive: true, force: true })
  rmSync(envOverride, { recursive: true, force: true })
  rmSync(stateDir, { recursive: true, force: true })
})

test("resolveDataDir — CLAW_MEM_DATA_DIR env wins when no explicit config", () => {
  const envOverride = tempWritableDir()
  const stateDir = tempWritableDir()
  const config = ClawMemConfigSchema.parse({})
  const resolved = withEnv({ CLAW_MEM_DATA_DIR: envOverride, OPENCLAW_STATE_DIR: stateDir }, () => resolveDataDir(config))
  assert.equal(resolved, envOverride)
  rmSync(envOverride, { recursive: true, force: true })
  rmSync(stateDir, { recursive: true, force: true })
})

test("resolveDataDir — falls through to OPENCLAW_STATE_DIR when env override is unwritable", () => {
  const stateDir = tempWritableDir()
  const config = ClawMemConfigSchema.parse({})
  const resolved = withEnv(
    { CLAW_MEM_DATA_DIR: "/nonexistent/no/way/this/works", OPENCLAW_STATE_DIR: stateDir },
    () => resolveDataDir(config),
  )
  assert.equal(resolved, join(stateDir, "claw-mem"))
  rmSync(stateDir, { recursive: true, force: true })
})

test("resolveDataDir — uses OPENCLAW_STATE_DIR/claw-mem when only that is set", () => {
  const stateDir = tempWritableDir()
  const config = ClawMemConfigSchema.parse({})
  const resolved = withEnv({ CLAW_MEM_DATA_DIR: undefined, OPENCLAW_STATE_DIR: stateDir }, () => resolveDataDir(config))
  assert.equal(resolved, join(stateDir, "claw-mem"))
  rmSync(stateDir, { recursive: true, force: true })
})

test("resolveDataDir — unwritable OPENCLAW_STATE_DIR falls back to default ~/.claw-mem", () => {
  const config = ClawMemConfigSchema.parse({})
  const resolved = withEnv(
    { CLAW_MEM_DATA_DIR: undefined, OPENCLAW_STATE_DIR: "/nonexistent/path/that/cannot/exist" },
    () => resolveDataDir(config),
  )
  assert.equal(resolved, join(homedir(), ".claw-mem"))
})

test("resolveDataDir — default home path when nothing is set", () => {
  const config = ClawMemConfigSchema.parse({})
  const resolved = withEnv({ CLAW_MEM_DATA_DIR: undefined, OPENCLAW_STATE_DIR: undefined }, () => resolveDataDir(config))
  assert.equal(resolved, join(homedir(), ".claw-mem"))
})
