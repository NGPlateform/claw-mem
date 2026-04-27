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
})
