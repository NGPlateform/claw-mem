// `claw-mem version` — rich version information beyond commander's `-V`.

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Command } from "commander"

import type { CliServices } from "../register-all.ts"
import { SCHEMA_VERSION } from "../../db/migrations.ts"
import { checkCocRepo, describeCocRepoCheck } from "@chainofclaw/node"

// Walk up from this module looking for package.json. Works both in the dev
// tree (src/cli/commands/ — 3 levels up) and after compile to
// dist/src/cli/commands/ — 4 levels up — and in npm-installed trees under
// node_modules/@chainofclaw/claw-mem/dist/src/cli/commands/.
function resolvePkgJson(): string | null {
  let dir = import.meta.dirname
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "package.json")
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const PKG_JSON_PATH = resolvePkgJson()

export function registerVersionCommand(program: Command, services: CliServices): void {
  program
    .command("version")
    .description("Print claw-mem / schema / Node / COC repo info")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const pkg = await readPkg()
      const cocCheck = checkCocRepo({
        cocRepoPath: services.config.bootstrap.cocRepoPath ?? services.config.node.runtimeDir,
      })

      const info = {
        clawMem: pkg.version,
        schema: SCHEMA_VERSION,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cocRepo: cocCheck.ok ? cocCheck.root : null,
        cocRepoNote: cocCheck.ok ? null : describeCocRepoCheck(cocCheck),
        database: services.dbPath,
        configPath: existsSync(services.dbPath) ? services.dbPath : null,
      }

      if (opts.json) {
        console.log(JSON.stringify(info, null, 2))
        return
      }

      console.log(`claw-mem        ${info.clawMem}`)
      console.log(`schema version  ${info.schema}`)
      console.log(`Node            ${info.node} (${info.platform}/${info.arch})`)
      console.log(`COC repo        ${info.cocRepo ?? "(not located)"}`)
      if (info.cocRepoNote) console.log(`                 ↳ ${info.cocRepoNote}`)
      console.log(`database        ${info.database}`)
    })
}

async function readPkg(): Promise<{ version: string }> {
  if (!PKG_JSON_PATH) return { version: "unknown" }
  try {
    const raw = await readFile(PKG_JSON_PATH, "utf-8")
    return JSON.parse(raw) as { version: string }
  } catch {
    return { version: "unknown" }
  }
}
