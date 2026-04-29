#!/usr/bin/env -S node --experimental-strip-types
// PoC dashboard entry — read-only CLI view of the multi-channel memory store.
//
// Three views, picked by flags:
//   - default                              → overview (all channels)
//   - --channel <name>                     → user list for that channel
//   - --channel <name> --user <id>         → that user's USER.md + MEMORY.md
//
// Honors:
//   - $CLAW_MEM_POC_ROOT (default ~/.openclaw/.claw-mem-poc/)
//   - $NO_COLOR (disables ANSI colors)
//
// Examples:
//   node --experimental-strip-types scripts/poc-dashboard.ts
//   CLAW_MEM_POC_ROOT=/tmp/foo node --experimental-strip-types scripts/poc-dashboard.ts --channel telegram
//   ./scripts/poc-dashboard.ts --channel slack --user user-a

import { homedir } from "node:os"
import { join } from "node:path"
import {
  renderOverview,
  renderChannel,
  renderUser,
  shouldUseColor,
} from "../src/poc/cli-dashboard.ts"

interface ParsedArgs {
  channel?: string
  user?: string
  noColor: boolean
  help: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { noColor: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "-h" || arg === "--help") out.help = true
    else if (arg === "--no-color") out.noColor = true
    else if (arg === "--channel") out.channel = argv[++i]
    else if (arg === "--user") out.user = argv[++i]
    else if (arg.startsWith("--channel=")) out.channel = arg.slice("--channel=".length)
    else if (arg.startsWith("--user=")) out.user = arg.slice("--user=".length)
    else {
      console.error(`Unknown arg: ${arg}`)
      out.help = true
    }
  }
  return out
}

function printHelp(): void {
  console.log(`Usage: poc-dashboard.ts [--channel <name> [--user <id>]] [--no-color]

Views:
  (no args)                       overview of all channels
  --channel <name>                user list within that channel
  --channel <ch> --user <id>      USER.md + MEMORY.md for that user

Env:
  CLAW_MEM_POC_ROOT               override PoC root (default ~/.openclaw/.claw-mem-poc/)
  NO_COLOR                        disable ANSI colors

Examples:
  CLAW_MEM_POC_ROOT=/tmp/claw-mem-poc-day3 ./scripts/poc-dashboard.ts
  ./scripts/poc-dashboard.ts --channel telegram
  ./scripts/poc-dashboard.ts --channel slack --user user-a`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const root = process.env.CLAW_MEM_POC_ROOT ?? join(homedir(), ".openclaw", ".claw-mem-poc")
  const colors = !args.noColor && shouldUseColor()

  if (args.channel && args.user) {
    process.stdout.write(await renderUser(root, args.channel, args.user, { colors }))
  } else if (args.channel) {
    process.stdout.write(await renderChannel(root, args.channel, { colors }))
  } else {
    process.stdout.write(await renderOverview(root, { colors }))
  }
}

main().catch((err) => {
  console.error(`poc-dashboard error: ${String(err)}`)
  process.exit(1)
})
