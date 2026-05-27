import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Sandboxed HOME environment so tests don't touch real files
const tempHome = mkdtempSync(join(tmpdir(), "promptlog-settings-test-"));
process.env.HOME = tempHome;

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic import to prevent ESM import hoisting from reading the real HOME
const { readDaemonSettings } = await import("../src/settings.js");
const { SETTINGS_PATH } = await import("@promptlog/shared");

test("readDaemonSettings — returns defaults when settings.json does not exist", () => {
  const settings = readDaemonSettings();
  assert.equal(settings.enabledApps.claude, true);
  assert.equal(settings.enabledApps.antigravity, true);
});

test("readDaemonSettings — merges enabledApps overrides", () => {
  mkdirSync(join(tempHome, ".promptlog"), { recursive: true });

  const customConfig = {
    enabledApps: {
      chatgpt: false,
    },
  };

  writeFileSync(SETTINGS_PATH, JSON.stringify(customConfig), "utf8");

  try {
    const settings = readDaemonSettings();
    assert.equal(settings.enabledApps.chatgpt, false);
    assert.equal(settings.enabledApps.claude, true);
    assert.equal(settings.enabledApps.codex, true);
    assert.equal(settings.enabledApps.antigravity, true);
  } finally {
    rmSync(SETTINGS_PATH, { force: true });
  }
});

test("readDaemonSettings — handles corrupted json elegantly", () => {
  mkdirSync(join(tempHome, ".promptlog"), { recursive: true });
  writeFileSync(SETTINGS_PATH, "{invalid-json}", "utf8");

  try {
    const settings = readDaemonSettings();
    assert.equal(settings.enabledApps.claude, true);
  } finally {
    rmSync(SETTINGS_PATH, { force: true });
    rmSync(tempHome, { recursive: true, force: true });
  }
});
