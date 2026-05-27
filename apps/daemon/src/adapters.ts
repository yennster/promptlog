import { TARGET_APP_BUNDLE_IDS, type TargetApp } from "@promptlog/shared";
import type { AxClient } from "./ax.js";

export interface AdapterSnapshot {
  app: TargetApp;
  bundleId: string;
  ok: boolean;
  composer: string;
  lastAssistantText: string;
  // Last user-message bubble text. Empty when the app's AX tree doesn't label
  // user bubbles (Antigravity does; Claude/ChatGPT/Codex don't). Used as a
  // fallback prompt source when the composer-clears-on-submit transition is
  // missed — e.g. when an app is opened mid-session and the AX tree hasn't
  // plumbed in yet, or the user types and submits faster than the poll.
  lastUserText: string;
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
  codex: [
    "Ask Codex anything",
    "Send a message",
    "Ask for follow-up changes",
  ],
  antigravity: ["Ask Gemini", "Type a message"],
};

// Regex strips run anywhere in the text — use these for prefixes, disclaimers,
// and patterns that wouldn't plausibly appear inside a real assistant message.
// Line-anchored patterns (`^…$/gm`) prefer this list when the chrome can show
// variable numbers/text; static labels go in CHROME_LINES instead.
const RESPONSE_NOISE: Record<TargetApp, RegExp[]> = {
  claude: [
    /Write a message[…\.]*/g,
    /Write your prompt to Claude/g,
    /Add files, connectors, and more/g,
    /Model: [^\n]+/g,
    /Stop response/g,
    /Claude is AI and can make mistakes[^\n]*/g,
    /Claude is responding[^\n]*/g,
    /^Claude responded:?\s*/gm,
    // Per-message chrome with dynamic content.
    /^\d+(\.\d+)?[smhd] ago$/gm,
    /^\d+m \d+s$/gm,
    /^\d+[smhd]$/gm,
    /^Ran \d+ commands?(,.*)?$/gm,
    /^Read \d+ files?(,.*)?$/gm,
    /^Edited \d+ files?(,.*)?$/gm,
    /^Created \d+ files?(,.*)?$/gm,
    // Fragmented forms — the AX tree splits "Ran 11 commands" into separate
    // text nodes "Ran" / " " / "11 commands", so the literal "N commands" and
    // "N files" can appear on their own lines.
    /^\d+ commands?$/gm,
    /^\d+ files?$/gm,
    /^\d+\.?\d*k? tokens?$/gm,
    /^\d+ additions?, \d+ deletions?$/gm,
    /^Usage: context \d+%, plan \d+%$/gm,
    /^Opus \d[\.\d]*( 1M)?( · (High|Standard|Low))?$/gm,
    /^Sonnet \d[\.\d]*( 1M)?( · (High|Standard|Low))?$/gm,
    /^Haiku \d[\.\d]*( 1M)?( · (High|Standard|Low))?$/gm,
    /^\s*\d{1,2}:\d{2}\s*(AM|PM)\s*$/gm,
  ],
  chatgpt: [
    /Send a message/g,
    /ChatGPT can make mistakes[^\n]*/g,
  ],
  codex: [
    /^\s*\d{1,2}:\d{2}\s*(AM|PM)\s*$/gm,
    // Codex renders model badges like "5.5 Extra High" — also surfaces as
    // separate lines "5.5" and "Extra High".
    /^\d+(\.\d+)?\s+(Extra )?(High|Standard|Low)$/gm,
    // Codex wraps each message in an AXGroup whose AXDescription is a single
    // string concatenating chrome + prompt + response + chrome ("Edit user
    // message 9:58 PM Copy message Edit message <response> Copy Good response
    // Bad response Fork from this point..."). That description leaks into
    // collectText as one giant line. The per-element AXStaticText nodes
    // already give us the structured pieces, so drop the combined-desc line.
    /^Edit user message .+$/gm,
  ],
  antigravity: [
    /^\s*\d{1,2}:\d{2}\s*(AM|PM)\s*$/gm,
    /^Gemini \d[\.\d]*\s*(Flash|Pro)?\s*(\(.*\))?$/gm,
  ],
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
    // Message footer actions (per-turn controls).
    "Copy message",
    "Pin as chapter",
    "Rewind to here",
    "Fork from here",
    "Copy code",
    // Tool-use breadcrumbs that Claude renders as discrete AX tokens. The
    // higher-level "Ran N commands" summary is caught by RESPONSE_NOISE; these
    // are the orphaned pieces the AX tree exposes alongside it.
    "Ran",
    "Read",
    "Edited",
    "Created",
    "edited",
    "ran",
    "created",
    "a file",
    "a command",
    "a file,",
    "a command,",
    ",",
    ", ",
    "·",
    // App shell chrome.
    "Remote Control",
    "Session actions",
    "Views",
    "Create PR",
    "Chat mode",
    "Prompt",
    "Stop",
    "Auto",
    "Add",
    "Dictation",
    "Dictation settings",
    "Type / for commands",
    "main",
    "Arrow keys move the tile. Perpendicular arrows preview a split; press Enter to commit or Escape to cancel.",
  ]),
  chatgpt: new Set(["Copy", "Regenerate"]),
  codex: new Set([
    "Copy",
    "Copy message",
    "Edit message",
    "Edit user message",
    "Good response",
    "Bad response",
    "Fork from this point",
    "Ask for follow-up changes",
    "Add files and more",
    "Auto-review",
    "Dictate",
    "Outputs",
    "Sources",
    "No artifacts yet",
    "No sources yet",
  ]),
  antigravity: new Set([
    // The AXGroup's own description ("Agent response") leaks into collectText.
    "Agent response",
    "User message",
    "Copy",
    "Good response",
    "Bad response",
    "Message input",
    "Ask anything, @ to mention, / for actions",
    "Add context",
    "Record voice memo",
  ]),
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

  // Antigravity paragraph rejoining:
  // Antigravity's AX tree represents streaming/rendered prose as one AX element per word,
  // which collectText joins with newlines. We rejoin consecutive word lines into paragraphs.
  if (app === "antigravity") {
    const joinedLines: string[] = [];
    let currentLine = "";

    for (const line of deduped) {
      const isPunctuationOnly = /^[.,\/#!$%\^&\*;:{}=\-_`~()?"']{1,2}$/.test(line);
      const isWord = !line.includes(" ") || line.length <= 15;

      if (isWord || isPunctuationOnly) {
        if (currentLine === "") {
          currentLine = line;
        } else {
          const separator = (isPunctuationOnly && !line.startsWith('"') && !line.startsWith("'")) ? "" : " ";
          currentLine += separator + line;
        }
      } else {
        if (currentLine !== "") {
          joinedLines.push(currentLine);
          currentLine = "";
        }
        joinedLines.push(line);
      }
    }

    if (currentLine !== "") {
      joinedLines.push(currentLine);
    }
    return joinedLines.join("\n").trim();
  }

  return deduped.join("\n").trim();
}

