import { readFileSync } from "node:fs";
import {
  DEFAULT_COST_RATES,
  SETTINGS_PATH,
  type CostRates,
  type TargetApp,
} from "@promptlog/shared";

export interface DaemonSettings {
  costRates: CostRates;
  enabledApps: Record<TargetApp, boolean>;
}

const DEFAULTS: DaemonSettings = {
  costRates: DEFAULT_COST_RATES,
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
    
    const costRates = { ...DEFAULTS.costRates };
    if (parsed.costRates) {
      for (const app of Object.keys(DEFAULTS.costRates) as TargetApp[]) {
        if (parsed.costRates[app]) {
          costRates[app] = {
            ...DEFAULTS.costRates[app],
            ...parsed.costRates[app],
          };
        }
      }
    }

    return {
      costRates,
      enabledApps: { ...DEFAULTS.enabledApps, ...(parsed.enabledApps ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}
