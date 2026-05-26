import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR, DB_PATH } from "@promptlog/shared";
import * as schema from "./schema";

mkdirSync(dirname(DB_PATH), { recursive: true });

// One-time migration from the old data dir (~/.audit-tracker) to the new one
// (~/.promptlog). We rename the DB file and bring along its WAL siblings so
// users who recorded prior sessions don't lose them after the project rename.
const legacyDir = `${process.env.HOME ?? ""}/.audit-tracker`;
const legacyDb = join(legacyDir, "audit.db");
if (!existsSync(DB_PATH) && existsSync(legacyDb)) {
  renameSync(legacyDb, DB_PATH);
  for (const sibling of ["audit.db-wal", "audit.db-shm"]) {
    const from = join(legacyDir, sibling);
    if (existsSync(from)) {
      renameSync(from, join(DATA_DIR, sibling.replace("audit", "promptlog")));
    }
  }
  const legacySettings = join(legacyDir, "settings.json");
  if (existsSync(legacySettings)) {
    renameSync(legacySettings, join(DATA_DIR, "settings.json"));
  }
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// FTS5 search index over prompt text + response. Stored as its own
// content-bearing table (NOT external-content) so plain INSERT/UPDATE/DELETE
// just work — external-content mode has special rules around DELETE that
// corrupt the index if mishandled.
ensureFts();

function ensureFts() {
  // Migrate away from the older external-content FTS5 schema (`content='prompts'`)
  // which had different behaviour, AND repair from any prior corruption.
  const tbl = sqlite
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='prompts_fts'",
    )
    .get() as { sql?: string } | undefined;
  const isExternalContent =
    typeof tbl?.sql === "string" && tbl.sql.includes("content='prompts'");
  let corrupted = false;
  if (tbl && !isExternalContent) {
    try {
      sqlite.prepare("SELECT count(*) FROM prompts_fts").get();
    } catch {
      corrupted = true;
    }
  }
  if (isExternalContent || corrupted) {
    sqlite.exec("DROP TABLE IF EXISTS prompts_fts;");
  }
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
      prompt_text,
      response_snippet,
      tokenize='porter unicode61'
    );
  `);
  if (isExternalContent || corrupted) {
    sqlite.exec(
      "INSERT INTO prompts_fts(rowid, prompt_text, response_snippet) " +
        "SELECT id, prompt_text, COALESCE(response_snippet,'') FROM prompts;",
    );
  }
}

export const db = drizzle(sqlite, { schema });
export { sqlite };
export * from "./schema";
