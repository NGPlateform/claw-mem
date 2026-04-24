// JsonNodeRegistry — default NodeRegistry implementation for standalone
// @chainofclaw/node users who don't want to bring in a SQLite stack.
// Persists node records as a single JSON file at `<baseDir>/nodes.json`.
//
// Not concurrency-safe across processes — that's fine: the umbrella
// claw-mem package uses the SQLite-backed NodeStore in multi-process
// settings, and the coc-node CLI bin is single-process.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { NodeEntry, NodeEntryInput, NodeRegistry } from "./types.ts"

export interface JsonNodeRegistryOptions {
  /** Directory to place `nodes.json` in — typically `<config.dataDir>`. */
  baseDir: string
  /** Override the on-disk filename. Defaults to "nodes.json". */
  fileName?: string
}

export class JsonNodeRegistry implements NodeRegistry {
  private readonly filePath: string
  private loaded = false
  private records: Map<string, NodeEntry> = new Map()

  constructor(opts: JsonNodeRegistryOptions) {
    const fileName = opts.fileName ?? "nodes.json"
    this.filePath = join(opts.baseDir, fileName)
  }

  init(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    this.loadIfNeeded()
  }

  list(): readonly NodeEntry[] {
    this.loadIfNeeded()
    return [...this.records.values()].sort((a, b) => b.createdAtEpoch - a.createdAtEpoch)
  }

  get(name: string): NodeEntry | null {
    this.loadIfNeeded()
    return this.records.get(name) ?? null
  }

  upsert(input: NodeEntryInput): NodeEntry {
    this.loadIfNeeded()
    const now = new Date()
    const isoNow = now.toISOString()
    const epochNow = Math.floor(now.getTime() / 1000)
    const advertisedBytes = input.advertisedBytes ?? 268_435_456

    const existing = this.records.get(input.name)
    const entry: NodeEntry = {
      name: input.name,
      type: input.type,
      network: input.network,
      dataDir: input.dataDir,
      services: [...input.services],
      advertisedBytes,
      rpcPort: input.rpcPort,
      configPath: input.configPath ?? null,
      createdAt: existing?.createdAt ?? isoNow,
      createdAtEpoch: existing?.createdAtEpoch ?? epochNow,
      updatedAt: isoNow,
      updatedAtEpoch: epochNow,
    }
    this.records.set(input.name, entry)
    this.persist()
    return entry
  }

  delete(name: string): boolean {
    this.loadIfNeeded()
    const removed = this.records.delete(name)
    if (removed) this.persist()
    return removed
  }

  private loadIfNeeded(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, "utf-8")
      const parsed = JSON.parse(raw) as { nodes?: NodeEntry[] }
      if (parsed && Array.isArray(parsed.nodes)) {
        for (const n of parsed.nodes) {
          if (n && typeof n.name === "string") this.records.set(n.name, n)
        }
      }
    } catch {
      // Corrupt file — start fresh; caller can re-install.
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const payload = {
      version: 1,
      nodes: [...this.records.values()],
    }
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2) + "\n")
  }
}
