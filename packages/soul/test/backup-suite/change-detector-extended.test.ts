import { describe, it, before, after} from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { detectChanges } from "../../src/backup/change-detector.ts"
import type { CocBackupConfig } from "../../src/backup-config-schema.ts"

const defaultConfig: CocBackupConfig = {
  enabled: true,
  rpcUrl: "http://localhost:18780",
  ipfsUrl: "http://localhost:18790",
  contractAddress: "0x" + "a".repeat(40),
  privateKey: "0x" + "b".repeat(64),
  dataDir: "~/.openclaw",
  autoBackupEnabled: true,
  autoBackupIntervalMs: 3600000,
  encryptMemory: false,
  maxIncrementalChain: 10,
  backupOnSessionEnd: true,
  semanticSnapshot: {
    enabled: false,
    tokenBudget: 0,
    maxObservations: 0,
    maxSummaries: 0,
    claudeMemDbPath: "",
  },
  carrier: {
    enabled: false,
    workDir: "/tmp/coc-resurrections",
    watchedAgents: [],
    pendingRequestIds: [],
    pollIntervalMs: 60_000,
    readinessTimeoutMs: 86_400_000,
    readinessPollMs: 30_000,
  },
  categories: {
    identity: true,
    config: true,
    memory: true,
    chat: true,
    workspace: true,
    database: true,
  },
}

