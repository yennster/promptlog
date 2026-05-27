import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
} from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  projectContext: text("project_context"),
  notes: text("notes"),
});

export const prompts = sqliteTable(
  "prompts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    app: text("app", {
      enum: ["claude", "chatgpt", "codex", "antigravity"],
    }).notNull(),
    promptText: text("prompt_text").notNull(),
    responseSnippet: text("response_snippet"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
    firstTokenAt: integer("first_token_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    latencyMs: integer("latency_ms"),
    detectedCwd: text("detected_cwd"),
  },
  (table) => ({
    sessionIdx: index("prompts_session_idx").on(table.sessionId),
    sentAtIdx: index("prompts_sent_at_idx").on(table.sentAt),
    appIdx: index("prompts_app_idx").on(table.app),
  }),
);

export const appState = sqliteTable("app_state", {
  bundleId: text("bundle_id").primaryKey(),
  lastComposerText: text("last_composer_text"),
  lastAssistantText: text("last_assistant_text"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
