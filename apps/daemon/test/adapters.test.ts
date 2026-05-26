// Tests for the AX-blob filtering pipeline. Run with:
//   pnpm -C apps/daemon test
//
// Two flavors of tests:
//   1. Synthetic — hand-written inputs that pin specific filter behaviors.
//   2. Fixture — recorded real AX snapshots from running apps. Capture more
//      with: pnpm -C apps/daemon ax:record claude test/fixtures/foo.json 30
//
// The fixture tests don't pin exact response text (the live conversation
// changes between captures); they assert structural properties like
// "extracted output is shorter than raw blob" and "extracted doesn't contain
// known chrome strings".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractAssistantResponse,
  stripChrome,
} from "../src/adapters.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, "fixtures");

test("stripChrome removes Copy/Edit/Retry only as standalone lines", () => {
  const input = [
    "Click Edit to change this.",
    "Copy",
    "The Retry button is on the right.",
    "Retry",
    "Settings panel is here.",
    "Settings",
  ].join("\n");
  const result = stripChrome("claude", input);
  // Standalone chrome lines dropped.
  assert.ok(!result.split("\n").includes("Copy"));
  assert.ok(!result.split("\n").includes("Retry"));
  assert.ok(!result.split("\n").includes("Settings"));
  // Words inside prose survive.
  assert.ok(result.includes("Click Edit to change this."));
  assert.ok(result.includes("The Retry button is on the right."));
  assert.ok(result.includes("Settings panel is here."));
});

test("stripChrome dedupes consecutive identical lines", () => {
  const input = "Pineapples grow on plants.\nPineapples grow on plants.\nPineapples grow on plants.";
  const result = stripChrome("claude", input);
  assert.equal(result, "Pineapples grow on plants.");
});

test("stripChrome strips per-message footer chrome", () => {
  const input = [
    "Bananas are berries.",
    "Copy message",
    "Pin as chapter",
    "2m ago",
  ].join("\n");
  const result = stripChrome("claude", input);
  assert.equal(result, "Bananas are berries.");
});

test("stripChrome strips dynamic chrome (Ran N commands, X additions, etc)", () => {
  const input = [
    "Here's what I did.",
    "Ran 11 commands",
    "Ran 2 commands, created a file",
    "238 additions, 0 deletions",
    "3.1k tokens",
    "Usage: context 13%, plan 41%",
    "Opus 4.7 1M · High",
    "2m 31s",
    "17m ago",
  ].join("\n");
  const result = stripChrome("claude", input);
  assert.equal(result, "Here's what I did.");
});

test("stripChrome strips fragmented tool-use breadcrumbs", () => {
  // Claude desktop's AX tree splits "Ran 11 commands" into separate AX nodes:
  // ["Ran", " ", "11 commands"], so the daemon sees each piece on its own line.
  const input = [
    "The actual response.",
    "Ran 11 commands",
    "Ran",
    "11 commands",
    "Ran 2 commands, created a file",
    "Ran",
    "2 commands",
    ",",
    "created",
    "a file",
  ].join("\n");
  const result = stripChrome("claude", input);
  assert.equal(result, "The actual response.");
});

test("stripChrome strips composer + status bar chrome", () => {
  const input = [
    "The actual response goes here.",
    "Chat mode",
    "Type / for commands",
    "Prompt",
    "Stop",
    "Auto",
    "Add",
    "Dictation",
    "Press and hold to record",
    "Dictation settings",
    "Arrow keys move the tile. Perpendicular arrows preview a split; press Enter to commit or Escape to cancel.",
  ].join("\n");
  const result = stripChrome("claude", input);
  assert.equal(result, "The actual response goes here.");
});

test("extractAssistantResponse anchors on prompt and strips chrome", () => {
  const blob = [
    "Some earlier conversation context",
    "Copy message",
    "Pin as chapter",
    "10m ago",
    "What's a random fact?",  // user prompt
    "Copy message",
    "Rewind to here",
    "Fork from here",
    "5m ago",
    "Bananas are berries, but strawberries aren't.",
    "Copy message",
    "Pin as chapter",
    "2m ago",
    "Type / for commands",
  ].join("\n");
  const result = extractAssistantResponse(
    "claude",
    blob,
    "What's a random fact?",
  );
  assert.equal(result, "Bananas are berries, but strawberries aren't.");
});

test("extractAssistantResponse — multi-line response survives", () => {
  const blob = [
    "Tell me a story",  // prompt
    "Once upon a time, there was a wombat.",
    "The wombat had cube-shaped poop.",
    "The end.",
    "Copy message",
    "Pin as chapter",
    "1m ago",
  ].join("\n");
  const result = extractAssistantResponse("claude", blob, "Tell me a story");
  assert.equal(
    result,
    "Once upon a time, there was a wombat.\nThe wombat had cube-shaped poop.\nThe end.",
  );
});

