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

// Regex strips run anywhere in the text — use these for prefixes, disclaimers,
// and patterns that wouldn't plausibly appear inside a real assistant message.
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
    /^Claude responded:?\s*/gm,
    /^\s*\d{1,2}:\d{2}\s*(AM|PM)\s*$/gm,
  ],
  chatgpt: [
    /Send a message/g,
    /ChatGPT can make mistakes[^\n]*/g,
  ],
  codex: [],
  antigravity: [],
};

// Chrome labels that get their own line in the AX tree (toolbar/control buttons
// rendered next to each message). We only drop a line if it equals one of these
// after trimming — so common words like "Edit" or "Retry" survive when they
// appear inside Claude's actual prose.
const CHROME_LINES: Record<TargetApp, Set<string>> = {
  claude: new Set([
    "Copy",
    "Edit",
    "Retry",
    "Settings",
    "Message actions",
    "More options",
    "Give positive feedback",
    "Give negative feedback",
    "Press and hold to record",
    "Use voice mode",
    "Untitled",
    "Untitled, rename chat",
  ]),
  chatgpt: new Set(["Copy", "Regenerate"]),
  codex: new Set(),
  antigravity: new Set(),
};

// Strip UI chrome from an AX-tree text blob without doing the prompt-anchor
// slice. Used both by extractAssistantResponse and by the in-flight echo guard
// in the capture loop (where we need a chrome-free view of the bubble to tell
// whether it's the user's own message echo).
export function stripChrome(app: TargetApp, blob: string): string {
  if (!blob) return "";
  let text = blob;
  for (const re of RESPONSE_NOISE[app]) text = text.replace(re, "");
  const chrome = CHROME_LINES[app];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !chrome.has(l));
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }
  return deduped.join("\n").trim();
}

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
  return stripChrome(app, text);
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
