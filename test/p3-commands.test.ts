// Smoke tests for the P3 command groups (carrier / guardian / recovery / did
// / additional backup subcommands). Most of these commands hit a real chain,
// so we only verify that the commands register correctly and refuse to run
// when backup isn't configured.

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

const BIN = join(import.meta.dirname, "..", "bin", "claw-mem")

function runCli(home: string, args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync(BIN, args, {
    env: { ...process.env, HOME: home, CLAW_MEM_DEBUG: "" },
    encoding: "utf-8",
    timeout: 30_000,
  })
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? -1 }
}

describe("CLI: --help lists the new command groups", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-p3-help-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("includes carrier / guardian / recovery / did", () => {
    const r = runCli(home, ["--help"])
    assert.equal(r.code, 0)
    for (const cmd of ["carrier", "guardian", "recovery", "did"]) {
      assert.match(r.stdout, new RegExp(`\\b${cmd}\\b`), `--help should mention "${cmd}"`)
    }
  })
})

describe("CLI: carrier subcommands", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-p3-carrier-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("status reports daemon disabled by default", () => {
    const r = runCli(home, ["carrier", "status"])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /enabled: false/)
    assert.match(r.stdout, /running: false/)
  })

  it("--help lists register / submit-request / start / stop / status / availability / info / deregister / list", () => {
    const r = runCli(home, ["carrier", "--help"])
    assert.equal(r.code, 0)
    for (const sub of ["register", "submit-request", "start", "stop", "status", "availability", "info", "deregister", "list"]) {
      assert.match(r.stdout, new RegExp(`\\b${sub}\\b`))
    }
  })

  it("list fails fast when backup not configured", () => {
    const r = runCli(home, ["carrier", "list"])
    assert.notEqual(r.code, 0)
    assert.match(r.stderr + r.stdout, /Backup not configured|backup configure/i)
  })
})

describe("CLI: bootstrap prod (non-interactive)", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-prod-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("fails fast when required flags are missing", () => {
    const r = runCli(home, ["bootstrap", "prod", "--non-interactive"])
    assert.notEqual(r.code, 0)
    assert.match(r.stderr + r.stdout, /missing required flags.*rpc.*poseManager.*soulRegistry.*privateKey/i)
  })

  it("rejects malformed addresses", () => {
    const r = runCli(home, [
      "bootstrap", "prod", "--non-interactive",
      "--rpc", "http://127.0.0.1:1",
      "--pose-manager", "not-an-address",
      "--soul-registry", "0x" + "a".repeat(40),
      "--private-key", "0x" + "1".repeat(64),
    ])
    assert.notEqual(r.code, 0)
    assert.match(r.stderr + r.stdout, /pose-manager.*not a valid 0x address/i)
  })

  it("--help mentions all the flags", () => {
    const r = runCli(home, ["bootstrap", "prod", "--help"])
    assert.equal(r.code, 0)
    for (const flag of ["--rpc", "--pose-manager", "--soul-registry", "--did-registry", "--cid-registry", "--private-key", "--non-interactive"]) {
      assert.match(r.stdout, new RegExp(flag.replace(/-/g, "\\-")))
    }
  })
})

describe("CLI: guardian subcommands", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-p3-guardian-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("--help lists initiate / approve / status / add / remove / list", () => {
    const r = runCli(home, ["guardian", "--help"])
    assert.equal(r.code, 0)
    for (const sub of ["initiate", "approve", "status", "add", "remove", "list"]) {
      assert.match(r.stdout, new RegExp(`\\b${sub}\\b`))
    }
  })

  it("approve fails fast when backup not configured", () => {
    const r = runCli(home, ["guardian", "approve", "--request-id", "0x" + "1".repeat(64)])
    assert.notEqual(r.code, 0, "expected non-zero exit when backup not configured")
    assert.match(r.stderr + r.stdout, /Backup not configured|backup configure/i)
  })
})

describe("CLI: recovery subcommands", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-p3-recovery-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("--help lists initiate / approve / complete / cancel / status", () => {
    const r = runCli(home, ["recovery", "--help"])
    assert.equal(r.code, 0)
    for (const sub of ["initiate", "approve", "complete", "cancel", "status"]) {
      assert.match(r.stdout, new RegExp(`\\b${sub}\\b`))
    }
  })
})

describe("CLI: did subcommands", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-p3-did-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("--help lists 14 DID operations", () => {
    const r = runCli(home, ["did", "--help"])
    assert.equal(r.code, 0)
    const subs = [
      "add-key", "revoke-key", "delegate", "revoke-delegation", "keys", "delegations",
      "update-doc", "revoke-all-delegations", "anchor-credential", "revoke-credential",
      "record-lineage", "update-capabilities", "create-ephemeral", "deactivate-ephemeral",
    ]
    for (const sub of subs) {
      assert.match(r.stdout, new RegExp(`\\b${sub}\\b`), `did --help should mention "${sub}"`)
    }
  })

  it("operations fail fast when didRegistryAddress not set", () => {
    const r = runCli(home, ["did", "keys", "--agent-id", "0x" + "1".repeat(64)])
    assert.notEqual(r.code, 0)
    assert.match(r.stderr + r.stdout, /didRegistryAddress/i)
  })
})

describe("CLI: backup new subcommands", () => {
  let home: string
  before(async () => { home = await mkdtemp(join(tmpdir(), "claw-p3-backup-")) })
  after(async () => { await rm(home, { recursive: true, force: true }) })

  it("--help lists init / register / heartbeat / configure-resurrection / resurrection", () => {
    const r = runCli(home, ["backup", "--help"])
    assert.equal(r.code, 0)
    for (const sub of ["init", "register", "heartbeat", "configure-resurrection", "resurrection"]) {
      assert.match(r.stdout, new RegExp(`\\b${sub}\\b`))
    }
  })

  it("resurrection --help lists start/status/confirm/complete/cancel", () => {
    const r = runCli(home, ["backup", "resurrection", "--help"])
    assert.equal(r.code, 0)
    for (const sub of ["start", "status", "confirm", "complete", "cancel"]) {
      assert.match(r.stdout, new RegExp(`\\b${sub}\\b`))
    }
  })
})
