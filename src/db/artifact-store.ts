// Artifact storage: contract addresses and operator key references
// produced by `claw-mem bootstrap`. Uses a flat key/value table scoped by network.

import type { Database } from "./database.ts"

export type ArtifactKey =
  | "soul_registry"
  | "did_registry"
  | "pose_manager"
  | "cid_registry"
  | "operator_key_ref"
  | "hardhat_pid"
  | string  // allow custom keys for forward compat

export interface CocArtifact {
  key: string
  value: string
  network: string
  chainId: number | null
  createdAt: string
  createdAtEpoch: number
}

export interface CocArtifactInput {
  key: ArtifactKey
  value: string
  network?: string
  chainId?: number | null
}

interface RawArtifactRow {
  key: string
  value: string
  network: string
  chain_id: number | null
  created_at: string
  created_at_epoch: number
}

export class ArtifactStore {
  private readonly db: Database
  constructor(db: Database) { this.db = db }

  set(input: CocArtifactInput): CocArtifact {
    const now = new Date()
    const isoNow = now.toISOString()
    const epochNow = Math.floor(now.getTime() / 1000)
    const network = input.network ?? "local"

    this.db.connection
      .prepare(
        `INSERT INTO coc_artifacts (key, value, network, chain_id, created_at, created_at_epoch)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           network = excluded.network,
           chain_id = excluded.chain_id,
           created_at = excluded.created_at,
           created_at_epoch = excluded.created_at_epoch`,
      )
      .run(input.key, input.value, network, input.chainId ?? null, isoNow, epochNow)

    const row = this.get(input.key)
    if (!row) throw new Error(`Failed to set artifact ${input.key}`)
    return row
  }

  get(key: string): CocArtifact | null {
    const row = this.db.connection
      .prepare("SELECT * FROM coc_artifacts WHERE key = ?")
      .get(key) as unknown as RawArtifactRow | undefined
    return row ? mapRow(row) : null
  }

  getValue(key: string): string | null {
    const row = this.get(key)
    return row?.value ?? null
  }

  list(): CocArtifact[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM coc_artifacts ORDER BY created_at_epoch DESC")
      .all() as unknown as RawArtifactRow[]
    return rows.map(mapRow)
  }

  listByNetwork(network: string): CocArtifact[] {
    const rows = this.db.connection
      .prepare("SELECT * FROM coc_artifacts WHERE network = ? ORDER BY key")
      .all(network) as unknown as RawArtifactRow[]
    return rows.map(mapRow)
  }

  delete(key: string): boolean {
    const result = this.db.connection
      .prepare("DELETE FROM coc_artifacts WHERE key = ?")
      .run(key)
    return Number(result.changes) > 0
  }

  deleteByNetwork(network: string): number {
    const result = this.db.connection
      .prepare("DELETE FROM coc_artifacts WHERE network = ?")
      .run(network)
    return Number(result.changes)
  }
}

function mapRow(row: RawArtifactRow): CocArtifact {
  return {
    key: row.key,
    value: row.value,
    network: row.network,
    chainId: row.chain_id,
    createdAt: row.created_at,
    createdAtEpoch: row.created_at_epoch,
  }
}
