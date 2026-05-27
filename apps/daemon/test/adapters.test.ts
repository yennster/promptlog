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
  stripPlaceholder,
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

test("extractAssistantResponse — prompt anchor only matches full lines, not mid-sentence", () => {
  // Regression: prior lastIndexOf-based anchor would slice mid-word when the
  // response happened to contain the prompt characters. Prompt "asdf" against
  // ChatGPT's literal-echo response "You typed: asdfasd" would slice everything
  // before the second "asdf" and return just "asd". The line-anchored version
  // skips that match because "You typed: asdfasd" isn't equal to "asdf".
  const blob = "You typed: asdfasd";
  const result = extractAssistantResponse("chatgpt", blob, "asdf");
  assert.equal(result, "You typed: asdfasd");
});

test("extractAssistantResponse — prompt anchor still works for whole-line user bubble", () => {
  // The line-anchor change shouldn't regress the normal case: Claude desktop's
  // huge linearized blob has the user prompt as its own AXStaticText line,
  // followed by the assistant turn. That line should still anchor.
  const blob = [
    "What is 2+2?",
    "4",
    "Copy message",
  ].join("\n");
  const result = extractAssistantResponse("claude", blob, "What is 2+2?");
  assert.equal(result, "4");
});

test("extractAssistantResponse — prompt appearing only mid-prose preserves full response", () => {
  // Prompt is a substring of a sentence in the response but never appears as
  // its own line. The blob should pass through untouched (minus chrome).
  const blob = [
    "Sure! Here's a quicksort implementation written in JavaScript:",
    "function quicksort(arr) { return arr.sort(); }",
  ].join("\n");
  const result = extractAssistantResponse(
    "chatgpt",
    blob,
    "Write a quicksort",
  );
  assert.equal(
    result,
    "Sure! Here's a quicksort implementation written in JavaScript:\nfunction quicksort(arr) { return arr.sort(); }",
  );
});

test("extractAssistantResponse — prefers user-bubble-marker context over later echo", () => {
  // Codex regression: response markdown-echoes the prompt verbatim. AX tree
  // surfaces both the user-bubble copy and the echo as standalone lines. The
  // last-occurrence anchor used to pick the echo and slice the whole response
  // off. New behavior: scan for the prompt line whose preceding non-blank
  // line is a known user-bubble marker ("Edit user message" for Codex).
  const blob = [
    "Edit user message",
    "adfsdfasdf",
    "",
    "11:42 PM",
    "Copy message",
    "Edit message",
    "That came through as",
    "adfsdfasdf", // markdown-echo as a standalone line
    ", so the message pipeline is alive at least.",
    "Copy",
  ].join("\n");
  const result = extractAssistantResponse("codex", blob, "adfsdfasdf");
  // The response should include the echo and the surrounding sentence.
  assert.ok(
    result.includes("That came through as"),
    `expected response prefix preserved; got: ${result}`,
  );
  assert.ok(
    result.includes("so the message pipeline is alive at least"),
    `expected response tail preserved; got: ${result}`,
  );
});

test("codex: Ask for follow-up changes placeholder is stripped", () => {
  // Codex shows "Ask for follow-up changes" as its composer placeholder when
  // the user is continuing a thread. Without filtering, the daemon caught
  // this string in prior.composer and recorded it as the prompt.
  assert.equal(stripPlaceholder("codex", "Ask for follow-up changes"), "");
  assert.equal(stripPlaceholder("codex", "Ask Codex anything"), "");
  // Real text passes through.
  assert.equal(stripPlaceholder("codex", "adfsdfasdf"), "adfsdfasdf");
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

test("extractAssistantResponse — multi-line prompt anchors correctly", () => {
  const blob = [
    "User message",
    "Line 1 of prompt",
    "Line 2 of prompt",
    "12:00 PM",
    "Copy message",
    "Here is the response",
    "to the multi-line prompt.",
    "Copy message",
  ].join("\n");
  const prompt = "Line 1 of prompt\nLine 2 of prompt";
  const result = extractAssistantResponse("claude", blob, prompt);
  assert.equal(
    result,
    "Here is the response\nto the multi-line prompt.",
  );
});

test("antigravity: stripChrome cleans the user-bubble text the daemon uses as a prompt fallback", () => {
  // collectText on the Antigravity "User message" group concatenates the
  // description label, the actual message text, the timestamp, and the
  // "Copy" button. Without this cleanup the daemon was recording prompts
  // like "User message testing again 11:29 PM Copy".
  const blob = [
    "User message",
    "testing again",
    "11:29 PM",
    "Copy",
  ].join("\n");
  const result = stripChrome("antigravity", blob);
  assert.equal(result, "testing again");
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

test("antigravity: rejoins paragraph text from word-per-line AX inputs", () => {
  const blob = [
    "Thinking.",
    "Thinking",
    ".",
    "Reviewing Previous Inputs",
    "I'm",
    "now",
    "analyzing",
    "the",
    "user's",
    "feedback,",
    "focusing",
    "on",
    "the",
    "issue",
    "of",
    "retrieving",
    "prompts",
    "prior",
    "to",
    "the",
    "\"start",
    "recording\"",
    "activation.",
  ].join("\n");
  const result = stripChrome("antigravity", blob);
  assert.equal(
    result,
    "Thinking. Thinking.\nReviewing Previous Inputs\nI'm now analyzing the user's feedback, focusing on the issue of retrieving prompts prior to the \"start recording\" activation."
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
