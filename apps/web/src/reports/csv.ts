import type { Prompt, Session } from "@promptlog/db";
import { TARGET_APP_LABEL } from "@promptlog/shared";

export interface SessionBundle {
  session: Session;
  prompts: Prompt[];
}

// RFC4180 escaping: double quotes inside fields are doubled, fields containing
// commas / quotes / newlines are wrapped in quotes. Prompt/response text often
// contains all three, so quoting is the default for those columns.
function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const COLUMNS = [
  "session_id",
  "session_name",
  "session_started_at",
  "session_ended_at",
  "project_context",
  "prompt_id",
  "sent_at",
  "completed_at",
  "app",
  "latency_ms",
  "est_prompt_tokens",
  "est_response_tokens",
  "est_cost_usd",
  "detected_cwd",
  "prompt_text",
  "response_snippet",
] as const;

// One row per prompt, with leading session columns so multi-session exports
// stay flat and pivotable. Header row matches COLUMNS exactly.
export function buildSessionsCsv(bundles: SessionBundle[]): string {
  const lines: string[] = [COLUMNS.join(",")];
  for (const { session, prompts } of bundles) {
    if (prompts.length === 0) {
      // Surface empty sessions too — otherwise a CSV for "all my sessions"
      // would silently omit ones with no captures, which looks like data loss.
      lines.push(
        [
          escape(session.id),
          escape(session.name),
          escape(session.startedAt),
          escape(session.endedAt),
          escape(session.projectContext),
          ...Array(COLUMNS.length - 5).fill(""),
        ].join(","),
      );
      continue;
    }
    for (const p of prompts) {
      lines.push(
        [
          escape(session.id),
          escape(session.name),
          escape(session.startedAt),
          escape(session.endedAt),
          escape(session.projectContext),
          escape(p.id),
          escape(p.sentAt),
          escape(p.completedAt),
          escape(TARGET_APP_LABEL[p.app]),
          escape(p.latencyMs),
          escape(p.estPromptTokens),
          escape(p.estResponseTokens),
          escape(p.estCostUsd),
          escape(p.detectedCwd),
          escape(p.promptText),
          escape(p.responseSnippet),
        ].join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}
