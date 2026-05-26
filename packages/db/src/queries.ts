import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, prompts, sessions, sqlite, type NewPrompt } from "./index";
import type { TargetApp } from "@promptlog/shared";

export function createSession(opts: {
  name: string;
  projectContext?: string | null;
}) {
  const row = db
    .insert(sessions)
    .values({
      name: opts.name,
      projectContext: opts.projectContext ?? null,
    })
    .returning()
    .get();
  return row;
}

export function stopSession(id: number) {
  const row = db
    .update(sessions)
    .set({ endedAt: new Date() })
    .where(eq(sessions.id, id))
    .returning()
    .get();
  return row;
}

export function deleteSession(id: number) {
  // FTS5 has no foreign key cascade, so wipe its rows first by id using a subquery.
  // This avoids retrieving all IDs into JavaScript and avoids SQLite's parameter limits.
  sqlite
    .prepare("DELETE FROM prompts_fts WHERE rowid IN (SELECT id FROM prompts WHERE session_id = ?)")
    .run(id);

  // The prompts.session_id foreign key has onDelete cascade, so deleting
  // the session row removes its prompts too.
  const row = db
    .delete(sessions)
    .where(eq(sessions.id, id))
    .returning()
    .get();
  return row;
}

export function activeSession() {
  return db
    .select()
    .from(sessions)
    .where(isNull(sessions.endedAt))
    .orderBy(desc(sessions.startedAt))
    .limit(1)
    .get();
}

export function listSessions(limit = 100) {
  // Drizzle renders column references unqualified by default when selecting
  // from a single table. That breaks correlated subqueries — the inner
  // `WHERE prompts.session_id = id` reads `id` as `prompts.id` (because the
  // subquery's FROM is `prompts`), not `sessions.id`. So qualify the outer
  // reference with sql.raw to force "sessions"."id".
  const sessionIdRef = sql.raw('"sessions"."id"');
  const rows = db
    .select({
      session: sessions,
      promptCount: sql<number>`(
        SELECT COUNT(*) FROM ${prompts} WHERE ${prompts.sessionId} = ${sessionIdRef}
      )`,
      totalCost: sql<number>`(
        SELECT COALESCE(SUM(${prompts.estCostUsd}), 0)
        FROM ${prompts} WHERE ${prompts.sessionId} = ${sessionIdRef}
      )`,
      // Comma-separated list of distinct apps used in the session — empty
      // string when no prompts yet. Parsed into a TargetApp[] before return.
      appsRaw: sql<string>`(
        SELECT COALESCE(GROUP_CONCAT(DISTINCT ${prompts.app}), '')
        FROM ${prompts} WHERE ${prompts.sessionId} = ${sessionIdRef}
      )`,
    })
    .from(sessions)
    .orderBy(desc(sessions.startedAt))
    .limit(limit)
    .all();
  return rows.map(({ appsRaw, ...rest }) => ({
    ...rest,
    apps: appsRaw
      ? (appsRaw.split(",").filter(Boolean) as TargetApp[])
      : ([] as TargetApp[]),
  }));
}

export function getSession(id: number) {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

export function getSessionPrompts(sessionId: number) {
  return db
    .select()
    .from(prompts)
    .where(eq(prompts.sessionId, sessionId))
    .orderBy(prompts.sentAt)
    .all();
}

export function insertPrompt(row: NewPrompt) {
  const inserted = db.insert(prompts).values(row).returning().get();
  // Mirror into FTS index
  sqlite
    .prepare(
      "INSERT INTO prompts_fts(rowid, prompt_text, response_snippet) VALUES (?, ?, ?)",
    )
    .run(inserted.id, inserted.promptText, inserted.responseSnippet ?? "");
  return inserted;
}

export function updatePromptResponse(
  id: number,
  patch: {
    responseSnippet?: string;
    firstTokenAt?: Date | null;
    completedAt?: Date | null;
    latencyMs?: number | null;
    estResponseTokens?: number | null;
    estCostUsd?: number | null;
  },
) {
  const updated = db
    .update(prompts)
    .set(patch)
    .where(eq(prompts.id, id))
    .returning()
    .get();
  if (patch.responseSnippet !== undefined) {
    sqlite
      .prepare(
        "UPDATE prompts_fts SET response_snippet = ? WHERE rowid = ?",
      )
      .run(patch.responseSnippet ?? "", id);
  }
  return updated;
}

export interface SearchFilters {
  query?: string;
  app?: TargetApp;
  sessionId?: number;
  from?: Date;
  to?: Date;
  limit?: number;
}

export function searchPrompts(filters: SearchFilters) {
  const limit = filters.limit ?? 200;
  if (filters.query && filters.query.trim()) {
    // FTS path
    const escaped = filters.query.replaceAll('"', '""');
    const ftsRows = sqlite
      .prepare(
        `SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(`"${escaped}"*`, limit) as { rowid: number }[];
    const ids = ftsRows.map((r) => r.rowid);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = sqlite
      .prepare(
        `SELECT * FROM prompts WHERE id IN (${placeholders}) ORDER BY sent_at DESC`,
      )
      .all(...ids) as Array<Record<string, unknown>>;
    return rows.map(rowToPrompt).filter((r) => matchesFilters(r, filters));
  }
  const conditions = [] as ReturnType<typeof eq>[];
  if (filters.app) conditions.push(eq(prompts.app, filters.app));
  if (filters.sessionId)
    conditions.push(eq(prompts.sessionId, filters.sessionId));
  if (filters.from) conditions.push(gte(prompts.sentAt, filters.from));
  if (filters.to) conditions.push(lte(prompts.sentAt, filters.to));
  const q = db
    .select()
    .from(prompts)
    .orderBy(desc(prompts.sentAt))
    .limit(limit);
  return conditions.length ? q.where(and(...conditions)).all() : q.all();
}

function rowToPrompt(r: Record<string, unknown>) {
  return {
    id: r.id as number,
    sessionId: r.session_id as number,
    app: r.app as TargetApp,
    promptText: r.prompt_text as string,
    responseSnippet: r.response_snippet as string | null,
    sentAt: new Date(r.sent_at as number),
    firstTokenAt: r.first_token_at ? new Date(r.first_token_at as number) : null,
    completedAt: r.completed_at ? new Date(r.completed_at as number) : null,
    latencyMs: r.latency_ms as number | null,
    estPromptTokens: r.est_prompt_tokens as number | null,
    estResponseTokens: r.est_response_tokens as number | null,
    estCostUsd: r.est_cost_usd as number | null,
    detectedCwd: r.detected_cwd as string | null,
  };
}

function matchesFilters(
  p: ReturnType<typeof rowToPrompt>,
  f: SearchFilters,
) {
  if (f.app && p.app !== f.app) return false;
  if (f.sessionId && p.sessionId !== f.sessionId) return false;
  if (f.from && p.sentAt < f.from) return false;
  if (f.to && p.sentAt > f.to) return false;
  return true;
}
