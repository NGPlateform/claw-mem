// Plugin isolation test — the whole reason claw-mem's activate() went thin.
//
// Activates all three OpenClaw skills (@chainofclaw/node, @chainofclaw/soul,
// @chainofclaw/claw-mem) against a mock PluginApi that records every
// registerTool / registerHook / registerCli call, then asserts:
//
//   1. No two plugins register a tool with the same `name`.
//   2. Each plugin's registerCli uses a distinct top-level command name.
//   3. mem-* tools only come from claw-mem, coc-node-* + coc-rpc-* only from
//      coc-node, and soul-* only from coc-soul.

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { activate as activateClawMem } from "../index.ts"
import { activate as activateNode } from "@chainofclaw/node"
import { activate as activateSoul } from "@chainofclaw/soul"

interface ToolCall { plugin: string; name: string }
interface HookCall { plugin: string; event: string }
interface CliCall { plugin: string; commands: string[] | undefined }

function silentLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }
}

function makeApi(
  pluginId: string,
  pluginConfig: Record<string, unknown>,
  recorder: { tools: ToolCall[]; hooks: HookCall[]; clis: CliCall[] },
) {
  return {
    pluginConfig,
    logger: silentLogger(),
    registerTool: (t: { name: string }) => {
      recorder.tools.push({ plugin: pluginId, name: t.name })
    },
    registerHook: (event: string, _handler: (...args: unknown[]) => Promise<void>) => {
      recorder.hooks.push({ plugin: pluginId, event })
    },
    on: (event: string, _handler: (...args: unknown[]) => Promise<unknown>) => {
      recorder.hooks.push({ plugin: pluginId, event })
    },
    // We deliberately do NOT invoke the registerCli callback — the callback
    // attaches Commander subcommands which would require a real program
    // instance. Recording the `opts.commands` tag is enough to verify the
    // three plugins claim distinct top-level command namespaces.
    registerCli: (
      _callback: (ctx: { program: unknown }) => Promise<void>,
      opts?: { commands: string[] },
    ) => {
      recorder.clis.push({ plugin: pluginId, commands: opts?.commands })
    },
  }
}

describe("three-plugin isolation — no tool / CLI / registration collisions", () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "claw-mem-isolation-"))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it("each plugin registers a distinct tool-id namespace", () => {
    const recorder = { tools: [] as ToolCall[], hooks: [] as HookCall[], clis: [] as CliCall[] }

    // coc-node plugin uses its own dataDir under the tmp tree.
    activateNode(makeApi("coc-node", { dataDir: join(tmp, "node") }, recorder))
    // coc-soul plugin — disable auto-backup + carrier so nothing schedules.
    activateSoul(
      makeApi(
        "coc-soul",
        {
          backup: {
            autoBackup: false,
            backupOnSessionEnd: false,
            carrier: { enabled: false },
          },
        },
        recorder,
      ),
    )
    // claw-mem plugin — its dataDir steers SQLite into tmp so the suite
    // doesn't touch the real ~/.claw-mem.
    activateClawMem(makeApi("claw-mem", { dataDir: join(tmp, "claw-mem") }, recorder))

    // ── 1. No duplicate tool names across plugins ──
    const seen = new Map<string, string>()
    for (const t of recorder.tools) {
      const prev = seen.get(t.name)
      assert.equal(prev, undefined, `Tool "${t.name}" registered by both ${prev} and ${t.plugin}`)
      seen.set(t.name, t.plugin)
    }

    // ── 2. Namespace discipline ──
    const byPlugin = new Map<string, string[]>()
    for (const t of recorder.tools) {
      const list = byPlugin.get(t.plugin) ?? []
      list.push(t.name)
      byPlugin.set(t.plugin, list)
    }

    const clawTools = byPlugin.get("claw-mem") ?? []
    const nodeTools = byPlugin.get("coc-node") ?? []
    const soulTools = byPlugin.get("coc-soul") ?? []

    assert.ok(clawTools.length > 0, "claw-mem registered at least one tool")
    assert.ok(nodeTools.length > 0, "coc-node registered at least one tool")
    assert.ok(soulTools.length > 0, "coc-soul registered at least one tool")

    for (const name of clawTools) {
      assert.ok(name.startsWith("mem-"), `claw-mem tool "${name}" should be mem-*`)
    }
    for (const name of nodeTools) {
      // coc-node registers coc-node-* and coc-rpc-*
      assert.ok(
        name.startsWith("coc-node-") || name.startsWith("coc-rpc-"),
        `coc-node tool "${name}" should be coc-node-* or coc-rpc-*`,
      )
    }
    for (const name of soulTools) {
      assert.ok(name.startsWith("soul-"), `coc-soul tool "${name}" should be soul-*`)
    }

    // ── 3. Each plugin claims a distinct top-level CLI namespace ──
    assert.equal(recorder.clis.length, 3, "all three plugins registered a CLI")
    const cliNames = recorder.clis.flatMap((c) => c.commands ?? [])
    const unique = new Set(cliNames)
    assert.equal(
      unique.size,
      cliNames.length,
      `CLI commands must be unique across plugins; got ${JSON.stringify(cliNames)}`,
    )
    assert.ok(cliNames.includes("coc"), "claw-mem mounts under `coc`")
    assert.ok(cliNames.includes("coc-node"), "coc-node mounts under `coc-node`")
    assert.ok(cliNames.includes("coc-soul"), "coc-soul mounts under `coc-soul`")
  })
})
