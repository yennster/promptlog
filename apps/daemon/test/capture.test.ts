import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Sandboxed HOME environment so tests don't touch real files or databases
const tempHome = mkdtempSync(join(tmpdir(), "promptlog-capture-test-"));
process.env.HOME = tempHome;

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../../../packages/db/drizzle");

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic imports to prevent ESM import hoisting from reading the real HOME
const { db, sqlite } = await import("@promptlog/db");
const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { getSessionPrompts, createSession } = await import("@promptlog/db/queries");

// Run migrations on the temporary DB
migrate(db, { migrationsFolder });

const { CaptureLoop } = await import("../src/capture.js");
import type { AxClient } from "../src/ax.js";

// Mock AxClient for the CaptureLoop
class FakeAxClient {
  focusedAppResponse = { ok: true, bundleId: "com.microsoft.VSCode", windowTitle: "main.ts — promptlog" };
  snapshotResponse = { ok: true, composer: "", lastAssistantText: "", lastUserText: "" };

  async focusedApp() {
    return this.focusedAppResponse;
  }

  async snapshot(bundleId: string) {
    return this.snapshotResponse;
  }

  binaryExists() {
    return true;
  }

  binaryPath() {
    return "/fake/path";
  }

  stop() {}
}

test("CaptureLoop — First snapshot baseline guard works", async () => {
  const fakeClient = new FakeAxClient() as unknown as AxClient;
  const loop = new CaptureLoop(fakeClient);
  loop.autoSchedule = false;
  const session = createSession({ name: "Startup Guard Test" });

  // Scenario: Pre-existing chat history is present before clicking Record
  (fakeClient as any).snapshotResponse = {
    ok: true,
    composer: "",
    lastAssistantText: "Agent: Hello!",
    lastUserText: "User message\nwhat tasks are still running\n12:00 PM\nCopy",
  };

  loop.start(session.id);
  (loop as any).settings.enabledApps = {
    claude: false,
    chatgpt: false,
    codex: false,
    antigravity: true,
  };

  // 1. First tick — baseline snapshot should be established, no prompt logged!
  await (loop as any).tick();

  let prompts = getSessionPrompts(session.id);
  assert.equal(prompts.length, 0, "No prompts should be logged on the very first snapshot");

  // 2. Second tick — user sends a new prompt "hello new day"
  (fakeClient as any).snapshotResponse = {
    ok: true,
    composer: "",
    lastAssistantText: "Agent: Hello!",
    lastUserText: "User message\nhello new day\n12:01 PM\nCopy",
  };

  await (loop as any).tick();

  prompts = getSessionPrompts(session.id);
  assert.equal(prompts.length, 1, "Should log a prompt when a new user bubble appears");
  assert.equal(prompts[0].promptText, "hello new day");

  loop.stop();
  if ((loop as any).timer) {
    clearTimeout((loop as any).timer);
    (loop as any).timer = null;
  }
});

test("CaptureLoop — Keystroke draft guard prevents logging unsent drafts", async () => {
  const fakeClient = new FakeAxClient() as unknown as AxClient;
  const loop = new CaptureLoop(fakeClient);
  loop.autoSchedule = false;
  const session = createSession({ name: "Draft Guard Test" });

  // 1. First tick (baseline)
  (fakeClient as any).snapshotResponse = {
    ok: true,
    composer: "",
    lastAssistantText: "",
    lastUserText: "",
  };
  loop.start(session.id);
  (loop as any).settings.enabledApps = {
    claude: false,
    chatgpt: false,
    codex: false,
    antigravity: true,
  };
  await (loop as any).tick();

  // 2. Second tick — User is typing "can you"
  // Since Antigravity labels the active composer as part of User message groups occasionally,
  // we mock snap.composer matching the lastUserText.
  (fakeClient as any).snapshotResponse = {
    ok: true,
    composer: "can you",
    lastAssistantText: "",
    lastUserText: "User message\ncan you\n12:00 PM\nCopy",
  };
  await (loop as any).tick();

  let prompts = getSessionPrompts(session.id);
  assert.equal(prompts.length, 0, "Unsent composer draft should NOT be logged as a prompt");

  // 3. Third tick — User completes typing and sends the message
  (fakeClient as any).snapshotResponse = {
    ok: true,
    composer: "", // composer cleared on submit
    lastAssistantText: "Agent: How can I help?",
    lastUserText: "User message\ncan you please help me\n12:01 PM\nCopy",
  };
  await (loop as any).tick();

  prompts = getSessionPrompts(session.id);
  assert.equal(prompts.length, 1, "Prompt should be logged once it is officially sent");
  assert.equal(prompts[0].promptText, "can you please help me");

  loop.stop();
  if ((loop as any).timer) {
    clearTimeout((loop as any).timer);
    (loop as any).timer = null;
  }
});

// Clean up database connection and sandboxed HOME directory after all tests
test.after(() => {
  sqlite.close();
  rmSync(tempHome, { recursive: true, force: true });
});
