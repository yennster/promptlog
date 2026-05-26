import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_COST_RATES,
  SETTINGS_PATH,
  type CostRates,
  type TargetApp,
} from "@promptlog/shared";

export interface Settings {
  costRates: CostRates;
  enabledApps: Record<TargetApp, boolean>;
}

const DEFAULTS: Settings = {
  costRates: DEFAULT_COST_RATES,
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
      costRates: { ...DEFAULTS.costRates, ...(parsed.costRates ?? {}) },
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
