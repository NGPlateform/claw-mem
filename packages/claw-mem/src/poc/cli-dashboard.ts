// PoC CLI dashboard: pure stdout renderer.
//
// Three views:
//   - renderOverview(root)              — global summary + channel list
//   - renderChannel(root, channel)      — user list within one channel
//   - renderUser(root, channel, user)   — full markdown for one user
//
// No deps beyond node: built-in fs / path. ANSI colors are honored unless
// NO_COLOR=1 or stdout isn't a TTY (handled by caller).

import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

// ──────────────────────────────────────────────────────────────────────────
// ANSI helpers (caller decides whether to enable via passing colors=true)
// ──────────────────────────────────────────────────────────────────────────

const ESC = "\x1b["
const COLORS = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  gray: `${ESC}90m`,
} as const

type ColorKey = keyof typeof COLORS

export interface DashboardOptions {
  /** Render ANSI color codes? Default: detect via NO_COLOR + isTTY. */
  colors?: boolean
}

function paint(opts: DashboardOptions, color: ColorKey, text: string): string {
  if (!opts.colors) return text
  return `${COLORS[color]}${text}${COLORS.reset}`
}

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR && process.env.NO_COLOR !== "0") return false
  return Boolean(process.stdout.isTTY)
}

// ──────────────────────────────────────────────────────────────────────────
// Filesystem inspection — pure, no rendering
// ──────────────────────────────────────────────────────────────────────────

export interface ChannelStats {
  name: string
  userCount: number
  factCount: number
}

export interface UserStats {
  channel: string
  user: string
  factCount: number
  hasUserMd: boolean
  lastModifiedMs: number | null
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  } catch {
    return []
  }
}

async function countFacts(memoryMdPath: string): Promise<number> {
  try {
    const content = await readFile(memoryMdPath, "utf-8")
    let n = 0
    for (const line of content.split("\n")) {
      if (line.startsWith("- ")) n++
    }
    return n
  } catch {
    return 0
  }
}

