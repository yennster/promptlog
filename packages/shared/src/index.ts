export type TargetApp = "claude" | "chatgpt" | "codex" | "antigravity";

export const TARGET_APP_BUNDLE_IDS: Record<TargetApp, string[]> = {
  // Anthropic Claude desktop app
  claude: ["com.anthropic.claudefordesktop", "com.anthropic.claude"],
  // OpenAI ChatGPT macOS app
  chatgpt: ["com.openai.chat"],
  // OpenAI Codex desktop GUI (best-known identifiers)
  codex: ["com.openai.codex", "com.openai.codex-desktop"],
  // Google Antigravity IDE
  antigravity: ["com.google.antigravity", "com.google.Antigravity"],
};

export const TARGET_APP_LABEL: Record<TargetApp, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  codex: "Codex",
  antigravity: "Antigravity",
};

export interface AxSnapshot {
  bundleId: string;
  ok: boolean;
  error?: string;
  composer?: string;
  lastAssistantText?: string;
  lastAssistantStableAt?: number;
}

export interface FocusedWindowInfo {
  bundleId: string;
  appName: string;
  windowTitle: string;
}

export interface DaemonStatus {
  recording: boolean;
  currentSessionId: number | null;
  axPermissionGranted: boolean;
  axBinaryPath: string;
  lastError: string | null;
}

export interface CostRates {
  // dollars per 1M tokens, per app, input/output
  claude: { input: number; output: number };
  chatgpt: { input: number; output: number };
  codex: { input: number; output: number };
  antigravity: { input: number; output: number };
}

export const DEFAULT_COST_RATES: CostRates = {
  claude: { input: 3, output: 15 },
  chatgpt: { input: 2.5, output: 10 },
  codex: { input: 2.5, output: 10 },
  antigravity: { input: 1.25, output: 5 },
};

export const DATA_DIR = `${process.env.HOME ?? ""}/.promptlog`;
export const DAEMON_SOCKET_PATH = `${DATA_DIR}/daemon.sock`;
export const DB_PATH = `${DATA_DIR}/promptlog.db`;
export const SETTINGS_PATH = `${DATA_DIR}/settings.json`;

export type DaemonRequest =
  | { kind: "status" }
  | { kind: "start-session"; sessionId: number; projectContext?: string }
  | { kind: "stop-session" }
  | { kind: "reload-settings" };

export type DaemonResponse =
  | { ok: true; status?: DaemonStatus }
  | { ok: false; error: string };
