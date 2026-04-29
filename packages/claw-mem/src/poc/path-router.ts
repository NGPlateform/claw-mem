// PoC path router: maps (channel, user, kind) → absolute file path under
// the PoC root (default ~/.openclaw/.claw-mem-poc/). Validates segments
// against a strict charset to prevent path traversal.
//
// Layout:
//   <root>/memories/_global/SOUL.md                                         (kind=soul)
//   <root>/memories/_global/AGENTS.md                                       (kind=agents)
//   <root>/memories/channels/<channel>/MEMORY.md                            (kind=memory, no user)
//   <root>/memories/channels/<channel>/users/<user>/MEMORY.md               (kind=memory + user)
//   <root>/memories/channels/<channel>/users/<user>/USER.md                 (kind=user + channel + user)

import { homedir } from "node:os"
import { join, sep, normalize, isAbsolute, relative } from "node:path"

export type PathKind = "soul" | "agents" | "memory" | "user"

export interface PathOpts {
  channel?: string
  user?: string
  kind: PathKind
}

export interface ParsedPath {
  channel?: string
  user?: string
  kind: PathKind
}

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]{1,64}$/
// Even when SAFE_SEGMENT matches, these names would either traverse the
// tree (".", "..") or collide with reserved global directory ("_global").
const RESERVED_SEGMENTS = new Set([".", "..", "_global"])

const ENV_ROOT = "CLAW_MEM_POC_ROOT"

export function getPocRoot(): string {
  const override = process.env[ENV_ROOT]
  if (override) return normalize(override)
  return join(homedir(), ".openclaw", ".claw-mem-poc")
}

function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value) || RESERVED_SEGMENTS.has(value)) {
    throw new Error(
      `Invalid ${label} ${JSON.stringify(value)}: must match ${SAFE_SEGMENT} ` +
        `and not be a reserved name (".", "..", "_global").`,
    )
  }
}

export function pathFor(opts: PathOpts): string {
  const root = getPocRoot()
  const memoriesDir = join(root, "memories")

  switch (opts.kind) {
    case "soul":
      if (opts.channel || opts.user) {
        throw new Error("kind=soul is global; pass neither channel nor user.")
      }
      return join(memoriesDir, "_global", "SOUL.md")

    case "agents":
      if (opts.channel || opts.user) {
        throw new Error("kind=agents is global; pass neither channel nor user.")
      }
      return join(memoriesDir, "_global", "AGENTS.md")

    case "memory": {
      if (opts.channel === undefined) {
        throw new Error("kind=memory requires a channel.")
      }
      assertSafeSegment(opts.channel, "channel")
      const channelDir = join(memoriesDir, "channels", opts.channel)
      if (opts.user === undefined) {
        // channel-level memory (group / broadcast)
        return join(channelDir, "MEMORY.md")
      }
      assertSafeSegment(opts.user, "user")
      return join(channelDir, "users", opts.user, "MEMORY.md")
    }

    case "user": {
      if (opts.channel === undefined || opts.user === undefined) {
        throw new Error("kind=user requires both channel and user.")
      }
      assertSafeSegment(opts.channel, "channel")
      assertSafeSegment(opts.user, "user")
      return join(
        memoriesDir,
        "channels",
        opts.channel,
        "users",
        opts.user,
        "USER.md",
      )
    }

    default: {
      const _exhaustive: never = opts.kind
      throw new Error(`Unknown kind: ${String(_exhaustive)}`)
    }
  }
}

export function parseFromPath(absPath: string): ParsedPath | null {
  if (!isAbsolute(absPath)) return null

  const root = getPocRoot()
  const memoriesDir = join(root, "memories")
  const rel = relative(memoriesDir, absPath)
  if (rel.startsWith("..") || isAbsolute(rel)) return null

  const parts = rel.split(sep)

  // _global/SOUL.md or _global/AGENTS.md
  if (parts.length === 2 && parts[0] === "_global") {
    if (parts[1] === "SOUL.md") return { kind: "soul" }
    if (parts[1] === "AGENTS.md") return { kind: "agents" }
    return null
  }

  // channels/<channel>/MEMORY.md
  if (parts.length === 3 && parts[0] === "channels" && parts[2] === "MEMORY.md") {
    if (!SAFE_SEGMENT.test(parts[1])) return null
    return { kind: "memory", channel: parts[1] }
  }

  // channels/<channel>/users/<user>/{MEMORY,USER}.md
  if (
    parts.length === 5 &&
    parts[0] === "channels" &&
    parts[2] === "users"
  ) {
    if (!SAFE_SEGMENT.test(parts[1]) || !SAFE_SEGMENT.test(parts[3])) return null
    if (parts[4] === "MEMORY.md") {
      return { kind: "memory", channel: parts[1], user: parts[3] }
    }
    if (parts[4] === "USER.md") {
      return { kind: "user", channel: parts[1], user: parts[3] }
    }
    return null
  }

  return null
}
