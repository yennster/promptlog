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
const { DEFAULT_COST_RATES, SETTINGS_PATH } = await import("@promptlog/shared");

test("readDaemonSettings — returns defaults when settings.json does not exist", () => {
  const settings = readDaemonSettings();
  assert.deepEqual(settings.costRates, DEFAULT_COST_RATES);
  assert.equal(settings.enabledApps.claude, true);
  assert.equal(settings.enabledApps.antigravity, true);
});

test("readDaemonSettings — correctly deep-merges partially customized rates", () => {
  // Ensure the directory for the settings path exists
  mkdirSync(join(tempHome, ".promptlog"), { recursive: true });

  // Customizing ONLY Claude's input rate
  const customConfig = {
    costRates: {
      claude: { input: 12.34 },
    },
    enabledApps: {
      chatgpt: false,
    },
  };

  writeFileSync(SETTINGS_PATH, JSON.stringify(customConfig), "utf8");

  try {
    const settings = readDaemonSettings();

    // Verify deep merge: Claude input is custom, Claude output is default!
    assert.equal(settings.costRates.claude.input, 12.34);
    assert.equal(settings.costRates.claude.output, DEFAULT_COST_RATES.claude.output);

    // Verify other apps are unaffected and retain their default rates
    assert.equal(settings.costRates.chatgpt.input, DEFAULT_COST_RATES.chatgpt.input);
    assert.equal(settings.costRates.chatgpt.output, DEFAULT_COST_RATES.chatgpt.output);

    // Verify enabledApps are merged correctly
    assert.equal(settings.enabledApps.chatgpt, false);
    assert.equal(settings.enabledApps.claude, true); // default
  } finally {
    // Cleanup settings file for this test
    rmSync(SETTINGS_PATH, { force: true });
  }
});

test("readDaemonSettings — handles corrupted json elegantly", () => {
  mkdirSync(join(tempHome, ".promptlog"), { recursive: true });
  writeFileSync(SETTINGS_PATH, "{invalid-json}", "utf8");

  try {
    const settings = readDaemonSettings();
    assert.deepEqual(settings.costRates, DEFAULT_COST_RATES);
  } finally {
    rmSync(SETTINGS_PATH, { force: true });
    // Cleanup temporary directory
    rmSync(tempHome, { recursive: true, force: true });
  }
});
