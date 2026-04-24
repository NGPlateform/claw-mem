// Smoke tests for P0 commands (status / doctor / init / backup configure)
// and config-persistence helpers. Spawns the CLI bin in subprocesses so we
// exercise the whole pipeline.

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

import {
  patchConfigFile,
  readConfigFile,
  getDotPath,
  setDotPath,
  coerceScalar,
} from "@chainofclaw/soul"

const BIN = join(import.meta.dirname, "..", "bin", "claw-mem")

function runCli(home: string, args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync(BIN, args, {
    env: { ...process.env, HOME: home, CLAW_MEM_DEBUG: "" },
    encoding: "utf-8",
    timeout: 30_000,
  })
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? -1 }
}

describe("config-persistence helpers", () => {
  let tmpDir: string
  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), "claw-cfg-test-")) })
  after(async () => { await rm(tmpDir, { recursive: true, force: true }) })

  it("patchConfigFile creates the file when missing", async () => {
    const path = join(tmpDir, "create.json")
    await patchConfigFile(path, (cfg) => { setDotPath(cfg, "node.port", 19000) })
    const onDisk = await readConfigFile(path)
    assert.deepEqual(onDisk, { node: { port: 19000 } })
  })

  it("setDotPath / getDotPath round-trip for nested keys", () => {
    const obj: Record<string, unknown> = {}
    setDotPath(obj, "a.b.c", "hello")
    setDotPath(obj, "a.b.d", 42)
    assert.equal(getDotPath(obj, "a.b.c"), "hello")
    assert.equal(getDotPath(obj, "a.b.d"), 42)
    assert.equal(getDotPath(obj, "a.b"), obj.a && (obj.a as Record<string, unknown>).b)
    assert.equal(getDotPath(obj, "missing.path"), undefined)
  })

  it("coerceScalar parses booleans, numbers, null, leaves strings alone", () => {
    assert.equal(coerceScalar("true"), true)
    assert.equal(coerceScalar("false"), false)
    assert.equal(coerceScalar("null"), null)
    assert.equal(coerceScalar("42"), 42)
    assert.equal(coerceScalar("3.14"), 3.14)
    assert.equal(coerceScalar("hello"), "hello")
    assert.equal(coerceScalar(""), "")
  })
})

describe("CLI: init --non-interactive", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-init-test-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("writes a default config when none exists", () => {
    const r = runCli(home, ["init", "--non-interactive"])
    assert.equal(r.code, 0, `stderr: ${r.stderr}`)
    assert.match(r.stdout, /Wrote default config/)
  })

  it("refuses to overwrite without --force", async () => {
    const r = runCli(home, ["init", "--non-interactive"])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /Config already exists/)
  })

  it("does overwrite with --force", () => {
    const r = runCli(home, ["init", "--non-interactive", "--force"])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /Wrote default config/)
  })
})

describe("CLI: status --json on a fresh home", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-status-test-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("emits a well-shaped JSON snapshot", () => {
    const r = runCli(home, ["status", "--json"])
    assert.equal(r.code, 0, `stderr: ${r.stderr}`)
    const snapshot = JSON.parse(r.stdout) as Record<string, unknown>
    assert.ok("memory" in snapshot)
    assert.ok("nodes" in snapshot)
    assert.ok("backup" in snapshot)
    assert.ok("bootstrap" in snapshot)
    assert.ok("storage" in snapshot)
    assert.deepEqual(snapshot.nodes, [])
    const memory = snapshot.memory as { observations: number; sessions: number }
    assert.equal(memory.observations, 0)
    assert.equal(memory.sessions, 0)
  })
})

describe("CLI: doctor --json on a fresh home", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-doc-test-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("returns an array with at least node-version + database + ports", () => {
    const r = runCli(home, ["doctor", "--json"])
    // doctor may exit non-zero if any check fails; we don't care about the exit
    // code, just the shape.
    const checks = JSON.parse(r.stdout) as Array<{ name: string; level: string; message: string }>
    assert.ok(Array.isArray(checks))
    assert.ok(checks.length >= 5)
    const names = checks.map((c) => c.name)
    assert.ok(names.includes("node-version"))
    assert.ok(names.includes("database"))
    assert.ok(names.includes("schema"))
    assert.ok(names.includes("coc-repo"))
    assert.ok(names.includes("disk-space"))
    // At least one port check
    assert.ok(names.some((n) => n.startsWith("port-")))
  })
})

describe("CLI: backup configure --non-interactive", () => {
  let home: string
  before(async () => {
    home = await mkdtemp(join(tmpdir(), "claw-bk-cfg-test-"))
    await mkdir(join(home, ".claw-mem"), { recursive: true })
  })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("generates a privateKey when none is set", () => {
    const r = runCli(home, ["backup", "configure", "--non-interactive"])
    assert.equal(r.code, 0, `stderr: ${r.stderr}`)
    assert.match(r.stdout, /Generated backup\.privateKey for 0x[0-9a-fA-F]{40}/)
  })

  it("is idempotent — second run does nothing because privateKey is already set", async () => {
    const r = runCli(home, ["backup", "configure", "--non-interactive"])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /already set/)
  })

  it("persisted privateKey survives across invocations", async () => {
    const cfgPath = join(home, ".claw-mem", "config.json")
    const persisted = await readConfigFile(cfgPath)
    const backup = persisted.backup as Record<string, unknown> | undefined
    assert.ok(backup)
    assert.match(backup!.privateKey as string, /^0x[0-9a-fA-F]{64}$/)
  })
})

describe("CLI: config get/set round-trip", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-cfg-cli-test-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("set then get from disk returns the value", () => {
    const setR = runCli(home, ["config", "set", "node.port", "19999"])
    assert.equal(setR.code, 0, `stderr: ${setR.stderr}`)
    const getR = runCli(home, ["config", "get", "node.port", "--from-disk"])
    assert.equal(getR.code, 0, `stderr: ${getR.stderr}`)
    assert.equal(getR.stdout.trim(), "19999")
  })
})

// Sanity: spawnSync should pick up our test bin and not the global PATH one
describe("CLI: --help mentions all top-level commands", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-help-test-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("lists status, doctor, init, mem, node, backup, bootstrap, config", () => {
    const r = runCli(home, ["--help"])
    assert.equal(r.code, 0)
    for (const cmd of ["status", "doctor", "init", "mem", "node", "backup", "bootstrap", "config"]) {
      assert.match(r.stdout, new RegExp(`\\b${cmd}\\b`), `--help should mention "${cmd}"`)
    }
  })
})

// Touch unused-import lint
void writeFile
