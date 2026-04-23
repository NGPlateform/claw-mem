// Shared helpers for reading and persisting ~/.claw-mem/config.json.
// Used by:
//   - cli/commands/config.ts (get/set/list)
//   - cli/commands/init.ts (first-time wizard)
//   - cli/commands/backup.ts (configure wizard)
//   - services/bootstrap-manager.ts (persist operator key after dev bootstrap)

import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

export const DEFAULT_CONFIG_PATH = join(homedir(), ".claw-mem", "config.json")

export async function readConfigFile(path = DEFAULT_CONFIG_PATH): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {}
  const raw = await readFile(path, "utf-8")
  return JSON.parse(raw) as Record<string, unknown>
}

export async function writeConfigFile(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2))
}

/**
 * Apply a mutation to the on-disk config atomically (read → mutate → write).
 * The mutator may modify in place or return a new object.
 */
export async function patchConfigFile(
  path: string,
  mutator: (cfg: Record<string, unknown>) => Record<string, unknown> | void,
): Promise<Record<string, unknown>> {
  const current = await readConfigFile(path)
  const updated = mutator(current) ?? current
  await writeConfigFile(path, updated)
  return updated
}

export function getDotPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".")
  let cursor: unknown = obj
  for (const p of parts) {
    if (cursor && typeof cursor === "object" && p in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return cursor
}

export function setDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".")
  let cursor: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]] = value
}

export function coerceScalar(raw: string): string | number | boolean | null {
  if (raw === "true") return true
  if (raw === "false") return false
  if (raw === "null") return null
  if (raw !== "" && !isNaN(Number(raw))) return Number(raw)
  return raw
}
