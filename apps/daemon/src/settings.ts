import { readFileSync } from "node:fs";
import { SETTINGS_PATH, type TargetApp } from "@promptlog/shared";

export interface DaemonSettings {
  enabledApps: Record<TargetApp, boolean>;
}

const DEFAULTS: DaemonSettings = {
  enabledApps: {
    claude: true,
    chatgpt: true,
    codex: true,
    antigravity: true,
  },
};

export function readDaemonSettings(): DaemonSettings {
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DaemonSettings>;
    return {
      enabledApps: { ...DEFAULTS.enabledApps, ...(parsed.enabledApps ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}
