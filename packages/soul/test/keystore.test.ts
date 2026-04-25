import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ensureAgentKey } from "../src/keystore.ts"

const SILENT: { warns: string[]; infos: string[] } = { warns: [], infos: [] }
const logger = {
  info: (m: string) => SILENT.infos.push(m),
  warn: (m: string) => SILENT.warns.push(m),
  error: () => {},
}

let scratch: string

beforeEach(() => {
  SILENT.warns.length = 0
  SILENT.infos.length = 0
  scratch = mkdtempSync(join(tmpdir(), "coc-soul-keystore-test-"))
  delete process.env.COC_SOUL_KEYSTORE_PATH
  delete process.env.OPENCLAW_STATE_DIR
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  delete process.env.COC_SOUL_KEYSTORE_PATH
  delete process.env.OPENCLAW_STATE_DIR
})

test("keystore — generates a key when none exists, writes mode 0o600", () => {
  const keyPath = join(scratch, "keys", "agent.key")
  const k = ensureAgentKey({ keyPath, logger })
  assert.equal(k.generated, true)
  assert.equal(k.keyPath, keyPath)
  assert.match(k.privateKey, /^0x[0-9a-f]{64}$/i)
  assert.match(k.address, /^0x[0-9a-fA-F]{40}$/)
  assert.equal(existsSync(keyPath), true)
  const mode = statSync(keyPath).mode & 0o777
  assert.equal(mode, 0o600)
})

test("keystore — reuses existing key on second call (generated=false)", () => {
  const keyPath = join(scratch, "keys", "agent.key")
  const first = ensureAgentKey({ keyPath, logger })
  const second = ensureAgentKey({ keyPath, logger })
  assert.equal(first.privateKey, second.privateKey)
  assert.equal(second.generated, false)
})

test("keystore — env var COC_SOUL_KEYSTORE_PATH wins over OpenClaw state dir + default", () => {
  const envPath = join(scratch, "via-env", "agent.key")
  process.env.COC_SOUL_KEYSTORE_PATH = envPath
  process.env.OPENCLAW_STATE_DIR = join(scratch, "openclaw")
  const k = ensureAgentKey({ logger })
  assert.equal(k.keyPath, envPath)
})

test("keystore — explicit keyPath option wins over env var", () => {
  const envPath = join(scratch, "from-env", "agent.key")
  const optPath = join(scratch, "from-opt", "agent.key")
  process.env.COC_SOUL_KEYSTORE_PATH = envPath
  const k = ensureAgentKey({ keyPath: optPath, logger })
  assert.equal(k.keyPath, optPath)
})

test("keystore — uses OPENCLAW_STATE_DIR when no explicit/env path", () => {
  const stateDir = join(scratch, "openclaw-state")
  process.env.OPENCLAW_STATE_DIR = stateDir
  const k = ensureAgentKey({ logger })
  assert.equal(k.keyPath, join(stateDir, "coc-soul", "keys", "agent.key"))
  assert.equal(existsSync(k.keyPath), true)
})

test("keystore — when explicit keyPath fails, advances to next candidate", () => {
  // Block explicit by putting a regular file in the path so mkdir fails ENOTDIR.
  const blocker = join(scratch, "blocker")
  writeFileSync(blocker, "")
  const explicitBad = join(blocker, "child", "agent.key")
  // Set OPENCLAW_STATE_DIR to a writable place so we have a clear next-step.
  const stateDir = join(scratch, "openclaw-state")
  process.env.OPENCLAW_STATE_DIR = stateDir
  const k = ensureAgentKey({ keyPath: explicitBad, logger })
  assert.equal(k.keyPath, join(stateDir, "coc-soul", "keys", "agent.key"))
  assert.ok(SILENT.warns.some((m) => m.includes("trying next candidate")), "warn while traversing")
})
