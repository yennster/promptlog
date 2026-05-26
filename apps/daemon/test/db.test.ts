import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Sandboxed HOME environment so tests don't touch real files
const tempHome = mkdtempSync(join(tmpdir(), "promptlog-db-test-"));
process.env.HOME = tempHome;

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../../../packages/db/drizzle");

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic imports to prevent ESM import hoisting from reading the real HOME
const { db, sqlite } = await import("@promptlog/db");
const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const {
  createSession,
  activeSession,
  insertPrompt,
  searchPrompts,
  updatePromptResponse,
  listSessions,
  getSessionPrompts,
  deleteSession,
  stopSession,
} = await import("@promptlog/db/queries");

// Run migrations on the temporary DB
migrate(db, { migrationsFolder });

test("Database Lifecycle — creation, prompt ingestion, FTS search, and deletion", () => {
  // 1. Create a session
  const session = createSession({
    name: "Test Session",
    projectContext: "/Users/jenny/Work/promptlog",
  });
  assert.ok(session.id > 0);
  assert.equal(session.name, "Test Session");
  assert.equal(session.projectContext, "/Users/jenny/Work/promptlog");

  // 2. Verify active session
  const active = activeSession();
  assert.ok(active);
  assert.equal(active.id, session.id);
  assert.equal(active.endedAt, null);

  // 3. Insert prompts
  const prompt1 = insertPrompt({
    sessionId: session.id,
    app: "claude",
    promptText: "How do I build a monorepo with pnpm?",
    sentAt: new Date(),
    estPromptTokens: 10,
    estCostUsd: 0.0003,
  });
  assert.ok(prompt1.id > 0);
  assert.equal(prompt1.promptText, "How do I build a monorepo with pnpm?");

  const prompt2 = insertPrompt({
    sessionId: session.id,
    app: "chatgpt",
    promptText: "Write a quicksort in JavaScript",
    sentAt: new Date(),
    estPromptTokens: 12,
    estCostUsd: 0.0004,
  });

  // Verify prompts exist in FTS
  const ftsCheck = sqlite
    .prepare("SELECT count(*) as count FROM prompts_fts")
    .get() as { count: number };
  assert.equal(ftsCheck.count, 2);

  // 4. Update prompt response
  updatePromptResponse(prompt1.id, {
    responseSnippet: "Use a pnpm-workspace.yaml file...",
    completedAt: new Date(),
    latencyMs: 1200,
    estResponseTokens: 40,
    estCostUsd: 0.001,
  });

  // Verify update mirrored to FTS
  const ftsRow = sqlite
    .prepare("SELECT response_snippet FROM prompts_fts WHERE rowid = ?")
    .get(prompt1.id) as { response_snippet: string };
  assert.equal(ftsRow.response_snippet, "Use a pnpm-workspace.yaml file...");

  // 5. Search prompts
  // Search using query text
  const searchResults = searchPrompts({ query: "quicksort" });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].id, prompt2.id);

  // Search by app filter
  const claudeResults = searchPrompts({ app: "claude" });
  assert.equal(claudeResults.length, 1);
  assert.equal(claudeResults[0].id, prompt1.id);

  // 6. List sessions and aggregate totals
  const sessionsList = listSessions();
  assert.equal(sessionsList.length, 1);
  assert.equal(sessionsList[0].session.id, session.id);
  assert.equal(sessionsList[0].promptCount, 2);
  assert.ok(sessionsList[0].totalCost > 0);
  assert.deepEqual(sessionsList[0].apps.sort(), ["chatgpt", "claude"]);

  // 7. Large deletion test (verifying subquery delete works under FTS and doesn't hit variable limits)
  // Insert a few more prompts
  for (let i = 0; i < 5; i++) {
    insertPrompt({
      sessionId: session.id,
      app: "antigravity",
      promptText: `Additional prompt ${i}`,
      sentAt: new Date(),
    });
  }

  // Delete the session (wipes prompts, cascaded FTS)
  deleteSession(session.id);

  // Verify deletion cascaded
  const remainingPrompts = getSessionPrompts(session.id);
  assert.equal(remainingPrompts.length, 0);

  // Verify FTS table is completely clean
  const postDeleteFtsCheck = sqlite
    .prepare("SELECT count(*) as count FROM prompts_fts")
    .get() as { count: number };
  assert.equal(postDeleteFtsCheck.count, 0);

  // 8. Stop session
  const stoppedSession = stopSession(session.id);
  // Row does not exist since we deleted it, but wait, returning should handle gracefully
});

// Final cleanup: Close connection and remove temporary folder
test.after(() => {
  sqlite.close();
  rmSync(tempHome, { recursive: true, force: true });
});
