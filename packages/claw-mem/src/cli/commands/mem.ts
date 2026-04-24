// `claw-mem mem ...` subcommand group.
// Mirrors the existing mem-search / mem-status / mem-forget tools so that the
// same logic is reachable both from the agent (via tools) and the shell (via CLI).

import { writeFile, readFile } from "node:fs/promises"
import type { Command } from "commander"
import type { CliServices } from "../register-all.ts"
import { buildContext } from "../../context/builder.ts"

export function registerMemCommands(program: Command, services: CliServices): void {
  const { searchEngine, observationStore, summaryStore, sessionStore, db, config, dbPath } = services

  const mem = program.command("mem").description("Semantic memory queries and maintenance")

  // ─── mem search <query> ───────────────────────────────────
  mem
    .command("search <query>")
    .description("Search past observations")
    .option("--limit <n>", "Max results", Number, 10)
    .option("--type <type>", "Filter by observation type")
    .option("--agent <agentId>", "Filter by agent ID")
    .option("--json", "Output JSON")
    .action((query: string, opts: { limit: number; type?: string; agent?: string; json?: boolean }) => {
      const result = searchEngine.search({
        query,
        limit: opts.limit,
        type: opts.type,
        agentId: opts.agent,
      })
      if (opts.json) {
        console.log(JSON.stringify({ source: result.source, count: result.totalCount, results: result.results }, null, 2))
        return
      }
      console.log(`${result.totalCount} hits (source: ${result.source})`)
      for (const r of result.results) {
        console.log(`  [${r.type}] ${r.title}`)
        if (r.narrative) console.log(`    ${r.narrative.slice(0, 120)}`)
        if (r.concepts.length) console.log(`    concepts: ${r.concepts.join(", ")}`)
        console.log(`    ${r.createdAt} (session: ${r.sessionId})`)
      }
    })

  // ─── mem status ───────────────────────────────────────────
  mem
    .command("status")
    .description("Show memory database statistics")
    .option("--json", "Output JSON")
    .action((opts: { json?: boolean }) => {
      const totalObs = db.connection.prepare("SELECT COUNT(*) as c FROM observations").get() as { c: number }
      const totalSums = db.connection.prepare("SELECT COUNT(*) as c FROM session_summaries").get() as { c: number }
      const totalSessions = db.connection.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }
      const agents = db.connection.prepare("SELECT DISTINCT agent_id FROM observations").all() as Array<{ agent_id: string }>

      const status = {
        observations: totalObs.c,
        summaries: totalSums.c,
        sessions: totalSessions.c,
        agents: agents.map((a) => a.agent_id),
        database: dbPath,
        tokenBudget: config.tokenBudget,
      }
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2))
        return
      }
      console.log(`Database:     ${status.database}`)
      console.log(`Observations: ${status.observations}`)
      console.log(`Summaries:    ${status.summaries}`)
      console.log(`Sessions:     ${status.sessions}`)
      console.log(`Agents:       ${status.agents.join(", ") || "(none)"}`)
      console.log(`Token budget: ${status.tokenBudget}`)
    })

  // ─── mem forget <sessionId> ───────────────────────────────
  mem
    .command("forget <sessionId>")
    .description("Delete observations for a specific session")
    .action((sessionId: string) => {
      const deleted = observationStore.deleteBySession(sessionId)
      console.log(`Deleted ${deleted} observation(s) for session ${sessionId}`)
    })

  // ─── mem peek ─────────────────────────────────────────────
  mem
    .command("peek")
    .description("Show the memory context that would be injected on the next prompt")
    .option("--agent <agentId>", "Agent ID (defaults to most recent agent)")
    .option("--json", "Output JSON")
    .action((opts: { agent?: string; json?: boolean }) => {
      const agentId = opts.agent ?? pickRecentAgent(db) ?? "default"
      const observations = observationStore.getRecent(agentId, config.maxObservations)
      const summaries = summaryStore.getRecent(agentId, config.maxSummaries)

      if (observations.length === 0 && summaries.length === 0) {
        console.log(`No memory recorded for agent "${agentId}".`)
        return
      }

      const ctx = buildContext({
        observations,
        summaries,
        tokenBudget: config.tokenBudget,
        agentId,
      })

      if (opts.json) {
        console.log(JSON.stringify({
          agentId,
          tokenBudget: config.tokenBudget,
          tokensUsed: ctx.tokensUsed,
          observationCount: ctx.observationCount,
          summaryCount: ctx.summaryCount,
          markdown: ctx.markdown,
        }, null, 2))
        return
      }

      console.log(`Agent: ${agentId}`)
      console.log(`Tokens: ${ctx.tokensUsed} / ${config.tokenBudget}`)
      console.log(`Observations: ${ctx.observationCount}, summaries: ${ctx.summaryCount}`)
      console.log("─".repeat(60))
      console.log(ctx.markdown || "(empty)")
    })

  // ─── mem prune ────────────────────────────────────────────
  mem
    .command("prune")
    .description("Delete observations older than N days (or before --before <ISO>)")
    .option("--older-than <days>", "Days threshold", (v) => Number(v))
    .option("--before <iso>", "Drop everything strictly older than this ISO timestamp")
    .option("--agent <agentId>", "Only prune for one agent")
    .option("--include-summaries", "Also delete session_summaries older than the cutoff", false)
    .option("--include-sessions", "Also delete sessions whose started_at is older than the cutoff", false)
    .option("--dry-run", "Show counts, don't actually delete", false)
    .action((opts: {
      olderThan?: number; before?: string; agent?: string;
      includeSummaries?: boolean; includeSessions?: boolean; dryRun?: boolean
    }) => {
      let cutoffEpoch: number
      if (opts.before) {
        cutoffEpoch = Math.floor(new Date(opts.before).getTime() / 1000)
      } else if (opts.olderThan !== undefined && Number.isFinite(opts.olderThan)) {
        cutoffEpoch = Math.floor((Date.now() - opts.olderThan * 86_400_000) / 1000)
      } else {
        console.error("Provide --older-than <days> or --before <ISO>")
        process.exit(1)
      }

      const agentClause = opts.agent ? "AND agent_id = ?" : ""
      const agentBind: unknown[] = opts.agent ? [opts.agent] : []

      const obsCount = (
        db.connection.prepare(`SELECT COUNT(*) as c FROM observations WHERE created_at_epoch < ? ${agentClause}`)
          .get(cutoffEpoch, ...(agentBind as never[])) as { c: number }
      ).c
      const sumCount = opts.includeSummaries
        ? (db.connection.prepare(`SELECT COUNT(*) as c FROM session_summaries WHERE created_at_epoch < ? ${agentClause}`)
            .get(cutoffEpoch, ...(agentBind as never[])) as { c: number }).c
        : 0
      const sessCount = opts.includeSessions
        ? (db.connection.prepare(`SELECT COUNT(*) as c FROM sessions WHERE started_at_epoch < ? ${agentClause}`)
            .get(cutoffEpoch, ...(agentBind as never[])) as { c: number }).c
        : 0

      console.log(`Cutoff:        ${new Date(cutoffEpoch * 1000).toISOString()} (epoch ${cutoffEpoch})`)
      console.log(`Observations:  ${obsCount} would be removed`)
      if (opts.includeSummaries) console.log(`Summaries:     ${sumCount} would be removed`)
      if (opts.includeSessions)  console.log(`Sessions:      ${sessCount} would be removed`)

      if (opts.dryRun) {
        console.log("(dry-run, nothing actually deleted)")
        return
      }

      db.connection.prepare(`DELETE FROM observations WHERE created_at_epoch < ? ${agentClause}`)
        .run(cutoffEpoch, ...(agentBind as never[]))
      if (opts.includeSummaries) {
        db.connection.prepare(`DELETE FROM session_summaries WHERE created_at_epoch < ? ${agentClause}`)
          .run(cutoffEpoch, ...(agentBind as never[]))
      }
      if (opts.includeSessions) {
        db.connection.prepare(`DELETE FROM sessions WHERE started_at_epoch < ? ${agentClause}`)
          .run(cutoffEpoch, ...(agentBind as never[]))
      }
      console.log("Done. Consider running `claw-mem db vacuum` to reclaim space.")
    })

  // ─── mem export ───────────────────────────────────────────
  mem
    .command("export <file>")
    .description("Dump observations + summaries + sessions to a JSON file")
    .option("--agent <agentId>", "Limit to one agent")
    .action(async (file: string, opts: { agent?: string }) => {
      const where = opts.agent ? "WHERE agent_id = ?" : ""
      const bind: unknown[] = opts.agent ? [opts.agent] : []
      const observations = db.connection
        .prepare(`SELECT * FROM observations ${where} ORDER BY id`)
        .all(...(bind as never[])) as unknown[]
      const summaries = db.connection
        .prepare(`SELECT * FROM session_summaries ${where} ORDER BY id`)
        .all(...(bind as never[])) as unknown[]
      const sessions = db.connection
        .prepare(`SELECT * FROM sessions ${where}`)
        .all(...(bind as never[])) as unknown[]

      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        agentFilter: opts.agent ?? null,
        counts: { observations: observations.length, summaries: summaries.length, sessions: sessions.length },
        observations,
        summaries,
        sessions,
      }
      await writeFile(file, JSON.stringify(payload, null, 2))
      console.log(
        `Exported to ${file}: ${observations.length} observations, ` +
        `${summaries.length} summaries, ${sessions.length} sessions`,
      )
    })

  // ─── mem import ───────────────────────────────────────────
  mem
    .command("import <file>")
    .description("Restore observations + summaries + sessions from a `mem export` JSON file")
    .option("--skip-existing", "Skip rows whose primary key already exists", true)
    .action(async (file: string, opts: { skipExisting?: boolean }) => {
      const raw = await readFile(file, "utf-8")
      const payload = JSON.parse(raw) as {
        version?: number
        observations?: Array<Record<string, unknown>>
        summaries?: Array<Record<string, unknown>>
        sessions?: Array<Record<string, unknown>>
      }
      if (payload.version !== 1) {
        console.error(`Unknown export version: ${payload.version}`)
        process.exit(1)
      }
      let imported = { observations: 0, summaries: 0, sessions: 0 }

      const conflict = opts.skipExisting !== false ? "OR IGNORE" : "OR REPLACE"

      // Sessions first (FK dependency).
      if (payload.sessions) {
        const stmt = db.connection.prepare(
          `INSERT ${conflict} INTO sessions
           (session_id, agent_id, started_at, started_at_epoch,
            completed_at, completed_at_epoch, prompt_count, observation_count, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const s of payload.sessions) {
          const args = [
            s.session_id, s.agent_id, s.started_at, s.started_at_epoch,
            s.completed_at, s.completed_at_epoch,
            s.prompt_count ?? 0, s.observation_count ?? 0, s.status ?? "active",
          ] as never[]
          const r = stmt.run(...args)
          if (Number(r.changes) > 0) imported.sessions++
        }
      }

      if (payload.observations) {
        // Observations have no UNIQUE constraint, so `OR IGNORE` cannot dedupe.
        // When skipExisting is true, we manually check (session_id, content_hash).
        const stmt = db.connection.prepare(
          `INSERT ${conflict} INTO observations
           (session_id, agent_id, type, title, facts, narrative, concepts,
            files_read, files_modified, tool_name, prompt_number,
            token_estimate, content_hash, created_at, created_at_epoch)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        const existsStmt = db.connection.prepare(
          "SELECT 1 FROM observations WHERE session_id = ? AND content_hash = ? LIMIT 1",
        )
        for (const o of payload.observations) {
          if (opts.skipExisting !== false) {
            const exists = existsStmt.get(
              o.session_id as string,
              o.content_hash as string,
            )
            if (exists) continue
          }
          const args = [
            o.session_id, o.agent_id, o.type, o.title,
            o.facts, o.narrative, o.concepts,
            o.files_read, o.files_modified, o.tool_name, o.prompt_number,
            o.token_estimate, o.content_hash, o.created_at, o.created_at_epoch,
          ] as never[]
          const r = stmt.run(...args)
          if (Number(r.changes) > 0) imported.observations++
        }
      }

      if (payload.summaries) {
        const stmt = db.connection.prepare(
          `INSERT ${conflict} INTO session_summaries
           (session_id, agent_id, request, investigated, learned, completed,
            next_steps, notes, observation_count, token_estimate, created_at, created_at_epoch)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const s of payload.summaries) {
          const args = [
            s.session_id, s.agent_id, s.request, s.investigated, s.learned,
            s.completed, s.next_steps, s.notes,
            s.observation_count ?? 0, s.token_estimate ?? 0,
            s.created_at, s.created_at_epoch,
          ] as never[]
          const r = stmt.run(...args)
          if (Number(r.changes) > 0) imported.summaries++
        }
      }

      console.log(
        `Imported from ${file}: ${imported.observations} observations, ` +
        `${imported.summaries} summaries, ${imported.sessions} sessions`,
      )
    })

  // Touch unused-import lint guards
  void sessionStore
}

function pickRecentAgent(db: { connection: { prepare(sql: string): { get(): unknown } } }): string | null {
  const row = db.connection
    .prepare("SELECT agent_id FROM observations ORDER BY created_at_epoch DESC LIMIT 1")
    .get() as { agent_id: string } | undefined
  return row?.agent_id ?? null
}
