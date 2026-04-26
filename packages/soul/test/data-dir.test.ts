import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  resolveSoulDataDir,
  resolveClawMemDbPath,
  CLAW_MEM_DB_FILENAME,
} from "../src/data-dir.ts"

let scratch: string
let originalHome: string | undefined

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "coc-soul-data-dir-"))
  delete process.env.CLAW_MEM_DATA_DIR
  delete process.env.OPENCLAW_STATE_DIR
  // Pin HOME to scratch so the "default ~/.claw-mem" candidate resolves into
  // the temp tree instead of the dev box's real home.
  originalHome = process.env.HOME
  process.env.HOME = scratch
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  delete process.env.CLAW_MEM_DATA_DIR
  delete process.env.OPENCLAW_STATE_DIR
  if (originalHome !== undefined) process.env.HOME = originalHome
  else delete process.env.HOME
})

test("resolveSoulDataDir — config.dataDir wins over env vars and default", () => {
  const explicit = join(scratch, "via-config")
  process.env.CLAW_MEM_DATA_DIR = join(scratch, "via-env")
  process.env.OPENCLAW_STATE_DIR = join(scratch, "via-state")
  const dir = resolveSoulDataDir({ configDataDir: explicit })
  assert.equal(dir, explicit)
})

test("resolveSoulDataDir — env CLAW_MEM_DATA_DIR wins over OPENCLAW_STATE_DIR", () => {
  process.env.CLAW_MEM_DATA_DIR = join(scratch, "via-env")
  process.env.OPENCLAW_STATE_DIR = join(scratch, "via-state")
  const dir = resolveSoulDataDir()
  assert.equal(dir, join(scratch, "via-env"))
})

test("resolveSoulDataDir — falls through to OPENCLAW_STATE_DIR/coc-soul when env unset", () => {
  process.env.OPENCLAW_STATE_DIR = scratch
  const dir = resolveSoulDataDir()
  assert.equal(dir, join(scratch, "coc-soul"))
})

test("resolveSoulDataDir — throws actionable error mentioning the candidate chain", () => {
  // Use a guaranteed-unwritable path: /proc on Linux is read-only at the root.
  // Skip on non-Linux hosts where this assumption doesn't hold.
  if (process.platform !== "linux") return
  // Skip when running as root — root bypasses POSIX mode bits, so the
  // unwritable-path heuristic returns true and the throw never fires.
  // (Smoke-tested manually in EACCES sandboxes; the throw path is real.)
  const uid = (process as unknown as { getuid?: () => number }).getuid?.() ?? -1
  if (uid === 0) return

  process.env.CLAW_MEM_DATA_DIR = "/proc/coc-soul-cannot-write-here"
  process.env.OPENCLAW_STATE_DIR = "/proc/coc-soul-also-not-here"
  process.env.HOME = "/proc/coc-soul-no-home"
  assert.throws(
    () => resolveSoulDataDir({ configDataDir: "/proc/explicit-bad" }),
    /Could not find a writable directory/,
  )
})

test("resolveClawMemDbPath — returns null when no DB exists anywhere", () => {
  // env vars unset, default ~/.claw-mem/claw-mem.db likely doesn't exist on the
  // CI box either. (If it DOES, we still want to confirm the env-driven path
  // returns null when its specific file is absent.)
  process.env.CLAW_MEM_DATA_DIR = scratch
  const got = resolveClawMemDbPath()
  assert.equal(got, null)
})

test("resolveClawMemDbPath — finds DB via $CLAW_MEM_DATA_DIR", () => {
  const dataDir = join(scratch, "claw-mem")
  mkdirSync(dataDir, { recursive: true })
  const dbPath = join(dataDir, CLAW_MEM_DB_FILENAME)
  writeFileSync(dbPath, "")
  process.env.CLAW_MEM_DATA_DIR = dataDir
  const got = resolveClawMemDbPath()
  assert.equal(got, dbPath)
})

test("resolveClawMemDbPath — finds DB via $OPENCLAW_STATE_DIR/claw-mem", () => {
  const stateDir = scratch
  const dataDir = join(stateDir, "claw-mem")
  mkdirSync(dataDir, { recursive: true })
  const dbPath = join(dataDir, CLAW_MEM_DB_FILENAME)
  writeFileSync(dbPath, "")
  process.env.OPENCLAW_STATE_DIR = stateDir
  const got = resolveClawMemDbPath()
  assert.equal(got, dbPath)
})

test("resolveClawMemDbPath — explicit configDataDir wins", () => {
  const explicitDataDir = join(scratch, "explicit")
  mkdirSync(explicitDataDir, { recursive: true })
  const dbPath = join(explicitDataDir, CLAW_MEM_DB_FILENAME)
  writeFileSync(dbPath, "")
  // Also create one at env path to prove explicit beats env.
  const envDir = join(scratch, "via-env")
  mkdirSync(envDir, { recursive: true })
  writeFileSync(join(envDir, CLAW_MEM_DB_FILENAME), "")
  process.env.CLAW_MEM_DATA_DIR = envDir
  const got = resolveClawMemDbPath({ configDataDir: explicitDataDir })
  assert.equal(got, dbPath)
})
