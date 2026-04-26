import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
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
let originalHome: string | undefined

beforeEach(() => {
  SILENT.warns.length = 0
  SILENT.infos.length = 0
  scratch = mkdtempSync(join(tmpdir(), "coc-node-wd-test-"))
  delete process.env.COC_NODE_DATA_DIR
  delete process.env.CLAW_MEM_DATA_DIR
  delete process.env.OPENCLAW_STATE_DIR
  // Pin HOME so the "default ~/.claw-mem/coc-node" candidate resolves into
  // the temp tree instead of the dev box's real home.
  originalHome = process.env.HOME
  process.env.HOME = scratch
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  delete process.env.COC_NODE_DATA_DIR
  delete process.env.CLAW_MEM_DATA_DIR
  delete process.env.OPENCLAW_STATE_DIR
  if (originalHome !== undefined) process.env.HOME = originalHome
  else delete process.env.HOME
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

// ── 1.2.0: dataDir alignment with claw-mem + soul ──

test("resolveWritableDataDir — uses CLAW_MEM_DATA_DIR/coc-node when only the shared env is set", () => {
  const sharedRoot = join(scratch, "claw-mem")
  process.env.CLAW_MEM_DATA_DIR = sharedRoot
  const got = resolveWritableDataDir({ logger })
  assert.equal(got, join(sharedRoot, "coc-node"))
  assert.equal(existsSync(got), true)
})

test("resolveWritableDataDir — COC_NODE_DATA_DIR wins over CLAW_MEM_DATA_DIR", () => {
  const nodeEnv = join(scratch, "via-node-env")
  const sharedEnv = join(scratch, "via-shared-env")
  process.env.COC_NODE_DATA_DIR = nodeEnv
  process.env.CLAW_MEM_DATA_DIR = sharedEnv
  const got = resolveWritableDataDir({ logger })
  assert.equal(got, nodeEnv)
})

test("resolveWritableDataDir — CLAW_MEM_DATA_DIR wins over OPENCLAW_STATE_DIR", () => {
  const sharedEnv = join(scratch, "via-shared-env")
  const stateDir = join(scratch, "openclaw-state")
  process.env.CLAW_MEM_DATA_DIR = sharedEnv
  process.env.OPENCLAW_STATE_DIR = stateDir
  const got = resolveWritableDataDir({ logger })
  assert.equal(got, join(sharedEnv, "coc-node"))
})

test("resolveWritableDataDir — default is ~/.claw-mem/coc-node when no env or candidate set", () => {
  const got = resolveWritableDataDir({ logger })
  assert.equal(got, join(scratch, ".claw-mem", "coc-node"))
})

test("resolveWritableDataDir — fresh install (no legacy nodes.json) lands at new default ~/.claw-mem/coc-node", () => {
  // No legacy file exists in scratch (= fresh install). New default wins.
  const got = resolveWritableDataDir({ logger })
  assert.equal(got, join(scratch, ".claw-mem", "coc-node"))
  // Sanity: no legacy-fallback warn was logged.
  assert.equal(SILENT.warns.find((m) => m.includes("legacy")), undefined)
})

test("resolveWritableDataDir — legacy ~/.chainofclaw is ranked below the new default even when populated", () => {
  // Pre-create a legacy registry. Verifies the priority ordering: the new
  // ~/.claw-mem/coc-node default still wins over a populated legacy dir,
  // because the new default sits earlier in the candidate chain.
  const legacyDir = join(scratch, ".chainofclaw")
  mkdirSync(legacyDir, { recursive: true })
  writeFileSync(join(legacyDir, "nodes.json"), "[]")
  const got = resolveWritableDataDir({ logger })
  assert.equal(got, join(scratch, ".claw-mem", "coc-node"))
})
