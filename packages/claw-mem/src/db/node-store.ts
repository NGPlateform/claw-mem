// Node storage: CRUD for COC nodes managed by claw-mem
//
// Replaces the old coc-nodeops `~/.clawdbot/coc/nodes.json` registry
// with SQLite-backed persistence.

import type { Database } from "./database.ts"

export interface NodeEntry {
  name: string
  type: string
  network: string
  dataDir: string
  services: string[]
  advertisedBytes: number
  rpcPort: number
  configPath: string | null
  createdAt: string
  createdAtEpoch: number
  updatedAt: string | null
  updatedAtEpoch: number | null
}

export interface NodeEntryInput {
  name: string
  type: string
  network: string
  dataDir: string
  services: string[]
  advertisedBytes?: number
  rpcPort: number
  configPath?: string | null
}

interface RawNodeRow {
  name: string
  type: string
  network: string
  data_dir: string
  services: string
  advertised_bytes: number
  rpc_port: number
  config_path: string | null
  created_at: string
  created_at_epoch: number
  updated_at: string | null
  updated_at_epoch: number | null
}

export class NodeStore {
  private readonly db: Database
  constructor(db: Database) { this.db = db }

  upsert(input: NodeEntryInput): NodeEntry {
    const now = new Date()
    const isoNow = now.toISOString()
    const epochNow = Math.floor(now.getTime() / 1000)
    const advertised = input.advertisedBytes ?? 268_435_456

    this.db.connection
      .prepare(
        `INSERT INTO coc_nodes
         (name, type, network, data_dir, services, advertised_bytes,
          rpc_port, config_path, created_at, created_at_epoch,
          updated_at, updated_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           type = excluded.type,
           network = excluded.network,
           data_dir = excluded.data_dir,
           services = excluded.services,
           advertised_bytes = excluded.advertised_bytes,
           rpc_port = excluded.rpc_port,
           config_path = excluded.config_path,
           updated_at = excluded.updated_at,
           updated_at_epoch = excluded.updated_at_epoch`,
      )
      .run(
        input.name,
        input.type,
        input.network,
        input.dataDir,
        JSON.stringify(input.services),
        advertised,
        input.rpcPort,
        input.configPath ?? null,
        isoNow,
        epochNow,
        isoNow,
        epochNow,
      )

    const row = this.get(input.name)
    if (!row) throw new Error(`Failed to upsert node ${input.name}`)
    return row
  }

  get(name: string): NodeEntry | null {
    const row = this.db.connection
      .prepare("SELECT * FROM coc_nodes WHERE name = ?")
      .get(name) as unknown as RawNodeRow | undefined
    return row ? mapRow(row) : null
  }

  list(): NodeEntry[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM coc_nodes ORDER BY created_at_epoch DESC, name DESC")
      .all() as unknown as RawNodeRow[]
    return rows.map(mapRow)
  }

  listByNetwork(network: string): NodeEntry[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM coc_nodes WHERE network = ? ORDER BY created_at_epoch DESC, name DESC")
      .all(network) as unknown as RawNodeRow[]
    return rows.map(mapRow)
  }

  delete(name: string): boolean {
    const result = this.db.connection
      .prepare("DELETE FROM coc_nodes WHERE name = ?")
      .run(name)
    return Number(result.changes) > 0
  }

  count(): number {
    const row = this.db.connection
      .prepare("SELECT COUNT(*) as c FROM coc_nodes")
      .get() as { c: number }
    return row.c
  }
}

function mapRow(row: RawNodeRow): NodeEntry {
  return {
    name: row.name,
    type: row.type,
    network: row.network,
    dataDir: row.data_dir,
    services: parseStringArray(row.services),
    advertisedBytes: row.advertised_bytes,
    rpcPort: row.rpc_port,
    configPath: row.config_path,
    createdAt: row.created_at,
    createdAtEpoch: row.created_at_epoch,
    updatedAt: row.updated_at,
    updatedAtEpoch: row.updated_at_epoch,
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