// AX-tree labels that precede a user-message bubble. When we find the prompt
// as a standalone line, we prefer ones immediately following one of these so
// we anchor on the real user bubble rather than the assistant echoing the
// prompt back inside its response. Codex's response often quotes the user
// verbatim as a markdown inline-code span which the AX tree exposes as its
// own AXStaticText line — without this preference we'd slice off the entire
// response and leave only the post-echo tail.
const USER_BUBBLE_MARKERS = new Set([
  "Edit user message",
  "User message",
  "Your message",
]);

export function extractAssistantResponse(
  app: TargetApp,
  blob: string,
  promptText: string,
): string {
  if (!blob) return "";
  let text = blob;

  // Anchor on the user's own prompt if we can find it at line boundaries.
  // This signals a user-message bubble rather than an echo inside the response.
  if (promptText) {
    const trimmedPrompt = promptText.trim();
    let index = text.length;
    let anchorIndex = -1;
    let fallbackAnchorIndex = -1;

    while (true) {
      index = text.lastIndexOf(trimmedPrompt, index - 1);
      if (index < 0) break;

      // Ensure the matched prompt is bounded by line boundaries
      const precededByLineBoundary = index === 0 || text[index - 1] === "\n";
      const followedByLineBoundary =
        index + trimmedPrompt.length === text.length ||
        text[index + trimmedPrompt.length] === "\n";

      if (precededByLineBoundary && followedByLineBoundary) {
        // Look back through the preceding non-blank line to check for bubble markers
        const before = text.slice(0, index).trim();
        const beforeLines = before.split("\n");
        const prevLine = beforeLines[beforeLines.length - 1]?.trim() ?? "";

        if (USER_BUBBLE_MARKERS.has(prevLine)) {
          anchorIndex = index;
          break; // Found the best marker-matching anchor
        }

        if (fallbackAnchorIndex < 0) {
          fallbackAnchorIndex = index;
        }
      }

      if (index === 0) break;
    }

    const finalIndex = anchorIndex >= 0 ? anchorIndex : fallbackAnchorIndex;
    if (finalIndex >= 0) {
      text = text.slice(finalIndex + trimmedPrompt.length);
    }
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
      lastUserText: ((r.lastUserText as string | undefined) ?? "").trim(),
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
