import { test } from "node:test";
import assert from "node:assert/strict";
import type { Prompt, Session } from "@promptlog/db";
import {
  buildSessionsCsv,
  type SessionBundle,
} from "../../web/src/reports/csv";

function sess(id: number, overrides: Partial<Session> = {}): Session {
  return {
    id,
    name: `Session ${id}`,
    startedAt: new Date("2026-05-26T20:00:00Z"),
    endedAt: new Date("2026-05-26T20:30:00Z"),
    projectContext: "~/Work/promptlog",
    notes: null,
    ...overrides,
  };
}

function prompt(id: number, overrides: Partial<Prompt> = {}): Prompt {
  return {
    id,
    sessionId: 1,
    app: "claude",
    promptText: "Write a quicksort",
    responseSnippet: "Here is the implementation...",
    sentAt: new Date("2026-05-26T20:05:00Z"),
    firstTokenAt: null,
    completedAt: new Date("2026-05-26T20:05:08Z"),
    latencyMs: 8000,
    estPromptTokens: 12,
    estResponseTokens: 142,
    estCostUsd: 0.0034,
    detectedCwd: "~/Work/promptlog",
    ...overrides,
  };
}

test("buildSessionsCsv — header row uses stable column order", () => {
  const csv = buildSessionsCsv([{ session: sess(1), prompts: [prompt(10)] }]);
  const [header] = csv.split("\n");
  assert.equal(
    header,
    "session_id,session_name,session_started_at,session_ended_at,project_context,prompt_id,sent_at,completed_at,app,latency_ms,est_prompt_tokens,est_response_tokens,est_cost_usd,detected_cwd,prompt_text,response_snippet",
  );
});

test("buildSessionsCsv — quotes/commas/newlines are RFC4180-escaped", () => {
  const bundle: SessionBundle = {
    session: sess(1, { name: 'Has "quotes" and, commas' }),
    prompts: [
      prompt(10, {
        promptText: 'Multi-line\nprompt with "quote"',
        responseSnippet: "Plain response",
      }),
    ],
  };
  const csv = buildSessionsCsv([bundle]);
  // Don't split by \n — the quoted prompt cell intentionally contains one.
  // Assert against the whole CSV instead so the embedded newline doesn't
  // confuse the test.
  assert.ok(
    csv.includes('"Has ""quotes"" and, commas"'),
    "session name should be RFC4180-escaped",
  );
  assert.ok(
    csv.includes('"Multi-line\nprompt with ""quote"""'),
    "prompt text should preserve newlines inside quotes",
  );
});

test("buildSessionsCsv — empty session emits a row with blank prompt cells", () => {
  const csv = buildSessionsCsv([{ session: sess(7), prompts: [] }]);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 2, "header + one summary row");
  const cells = lines[1].split(",");
  // First five columns (session fields) should be populated, remaining empty.
  assert.equal(cells[0], "7");
  assert.equal(cells[5], "", "prompt_id should be empty for empty session");
  assert.equal(cells[14], "", "prompt_text should be empty for empty session");
});

test("buildSessionsCsv — multi-session export preserves session ordering", () => {
  const csv = buildSessionsCsv([
    { session: sess(1), prompts: [prompt(10), prompt(11, { id: 11 })] },
    { session: sess(2, { name: "Second" }), prompts: [prompt(20, { id: 20 })] },
  ]);
  const lines = csv.trim().split("\n");
  // 3 prompt rows + header.
  assert.equal(lines.length, 4);
  // First two data rows are from session 1.
  assert.ok(lines[1].startsWith("1,"));
  assert.ok(lines[2].startsWith("1,"));
  // Third data row is session 2.
  assert.ok(lines[3].startsWith("2,"));
});

test("buildSessionsCsv — null fields render as empty cells", () => {
  const csv = buildSessionsCsv([
    {
      session: sess(1, { projectContext: null, endedAt: null }),
      prompts: [
        prompt(10, {
          responseSnippet: null,
          latencyMs: null,
          detectedCwd: null,
          completedAt: null,
        }),
      ],
    },
  ]);
  const cells = csv.trim().split("\n")[1].split(",");
  // session_ended_at, project_context, completed_at, latency_ms, detected_cwd,
  // response_snippet should all be empty strings.
  assert.equal(cells[3], "", "session_ended_at empty");
  assert.equal(cells[4], "", "project_context empty");
  assert.equal(cells[7], "", "completed_at empty");
  assert.equal(cells[9], "", "latency_ms empty");
  assert.equal(cells[13], "", "detected_cwd empty");
  assert.equal(cells[15], "", "response_snippet empty");
});
