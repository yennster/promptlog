import { TARGET_APP_BUNDLE_IDS, type TargetApp } from "@promptlog/shared";
import type { AxClient } from "./ax.js";

export interface AdapterSnapshot {
  app: TargetApp;
  bundleId: string;
  ok: boolean;
  composer: string;
  lastAssistantText: string;
}

// Chromium-based composer text-areas leak their placeholder string into
// kAXValueAttribute when the field is empty. The Swift helper tries to filter
// this using AXPlaceholderValue, but Chromium doesn't always expose that
// attribute, so we also filter known placeholder strings per-app here.
const KNOWN_PLACEHOLDERS: Record<TargetApp, string[]> = {
  claude: [
    "Type / for commands",
    "Write a message…",
    "Write a message...",
    "Write a message",
    "Reply to Claude…",
    "Reply to Claude",
    "Write your prompt to Claude",
  ],
  chatgpt: [
    "Ask anything",
    "Message ChatGPT…",
    "Message ChatGPT...",
    "Message ChatGPT",
  ],
  codex: ["Ask Codex anything", "Send a message"],
  antigravity: ["Ask Gemini", "Type a message"],
};

// UI strings that consistently appear around the chat in each target app.
// The response extractor uses these to trim composer chrome, model picker
// text, footer disclaimers, etc. out of the captured snippet.
const RESPONSE_NOISE: Record<TargetApp, RegExp[]> = {
  claude: [
    /Write a message[…\.]*/g,
    /Write your prompt to Claude/g,
    /Add files, connectors, and more/g,
    /Model: [^\n]+/g,
    /Opus \d[\.\d]*/g,
    /Sonnet \d[\.\d]*/g,
    /Haiku \d[\.\d]*/g,
    /Stop response/g,
    /Claude is AI and can make mistakes[^\n]*/g,
    /Claude is responding[^\n]*/g,
    /Message actions/g,
    /\bCopy\b/g,
    /\bEdit\b/g,
    /\bUntitled\b(?:, rename chat)?/g,
    /More options/g,
    /^\s*\d{1,2}:\d{2}\s*(AM|PM)\s*$/gm,
  ],
  chatgpt: [
    /Send a message/g,
    /ChatGPT can make mistakes[^\n]*/g,
    /Regenerate/g,
    /Copy/g,
  ],
  codex: [],
  antigravity: [],
};

export function extractAssistantResponse(
  app: TargetApp,
  blob: string,
  promptText: string,
): string {
  if (!blob) return "";
  let text = blob;
  // Anchor on the user's own prompt if we can find it — everything after that
  // in the linearized AX tree is the new assistant turn.
  if (promptText) {
    const i = text.lastIndexOf(promptText);
    if (i >= 0) text = text.slice(i + promptText.length);
  }
  // Strip surrounding UI chrome.
  for (const re of RESPONSE_NOISE[app]) text = text.replace(re, "");
  // Collapse runs of whitespace/newlines created by the strips.
  text = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return text;
}

export function stripPlaceholder(app: TargetApp, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return KNOWN_PLACEHOLDERS[app].includes(trimmed) ? "" : text;
}

// One generic adapter that uses the Swift helper's app-agnostic heuristics
// (largest text area / largest scroll area / last large AXGroup). Each entry
// just nominates which bundle IDs to try for the given app.
async function readApp(
  client: AxClient,
  app: TargetApp,
): Promise<AdapterSnapshot | null> {
  for (const bundleId of TARGET_APP_BUNDLE_IDS[app]) {
    const r = await client.snapshot(bundleId);
    if (!r.ok) continue;
    const rawComposer = ((r.composer as string | undefined) ?? "").trim();
    return {
      app,
      bundleId,
      ok: true,
      composer: stripPlaceholder(app, rawComposer),
      lastAssistantText: (
        (r.lastAssistantText as string | undefined) ?? ""
      ).trim(),
    };
  }
  return null;
}

export async function snapshotApp(
  client: AxClient,
  app: TargetApp,
): Promise<AdapterSnapshot | null> {
  return readApp(client, app);
}
