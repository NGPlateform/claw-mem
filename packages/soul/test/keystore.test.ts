import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, chmodSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ensureAgentKey, FALLBACK_KEYSTORE_PATH } from "../src/keystore.ts"

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
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  delete process.env.COC_SOUL_KEYSTORE_PATH
  rmSync(FALLBACK_KEYSTORE_PATH, { force: true })
})

test("keystore — generates a key when none exists, writes mode 0o600", () => {
  const keyPath = join(scratch, "keys", "agent.key")
  const k = ensureAgentKey({ keyPath, logger })
  assert.equal(k.generated, true)
  assert.equal(k.keyPath, keyPath)
  assert.match(k.privateKey, /^0x[0-9a-f]{64}$/i)
  assert.match(k.address, /^0x[0-9a-fA-F]{40}$/)
  assert.equal(existsSync(keyPath), true)
  // file mode masked to 0o777 should be 0o600
  const mode = statSync(keyPath).mode & 0o777
  assert.equal(mode, 0o600)
})

test("keystore — reuses existing key on second call (generated=false)", () => {
  const keyPath = join(scratch, "keys", "agent.key")
  const first = ensureAgentKey({ keyPath, logger })
  const second = ensureAgentKey({ keyPath, logger })
  assert.equal(first.privateKey, second.privateKey)
  assert.equal(first.address, second.address)
  assert.equal(second.generated, false)
})

test("keystore — env var COC_SOUL_KEYSTORE_PATH wins over default", () => {
  const envPath = join(scratch, "via-env", "agent.key")
  process.env.COC_SOUL_KEYSTORE_PATH = envPath
  const k = ensureAgentKey({ logger })
  assert.equal(k.keyPath, envPath)
  assert.equal(existsSync(envPath), true)
})

test("keystore — explicit keyPath option wins over env var", () => {
  const envPath = join(scratch, "from-env", "agent.key")
  const optPath = join(scratch, "from-opt", "agent.key")
  process.env.COC_SOUL_KEYSTORE_PATH = envPath
  const k = ensureAgentKey({ keyPath: optPath, logger })
  assert.equal(k.keyPath, optPath)
  assert.equal(existsSync(optPath), true)
  assert.equal(existsSync(envPath), false)
})

test("keystore — falls back to tmpdir when explicit path is unwritable", () => {
  // Make a read-only parent dir so explicit keyPath fails.
  const blockedParent = join(scratch, "ro")
  // Create the parent first then strip write permission.
  writeFileSync(join(scratch, "marker"), "")
  // Linux won't let us trivially block dir creation — use a path under a
  // file (e.g. treat a regular file as a "directory" parent → ENOTDIR).
  const badPath = join(scratch, "marker", "agent.key")
  const k = ensureAgentKey({ keyPath: badPath, logger })
  assert.equal(k.keyPath, FALLBACK_KEYSTORE_PATH)
  assert.equal(existsSync(FALLBACK_KEYSTORE_PATH), true)
  assert.ok(SILENT.warns.some((m) => m.includes("retrying at")), "warn about fallback")
  // Cleanup the read-only dir so afterEach can rmSync.
  try { chmodSync(blockedParent, 0o700) } catch { /* may not exist */ }
})