test("antigravity: strips Agent response label + bubble chrome", () => {
  const blob = [
    "Agent response",
    "It looks like your message might have been a typo.",
    "How can I help you today?",
    "9:57 PM",
    "Copy",
    "Good response",
    "Bad response",
  ].join("\n");
  const result = stripChrome("antigravity", blob);
  assert.equal(
    result,
    "It looks like your message might have been a typo.\nHow can I help you today?",
  );
});

test("chatgpt: strips composer placeholder + disclaimer + Copy/Regenerate", () => {
  // ChatGPT's AX tree is the cleanest of the four target apps — assistant
  // text comes through with no per-message chrome in the captured group most
  // of the time. The filters below still need to handle the cases that DO
  // appear: composer placeholder leaking, footer disclaimer, regenerate.
  const blob = [
    "Send a message",
    "Here is a list of three random facts:",
    "1. Octopuses have three hearts.",
    "2. Honey never spoils.",
    "3. Bananas are berries.",
    "Copy",
    "Regenerate",
    "ChatGPT can make mistakes. Check important info.",
  ].join("\n");
  const result = stripChrome("chatgpt", blob);
  assert.equal(
    result,
    "Here is a list of three random facts:\n1. Octopuses have three hearts.\n2. Honey never spoils.\n3. Bananas are berries.",
  );
});

test("chatgpt: prompt anchoring extracts response only", () => {
  const blob = [
    "What are some random facts?",
    "Send a message",
    "What are some random facts?",
    "Here are three:",
    "Octopuses have three hearts.",
    "Honey never spoils.",
    "Copy",
    "Regenerate",
    "ChatGPT can make mistakes.",
  ].join("\n");
  const result = extractAssistantResponse(
    "chatgpt",
    blob,
    "What are some random facts?",
  );
  assert.equal(
    result,
    "Here are three:\nOctopuses have three hearts.\nHoney never spoils.",
  );
});

test("codex: strips per-message chrome and model badge", () => {
  const blob = [
    "Edit user message",
    "laskdfjlsdkjf",
    "9:58 PM",
    "Copy message",
    "Edit message",
    "I'm here. What would you like me to do?",
    "Copy",
    "Good response",
    "Bad response",
    "Fork from this point",
    "9:58 PM",
    "Ask for follow-up changes",
    "Add files and more",
    "Auto-review",
    "5.5 Extra High",
    "5.5",
    "Extra High",
    "Dictate",
  ].join("\n");
  const result = stripChrome("codex", blob);
  assert.equal(
    result,
    "laskdfjlsdkjf\nI'm here. What would you like me to do?",
  );
});

test("extractAssistantResponse — prose containing chrome-word survives", () => {
  // Regression: earlier filters used /\bRetry\b/g which would strip the word
  // out of real prose. Make sure the new line-based filter doesn't.
  const blob = [
    "How do I retry?",
    "Click the Retry button or press Cmd+R to retry the failed request. Settings can also be adjusted.",
    "Copy message",
  ].join("\n");
  const result = extractAssistantResponse("claude", blob, "How do I retry?");
  assert.equal(
    result,
    "Click the Retry button or press Cmd+R to retry the failed request. Settings can also be adjusted.",
  );
});

// Fixture-driven structural tests. These won't pin exact response text — the
// fixture content drifts as the live conversation changes — but they verify
// that for any recorded snapshot, the cleaned output is shorter than the raw
// and free of known chrome strings.
const FORBIDDEN_CHROME = [
  // Claude desktop
  "Copy message",
  "Pin as chapter",
  "Rewind to here",
  "Fork from here",
  "Type / for commands",
  "Dictation settings",
  "Press and hold to record",
  "Use voice mode",
  // ChatGPT
  "Send a message",
  "Regenerate",
  // Antigravity
  "Agent response",
  "Good response",
  "Bad response",
  "Ask anything, @ to mention, / for actions",
  // Codex
  "Edit user message",
  "Edit message",
  "Fork from this point",
  "Ask for follow-up changes",
];

if (existsSync(FIXTURE_DIR)) {
  for (const name of readdirSync(FIXTURE_DIR).filter((n) => n.endsWith(".json"))) {
    test(`fixture[${name}] — cleaned blob has no known chrome`, () => {
      const data = JSON.parse(
        readFileSync(resolve(FIXTURE_DIR, name), "utf8"),
      );
      let checked = 0;
      for (const snap of data.snaps) {
        const cleaned = stripChrome(data.app, snap.lastAssistantText);
        // Cleaned should not contain any standalone chrome line.
        for (const chrome of FORBIDDEN_CHROME) {
          const standaloneLine = cleaned
            .split("\n")
            .some((l) => l.trim() === chrome);
          assert.ok(
            !standaloneLine,
            `snap @${snap.ts} still contains standalone "${chrome}":\n${cleaned.slice(0, 500)}`,
          );
        }
        assert.ok(
          cleaned.length <= snap.lastAssistantText.length,
          "cleaned length should be <= raw",
        );
        checked += 1;
      }
      assert.ok(checked > 0, "fixture had no snaps");
    });
  }
}
