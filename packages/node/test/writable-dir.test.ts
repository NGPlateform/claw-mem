import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  resolveWritableDataDir,
  isPathWritable,
} from "../src/writable-dir.ts"

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
  scratch = mkdtempSync(join(tmpdir(), "coc-node-wd-test-"))
  delete process.env.COC_NODE_DATA_DIR
  delete process.env.OPENCLAW_STATE_DIR
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  delete process.env.COC_NODE_DATA_DIR
  delete process.env.OPENCLAW_STATE_DIR
})

test("isPathWritable — writable scratch dir returns true", () => {
  assert.equal(isPathWritable(scratch), true)
})

test("isPathWritable — nonexistent path under writable parent returns true", () => {
  assert.equal(isPathWritable(join(scratch, "future", "deep", "leaf.json")), true)
})

test("resolveWritableDataDir — uses candidate when writable", () => {
  const candidate = join(scratch, "my-data")
  const got = resolveWritableDataDir({ candidate, logger })
  assert.equal(got, candidate)
  assert.equal(existsSync(candidate), true)
})

test("resolveWritableDataDir — env var when no candidate", () => {
  const envPath = join(scratch, "via-env")
  process.env.COC_NODE_DATA_DIR = envPath
  const got = resolveWritableDataDir({ logger })
  assert.equal(got, envPath)
})

test("resolveWritableDataDir — candidate wins over env var", () => {
  const cand = join(scratch, "cand")
  process.env.COC_NODE_DATA_DIR = join(scratch, "via-env")
  const got = resolveWritableDataDir({ candidate: cand, logger })
  assert.equal(got, cand)
})

test("resolveWritableDataDir — uses OPENCLAW_STATE_DIR when neither candidate nor env set", () => {
  const stateDir = join(scratch, "openclaw-state")
  process.env.OPENCLAW_STATE_DIR = stateDir
  const got = resolveWritableDataDir({ logger })
  assert.equal(got, join(stateDir, "coc-node"))
  assert.equal(existsSync(got), true)
  assert.ok(SILENT.infos.some((m) => m.includes("OpenClaw state dir")), "info logged")
})

test("resolveWritableDataDir — env var wins over OPENCLAW_STATE_DIR", () => {
  const envPath = join(scratch, "via-env-dir")
  const stateDir = join(scratch, "openclaw-state")
  process.env.COC_NODE_DATA_DIR = envPath
  process.env.OPENCLAW_STATE_DIR = stateDir
  const got = resolveWritableDataDir({ logger })
  assert.equal(got, envPath)
})

test("resolveWritableDataDir — when candidate's mkdir fails (ENOTDIR), advances to OpenClaw state dir", () => {
  const fileBlocker = join(scratch, "blocker")
  writeFileSync(fileBlocker, "")
  const candidate = join(fileBlocker, "child", "dir")
  const stateDir = join(scratch, "openclaw-state")
  process.env.OPENCLAW_STATE_DIR = stateDir
  const got = resolveWritableDataDir({ candidate, logger })
  assert.equal(got, join(stateDir, "coc-node"))
  assert.ok(SILENT.warns.some((m) => m.includes("trying next candidate")), "warn while traversing")
})
