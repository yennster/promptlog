import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SETTINGS_PATH, type TargetApp } from "@promptlog/shared";

export interface Settings {
  enabledApps: Record<TargetApp, boolean>;
}

const DEFAULTS: Settings = {
  enabledApps: {
    claude: true,
    chatgpt: true,
    codex: true,
    antigravity: true,
  },
};

export function readSettings(): Settings {
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      enabledApps: { ...DEFAULTS.enabledApps, ...(parsed.enabledApps ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export function writeSettings(s: Settings) {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}
