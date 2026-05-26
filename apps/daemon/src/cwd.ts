import type { AxClient } from "./ax.js";
import { TARGET_APP_BUNDLE_IDS } from "@promptlog/shared";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const TARGET_BUNDLE_IDS = new Set(
  Object.values(TARGET_APP_BUNDLE_IDS).flat(),
);

// Bundle IDs of editors / file managers we treat as carrying project context.
const EDITOR_BUNDLE_IDS = new Set([
  "com.microsoft.VSCode",
  "com.microsoft.VSCodeInsiders",
  "com.todesktop.230313mzl4w4u92", // Cursor
  "co.anysphere.Cursor",
  "com.windsurf.Windsurf",
  "com.exafunction.windsurf",
  "com.jetbrains.intellij",
  "com.jetbrains.WebStorm",
  "com.jetbrains.pycharm",
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.apple.finder",
  "com.google.antigravity",
]);

export interface CwdGuess {
  bundleId: string;
  windowTitle: string;
  path: string | null;
}

// Cache the most recent non-target focused window so we can attribute a prompt
// to the IDE that was active just before the user switched to the chat app.
let lastNonTargetFocus: CwdGuess | null = null;

export async function refreshFocus(client: AxClient): Promise<void> {
  const r = await client.focusedApp();
  if (!r.ok) return;
  const bundleId = (r.bundleId as string | undefined) ?? "";
  if (!bundleId) return;
  if (TARGET_BUNDLE_IDS.has(bundleId)) return; // ignore chat apps themselves
  if (!EDITOR_BUNDLE_IDS.has(bundleId)) return;
  lastNonTargetFocus = {
    bundleId,
    windowTitle: (r.windowTitle as string | undefined) ?? "",
    path: extractPath((r.windowTitle as string | undefined) ?? ""),
  };
}

export function currentGuess(): CwdGuess | null {
  return lastNonTargetFocus;
}

// VS Code-style window titles look like "filename.ts — repo-name" or
// "filename — repo (workspace)". We try a couple of patterns; if none match
// we return null and let the session-level project_context take over.
export function extractPath(title: string): string | null {
  if (!title) return null;

  // Pattern: "... — /absolute/path"
  const abs = title.match(/[—-]\s*(\/[^—\n]+)$/);
  if (abs && existsSync(abs[1]!.trim())) return abs[1]!.trim();

  // Pattern: "... — name" → try ~/Work/name, ~/Code/name, ~/Projects/name, ~/src/name
  const tail = title.match(/[—-]\s*([^—\n]+?)$/);
  const candidate = tail?.[1]?.trim();
  if (candidate) {
    for (const root of ["Work", "Code", "Projects", "src", "dev"]) {
      const p = resolve(homedir(), root, candidate);
      if (existsSync(p)) return p;
    }
  }

  return null;
}