describe("change-detector extended rules", () => {
  let tempDir: string

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coc-detector-test-"))
  })

  after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("classifies SQLite memory index as database category", async () => {
    await mkdir(join(tempDir, "memory"), { recursive: true })
    await writeFile(join(tempDir, "memory", "default.sqlite"), "sqlite data")

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const sqliteFile = changes.added.find((f) => f.relativePath === "memory/default.sqlite")
    assert.ok(sqliteFile !== undefined)
    assert.equal(sqliteFile!.category, "database")
    assert.equal(sqliteFile!.encrypted, true)
  })

  it("classifies LanceDB files as database category", async () => {
    await mkdir(join(tempDir, "memory", "lancedb"), { recursive: true })
    await writeFile(join(tempDir, "memory", "lancedb", "vectors.lance"), "lance data")

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const lanceFile = changes.added.find((f) => f.relativePath === "memory/lancedb/vectors.lance")
    assert.ok(lanceFile !== undefined)
    assert.equal(lanceFile!.category, "database")
    assert.equal(lanceFile!.encrypted, true)
  })

  it("classifies openclaw.json as config category (encrypted)", async () => {
    await writeFile(join(tempDir, "openclaw.json"), '{"gateway": {}}')

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const configFile = changes.added.find((f) => f.relativePath === "openclaw.json")
    assert.ok(configFile !== undefined)
    assert.equal(configFile!.category, "config")
    assert.equal(configFile!.encrypted, true)
  })

  it("classifies plugin manifests as config category (not encrypted)", async () => {
    await mkdir(join(tempDir, "plugins", "my-plugin"), { recursive: true })
    await writeFile(join(tempDir, "plugins", "my-plugin", "openclaw.plugin.json"), '{}')

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const pluginFile = changes.added.find((f) =>
      f.relativePath === "plugins/my-plugin/openclaw.plugin.json")
    assert.ok(pluginFile !== undefined)
    assert.equal(pluginFile!.category, "config")
    assert.equal(pluginFile!.encrypted, false)
  })

  it("classifies session registry as chat category", async () => {
    await mkdir(join(tempDir, "agents", "default", "sessions"), { recursive: true })
    await writeFile(
      join(tempDir, "agents", "default", "sessions", "sessions.json"),
      '{"main": {"sessionId": "abc"}}',
    )

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const sessionFile = changes.added.find((f) =>
      f.relativePath === "agents/default/sessions/sessions.json")
    assert.ok(sessionFile !== undefined)
    assert.equal(sessionFile!.category, "chat")
  })

  it("classifies credentials as config category (encrypted)", async () => {
    await mkdir(join(tempDir, "credentials"), { recursive: true })
    await writeFile(join(tempDir, "credentials", "api-key.json"), '{"key": "secret"}')

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const credFile = changes.added.find((f) => f.relativePath === "credentials/api-key.json")
    assert.ok(credFile !== undefined)
    assert.equal(credFile!.category, "config")
    assert.equal(credFile!.encrypted, true)
  })

  it("classifies context snapshot as workspace category", async () => {
    await mkdir(join(tempDir, ".coc-backup"), { recursive: true })
    await writeFile(join(tempDir, ".coc-backup", "context-snapshot.json"), '{"version":1}')

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const snapshotFile = changes.added.find((f) =>
      f.relativePath === ".coc-backup/context-snapshot.json")
    assert.ok(snapshotFile !== undefined)
    assert.equal(snapshotFile!.category, "workspace")
  })

  it("respects database category toggle", async () => {
    const configNoDb = {
      ...defaultConfig,
      categories: { ...defaultConfig.categories, database: false },
    }

    const changes = await detectChanges(tempDir, configNoDb, null)
    const dbFiles = changes.added.filter((f) => f.category === "database")
    assert.equal(dbFiles.length, 0)
  })

  it("still detects original file categories", async () => {
    await writeFile(join(tempDir, "IDENTITY.md"), "# Identity")
    await writeFile(join(tempDir, "MEMORY.md"), "# Memory")

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const identityFile = changes.added.find((f) => f.relativePath === "IDENTITY.md")
    const memoryFile = changes.added.find((f) => f.relativePath === "MEMORY.md")
    assert.ok(identityFile !== undefined)
    assert.equal(identityFile!.category, "identity")
    assert.ok(memoryFile !== undefined)
    assert.equal(memoryFile!.category, "memory")
  })

  it("picks up identity / memory / workspace markdowns under workspace/ subdir (1.2.7+)", async () => {
    // OpenClaw moved IDENTITY.md / SOUL.md / MEMORY.md / etc. into
    // ~/.openclaw/workspace/. Patterns must accept both root-level and
    // workspace/-prefixed locations.
    await mkdir(join(tempDir, "workspace"), { recursive: true })
    await writeFile(join(tempDir, "workspace", "IDENTITY.md"), "# Test Identity\nname: test-agent")
    await writeFile(join(tempDir, "workspace", "SOUL.md"), "# Soul")
    await writeFile(join(tempDir, "workspace", "MEMORY.md"), "# Memory")
    await writeFile(join(tempDir, "workspace", "USER.md"), "# User")
    await writeFile(join(tempDir, "workspace", "AGENTS.md"), "# Agents")

    const changes = await detectChanges(tempDir, defaultConfig, null)

    const wsIdentity = changes.added.find((f) => f.relativePath === "workspace/IDENTITY.md")
    const wsSoul = changes.added.find((f) => f.relativePath === "workspace/SOUL.md")
    const wsMemory = changes.added.find((f) => f.relativePath === "workspace/MEMORY.md")
    const wsUser = changes.added.find((f) => f.relativePath === "workspace/USER.md")
    const wsAgents = changes.added.find((f) => f.relativePath === "workspace/AGENTS.md")

    assert.ok(wsIdentity, "workspace/IDENTITY.md must be captured")
    assert.equal(wsIdentity!.category, "identity")
    assert.equal(wsIdentity!.encrypted, false)

    assert.ok(wsSoul, "workspace/SOUL.md must be captured")
    assert.equal(wsSoul!.category, "identity")

    assert.ok(wsMemory, "workspace/MEMORY.md must be captured")
    assert.equal(wsMemory!.category, "memory")

    assert.ok(wsUser, "workspace/USER.md must be captured")
    assert.equal(wsUser!.category, "memory")

    assert.ok(wsAgents, "workspace/AGENTS.md must be captured")
    assert.equal(wsAgents!.category, "workspace")
  })

  it("picks up TOOLS.md / HEARTBEAT.md / BOOTSTRAP.md under workspace/ (1.2.9+)", async () => {
    await mkdir(join(tempDir, "workspace"), { recursive: true })
    await writeFile(join(tempDir, "workspace", "TOOLS.md"), "# Tools manifest")
    await writeFile(join(tempDir, "workspace", "HEARTBEAT.md"), "# Heartbeat\nlast: 2026-04-27T08:00:00Z")
    await writeFile(join(tempDir, "workspace", "BOOTSTRAP.md"), "# Bootstrap\n## Step 1: ...")

    const changes = await detectChanges(tempDir, defaultConfig, null)

    const tools = changes.added.find((f) => f.relativePath === "workspace/TOOLS.md")
    const heartbeat = changes.added.find((f) => f.relativePath === "workspace/HEARTBEAT.md")
    const bootstrap = changes.added.find((f) => f.relativePath === "workspace/BOOTSTRAP.md")

    assert.ok(tools, "workspace/TOOLS.md must be captured")
    assert.equal(tools!.category, "workspace")
    assert.equal(tools!.encrypted, false)

    assert.ok(heartbeat, "workspace/HEARTBEAT.md must be captured (soul writes its own heartbeat there)")
    assert.equal(heartbeat!.category, "workspace")

    assert.ok(bootstrap, "workspace/BOOTSTRAP.md must be captured (identity-shaping setup doc)")
    assert.equal(bootstrap!.category, "identity")
  })

  it("picks up daily / per-topic memory entries under workspace/memory/ (1.2.9+)", async () => {
    await mkdir(join(tempDir, "workspace", "memory"), { recursive: true })
    await writeFile(join(tempDir, "workspace", "memory", "2026-04-27.md"), "# 2026-04-27\n- did X")
    await writeFile(join(tempDir, "workspace", "memory", "topic-foo.md"), "# Topic\nnotes...")

    const changes = await detectChanges(tempDir, defaultConfig, null)

    const daily = changes.added.find((f) => f.relativePath === "workspace/memory/2026-04-27.md")
    const topic = changes.added.find((f) => f.relativePath === "workspace/memory/topic-foo.md")

    assert.ok(daily, "workspace/memory/<date>.md must be captured")
    assert.equal(daily!.category, "memory")
    assert.equal(daily!.encrypted, false)

    assert.ok(topic, "workspace/memory/<topic>.md must be captured")
    assert.equal(topic!.category, "memory")
  })

  it("picks up real workspace-state.json location at workspace/.openclaw/ (1.2.9+)", async () => {
    // Bug pre-1.2.9: rule only matched root-level workspace-state.json,
    // but OpenClaw writes it at workspace/.openclaw/workspace-state.json.
    // Backups silently missed the actual workspace state.
    await mkdir(join(tempDir, "workspace", ".openclaw"), { recursive: true })
    await writeFile(
      join(tempDir, "workspace", ".openclaw", "workspace-state.json"),
      '{"activeSessionId":"abc","layout":"split"}',
    )

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const state = changes.added.find((f) => f.relativePath === "workspace/.openclaw/workspace-state.json")
    assert.ok(state, "workspace/.openclaw/workspace-state.json must be captured")
    assert.equal(state!.category, "workspace")
    assert.equal(state!.encrypted, false)
  })

  it("picks up identity/device-auth.json paired with device.json (1.2.9+)", async () => {
    await mkdir(join(tempDir, "identity"), { recursive: true })
    await writeFile(join(tempDir, "identity", "device.json"), '{"deviceId":"d1"}')
    await writeFile(join(tempDir, "identity", "device-auth.json"), '{"token":"redacted"}')

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const auth = changes.added.find((f) => f.relativePath === "identity/device-auth.json")
    assert.ok(auth, "identity/device-auth.json must be captured")
    assert.equal(auth!.category, "config")
    assert.equal(auth!.encrypted, true)
  })

  it("picks up exec-approvals.json AS ENCRYPTED (1.2.9+)", async () => {
    await writeFile(
      join(tempDir, "exec-approvals.json"),
      '{"approvals":[{"command":"git status","scope":"session"}]}',
    )

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const approvals = changes.added.find((f) => f.relativePath === "exec-approvals.json")
    assert.ok(approvals, "exec-approvals.json must be captured")
    assert.equal(approvals!.category, "config")
    assert.equal(approvals!.encrypted, true, "approval rules touch security — encrypt")
  })

  // ── 1.2.10: denylist + walker dir-skip + host-local exclusions ──

  it("does NOT back up agents/<id>/agent/models.json (1.2.10+ — host-local LLM token, must not travel)", async () => {
    await mkdir(join(tempDir, "agents", "main", "agent"), { recursive: true })
    await writeFile(
      join(tempDir, "agents", "main", "agent", "models.json"),
      '{"providers":{"anthropic":{"apiKey":"sk-test"}}}',
    )
    const changes = await detectChanges(tempDir, defaultConfig, null)
    const models = changes.added.find((f) => f.relativePath === "agents/main/agent/models.json")
    assert.equal(models, undefined, "models.json contains host-local API tokens — must NOT enter the backup manifest")
  })

  it("does NOT back up agents/<id>/agent/auth-profiles.json (1.2.10+ — host-local OAuth state)", async () => {
    await mkdir(join(tempDir, "agents", "main", "agent"), { recursive: true })
    await writeFile(
      join(tempDir, "agents", "main", "agent", "auth-profiles.json"),
      '{"profiles":[{"provider":"anthropic","kind":"oauth"}]}',
    )
    const changes = await detectChanges(tempDir, defaultConfig, null)
    const auth = changes.added.find((f) => f.relativePath === "agents/main/agent/auth-profiles.json")
    assert.equal(auth, undefined, "auth-profiles.json holds host-local OAuth profiles — must NOT enter the backup manifest")
  })

  it("does NOT back up .coc-backup/state.json (1.2.10+ — circular reference)", async () => {
    await mkdir(join(tempDir, ".coc-backup"), { recursive: true })
    await writeFile(
      join(tempDir, ".coc-backup", "state.json"),
      '{"version":1,"lastManifestCid":"bafy...","incrementalCount":3}',
    )
    const changes = await detectChanges(tempDir, defaultConfig, null)
    const state = changes.added.find((f) => f.relativePath === ".coc-backup/state.json")
    assert.equal(state, undefined, ".coc-backup/state.json is the backup chain head — backing it up creates a circular reference")
  })

  it("does NOT back up operator audit copies (*.bak, *.pre-*, *.rejected.<ts>, *.last-good) (1.2.10+)", async () => {
    await writeFile(join(tempDir, "openclaw.json"), '{}')
    await writeFile(join(tempDir, "openclaw.json.bak"), '{}')
    await writeFile(join(tempDir, "openclaw.json.bak.1"), '{}')
    await writeFile(join(tempDir, "openclaw.json.pre-allowlist"), '{}')
    await writeFile(join(tempDir, "openclaw.json.pre-llm-literal"), '{}')
    await writeFile(join(tempDir, "openclaw.json.rejected.2026-04-23T09-35-42-752Z"), '{}')
    await writeFile(join(tempDir, "openclaw.json.last-good"), '{}')

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const captured = changes.added.map((f) => f.relativePath)

    assert.ok(captured.includes("openclaw.json"), "the live config IS captured")
    assert.ok(!captured.some((p) => p.endsWith(".bak")), "*.bak skipped")
    assert.ok(!captured.some((p) => p.match(/\.bak\.\d+$/)), "*.bak.<n> skipped")
    assert.ok(!captured.some((p) => p.match(/\.pre-/)), "*.pre-* skipped")
    assert.ok(!captured.some((p) => p.includes(".rejected.")), "*.rejected.<ts> skipped")
    assert.ok(!captured.some((p) => p.endsWith(".last-good")), "*.last-good skipped")
  })

  it("does NOT back up stale-*-backup-*.tar.gz (1.2.10+ — operator's tarball self-archives)", async () => {
    await writeFile(join(tempDir, "stale-home-node-backup-20260426-144215.tar.gz"), "tar bytes")
    const changes = await detectChanges(tempDir, defaultConfig, null)
    const tarball = changes.added.find((f) => f.relativePath.endsWith(".tar.gz"))
    assert.equal(tarball, undefined, "stale-*-backup-*.tar.gz is operator's self-archive, never re-back-up")
  })

  it("walker skips .git / node_modules / .openclaw-install-backups / .restore-overwrite-backup-* (1.2.10+)", async () => {
    // Each of these dirs holds many files; the walker should never enter them.
    await mkdir(join(tempDir, "workspace", ".git"), { recursive: true })
    await writeFile(join(tempDir, "workspace", ".git", "HEAD"), "ref: refs/heads/main\n")
    await writeFile(join(tempDir, "workspace", ".git", "config"), "[core]")

    await mkdir(join(tempDir, "node_modules", "ethers"), { recursive: true })
    await writeFile(join(tempDir, "node_modules", "ethers", "package.json"), '{}')

    await mkdir(join(tempDir, "extensions", ".openclaw-install-backups", "old-coc-soul"), { recursive: true })
    await writeFile(join(tempDir, "extensions", ".openclaw-install-backups", "old-coc-soul", "openclaw.plugin.json"), '{}')

    await mkdir(join(tempDir, ".restore-overwrite-backup-20260426T145726Z"), { recursive: true })
    await writeFile(join(tempDir, ".restore-overwrite-backup-20260426T145726Z", "openclaw.json"), '{}')

    const changes = await detectChanges(tempDir, defaultConfig, null)
    const captured = changes.added.map((f) => f.relativePath)

    assert.ok(!captured.some((p) => p.includes(".git/")), ".git/ contents skipped")
    assert.ok(!captured.some((p) => p.includes("node_modules/")), "node_modules/ contents skipped")
    assert.ok(!captured.some((p) => p.includes(".openclaw-install-backups/")), ".openclaw-install-backups/ contents skipped")
    assert.ok(!captured.some((p) => p.includes(".restore-overwrite-backup-")), ".restore-overwrite-backup-* contents skipped")
  })
})