async function fileMtime(path: string): Promise<number | null> {
  try {
    const { stat } = await import("node:fs/promises")
    const s = await stat(path)
    return s.mtimeMs
  } catch {
    return null
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises")
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function listChannels(root: string): Promise<ChannelStats[]> {
  const channelsDir = join(root, "memories", "channels")
  const channels = await safeReaddir(channelsDir)
  const result: ChannelStats[] = []
  for (const ch of channels) {
    const usersDir = join(channelsDir, ch, "users")
    const users = await safeReaddir(usersDir)
    let totalFacts = 0
    for (const u of users) {
      totalFacts += await countFacts(join(usersDir, u, "MEMORY.md"))
    }
    result.push({ name: ch, userCount: users.length, factCount: totalFacts })
  }
  return result
}

export async function listUsersOfChannel(root: string, channel: string): Promise<UserStats[]> {
  const usersDir = join(root, "memories", "channels", channel, "users")
  const users = await safeReaddir(usersDir)
  const result: UserStats[] = []
  for (const u of users) {
    const memoryMd = join(usersDir, u, "MEMORY.md")
    const userMd = join(usersDir, u, "USER.md")
    result.push({
      channel,
      user: u,
      factCount: await countFacts(memoryMd),
      hasUserMd: await fileExists(userMd),
      lastModifiedMs: await fileMtime(memoryMd),
    })
  }
  return result
}

// ──────────────────────────────────────────────────────────────────────────
// Renderers — return strings, no side effects
// ──────────────────────────────────────────────────────────────────────────

function pad(text: string, width: number): string {
  if (text.length >= width) return text
  return text + " ".repeat(width - text.length)
}

function box(lines: string[]): string {
  const inner = Math.max(...lines.map((l) => visibleLength(l)))
  const top = "╭" + "─".repeat(inner + 2) + "╮"
  const bot = "╰" + "─".repeat(inner + 2) + "╯"
  const middle = lines.map((l) => "│ " + l + " ".repeat(Math.max(0, inner - visibleLength(l))) + " │")
  return [top, ...middle, bot].join("\n")
}

/** Strip ANSI escape sequences for width calculations. */
function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length
}

function formatRelativeTime(ms: number | null): string {
  if (ms === null) return "never"
  const delta = Date.now() - ms
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return `${Math.floor(delta / 86_400_000)}d ago`
}

export async function renderOverview(root: string, opts: DashboardOptions = {}): Promise<string> {
  const channels = await listChannels(root)
  const totalChannels = channels.length
  const totalUsers = channels.reduce((s, c) => s + c.userCount, 0)
  const totalFacts = channels.reduce((s, c) => s + c.factCount, 0)

  const title = paint(opts, "bold", "claw-mem PoC dashboard")
  const subtitle = paint(opts, "gray", `root: ${root}`)

  const stats = [
    `${paint(opts, "cyan", "Channels")}: ${paint(opts, "bold", String(totalChannels))}`,
    `${paint(opts, "cyan", "Users")}:    ${paint(opts, "bold", String(totalUsers))}`,
    `${paint(opts, "cyan", "Facts")}:    ${paint(opts, "bold", String(totalFacts))}`,
  ].join("    ")

  const header = box([title, subtitle, "", stats])

  if (channels.length === 0) {
    return [
      header,
      "",
      paint(opts, "yellow", "No channels yet. Send a message via OpenClaw to populate."),
      "",
    ].join("\n")
  }

  const channelLines: string[] = []
  channelLines.push(
    paint(opts, "bold", pad("Channel", 16) + pad("Users", 10) + pad("Facts", 10) + "Drill into"),
  )
  channelLines.push(paint(opts, "gray", "─".repeat(16 + 10 + 10 + 14)))
  for (const ch of channels) {
    const drillCmd = paint(opts, "dim", `claw-mem-poc dashboard --channel ${ch.name}`)
    channelLines.push(
      paint(opts, "green", "▶ ") +
        pad(ch.name, 14) +
        pad(String(ch.userCount), 10) +
        pad(String(ch.factCount), 10) +
        drillCmd,
    )
  }

  const footer = paint(
    opts,
    "gray",
    `Tip: open one user with 'claw-mem-poc dashboard --channel <name> --user <id>'.`,
  )

  return [header, "", ...channelLines, "", footer, ""].join("\n")
}

export async function renderChannel(
  root: string,
  channel: string,
  opts: DashboardOptions = {},
): Promise<string> {
  const users = await listUsersOfChannel(root, channel)

  const title = paint(opts, "bold", `Channel: ${channel}`)
  const subtitle = paint(opts, "gray", `${users.length} users`)

  if (users.length === 0) {
    return [
      box([title, subtitle]),
      "",
      paint(
        opts,
        "yellow",
        `No users for channel '${channel}'. Did you spell it right? Try without --channel for the overview.`,
      ),
      "",
    ].join("\n")
  }

  const lines: string[] = []
  lines.push(
    paint(
      opts,
      "bold",
      pad("User", 22) + pad("Facts", 10) + pad("USER.md", 10) + "Last activity",
    ),
  )
  lines.push(paint(opts, "gray", "─".repeat(22 + 10 + 10 + 16)))
  for (const u of users) {
    lines.push(
      paint(opts, "green", "▶ ") +
        pad(u.user, 20) +
        pad(String(u.factCount), 10) +
        pad(u.hasUserMd ? "yes" : "no", 10) +
        formatRelativeTime(u.lastModifiedMs),
    )
  }
  const footer = paint(
    opts,
    "gray",
    `Open: claw-mem-poc dashboard --channel ${channel} --user <id>`,
  )

  return [box([title, subtitle]), "", ...lines, "", footer, ""].join("\n")
}

export async function renderUser(
  root: string,
  channel: string,
  user: string,
  opts: DashboardOptions = {},
): Promise<string> {
  const memoryPath = join(root, "memories", "channels", channel, "users", user, "MEMORY.md")
  const userMdPath = join(root, "memories", "channels", channel, "users", user, "USER.md")

  const title = paint(opts, "bold", `User: ${channel}/${user}`)
  const subtitle = paint(opts, "gray", "showing USER.md and MEMORY.md")

  const sections: string[] = [box([title, subtitle]), ""]

  const userBody = await readFile(userMdPath, "utf-8").catch(() => null)
  if (userBody) {
    sections.push(paint(opts, "magenta", "── USER.md ─────────────────────────────────────────"))
    sections.push(userBody.trimEnd())
    sections.push("")
  } else {
    sections.push(paint(opts, "gray", "(no USER.md)"))
    sections.push("")
  }

  const memoryBody = await readFile(memoryPath, "utf-8").catch(() => null)
  if (memoryBody) {
    sections.push(paint(opts, "magenta", "── MEMORY.md ───────────────────────────────────────"))
    sections.push(memoryBody.trimEnd())
    sections.push("")
  } else {
    sections.push(paint(opts, "yellow", "(no MEMORY.md — user may not have any messages yet)"))
    sections.push("")
  }

  return sections.join("\n")
}

// Re-export for callers that don't want to detect themselves.
export { shouldUseColor }
