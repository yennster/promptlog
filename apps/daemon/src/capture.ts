import { insertPrompt, updatePromptResponse } from "@promptlog/db/queries";
import type { TargetApp } from "@promptlog/shared";
import type { AxClient } from "./ax.js";
import { extractAssistantResponse, snapshotApp, stripChrome } from "./adapters.js";
import { estimateCostUsd, estimateTokens } from "./cost.js";
import { currentGuess, refreshFocus } from "./cwd.js";
import { readDaemonSettings } from "./settings.js";

interface PerAppState {
  composer: string;
  assistant: string;
  assistantStableSince: number;
  pendingPromptId: number | null;
  pendingPromptText: string;
  pendingPromptSentAt: number;
  pendingPromptApp: TargetApp;
}

const STABLE_MS = 1500;
const ACTIVE_POLL_MS = 250;
const IDLE_POLL_MS = 5_000;

export class CaptureLoop {
  private settings = readDaemonSettings();
  private state = new Map<TargetApp, PerAppState>();
  private activeSessionId: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly client: AxClient) {}

  isRecording() {
    return this.activeSessionId !== null;
  }

  start(sessionId: number) {
    this.activeSessionId = sessionId;
    this.state.clear();
    this.tickSoon(50);
  }

  stop() {
    this.activeSessionId = null;
    // Don't clear state — keep last-known values so we don't double-record
    // if a session is started again on the same app text.
  }

  reloadSettings() {
    this.settings = readDaemonSettings();
  }

  private tickSoon(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await refreshFocus(this.client);
      const apps = (Object.keys(this.settings.enabledApps) as TargetApp[]).filter(
        (a) => this.settings.enabledApps[a],
      );
      for (const app of apps) {
        await this.tickApp(app);
      }
    } catch (e) {
      console.error("[capture] tick error:", e);
    } finally {
      this.running = false;
      this.tickSoon(this.activeSessionId ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    }
  }

  private prior(app: TargetApp): PerAppState {
    let s = this.state.get(app);
    if (!s) {
      s = {
        composer: "",
        assistant: "",
        assistantStableSince: 0,
        pendingPromptId: null,
        pendingPromptText: "",
        pendingPromptSentAt: 0,
        pendingPromptApp: app,
      };
      this.state.set(app, s);
    }
    return s;
  }

  private async tickApp(app: TargetApp) {
    const snap = await snapshotApp(this.client, app);
    if (!snap || !snap.ok) return;
    const prior = this.prior(app);
    const now = Date.now();

    // Detect a prompt send: composer transitioned from non-empty to empty.
    const sent =
      prior.composer.length >= 2 &&
      snap.composer.length === 0 &&
      this.activeSessionId !== null;

    if (sent) {
      const promptText = prior.composer;
      const cwdGuess = currentGuess();
      const inTokens = estimateTokens(promptText, app);
      const inCost = estimateCostUsd(app, inTokens, 0, this.settings.costRates);
      const inserted = insertPrompt({
        sessionId: this.activeSessionId!,
        app,
        promptText,
        sentAt: new Date(now),
        estPromptTokens: inTokens,
        estCostUsd: inCost,
        detectedCwd: cwdGuess?.path ?? null,
      });
      prior.pendingPromptId = inserted.id;
      prior.pendingPromptText = promptText;
      prior.pendingPromptSentAt = now;
      prior.pendingPromptApp = app;
      prior.assistantStableSince = 0;
    }

    // Track assistant text growth + stability for the in-flight prompt.
    if (prior.pendingPromptId !== null) {
      // Right after submit, the AX tree's "last message bubble" is the user's
      // own just-sent message, not Claude's reply. If we don't guard against
      // that, the daemon waits STABLE_MS, sees the user bubble didn't change,
      // and finalizes with the prompt text as the "response". We strip chrome
      // first so timestamp/action-button noise around the user bubble doesn't
      // inflate the residual past the echo threshold.
      const cleanedBubble = stripChrome(app, snap.lastAssistantText);
      const residual = cleanedBubble
        .replace(prior.pendingPromptText, "")
        .trim();
      const isPromptEcho =
        prior.pendingPromptText.length > 0 &&
        cleanedBubble.includes(prior.pendingPromptText) &&
        residual.length < 20;
      const changed = snap.lastAssistantText !== prior.assistant;
      const stableMs =
        prior.assistantStableSince > 0 ? now - prior.assistantStableSince : -1;
      console.error(
        `[capture] tick ${app} pending=${prior.pendingPromptId} ` +
          `changed=${changed} echo=${isPromptEcho} ` +
          `stableMs=${stableMs} ` +
          `assistantLen=${snap.lastAssistantText.length} ` +
          `residualLen=${residual.length} ` +
          `preview="${snap.lastAssistantText.slice(0, 80).replace(/\n/g, " ⏎ ")}"`,
      );

      if (changed) {
        prior.assistantStableSince = now;
      } else if (
        !isPromptEcho &&
        prior.assistantStableSince > 0 &&
        now - prior.assistantStableSince >= STABLE_MS &&
        snap.lastAssistantText.length > 0
      ) {
        const responseText = extractAssistantResponse(
          app,
          snap.lastAssistantText,
          prior.pendingPromptText,
        );
        console.error(
          `[capture] finalize ${app} latency=${now - prior.pendingPromptSentAt}ms\n` +
            `  raw lastAssistantText (${snap.lastAssistantText.length} chars):\n` +
            snap.lastAssistantText
              .split("\n")
              .map((l) => `    | ${l}`)
              .join("\n") +
            `\n  extracted (${responseText.length} chars):\n` +
            responseText
              .split("\n")
              .map((l) => `    > ${l}`)
              .join("\n"),
        );
        const outTokens = estimateTokens(responseText, app);
        const inTokens = estimateTokens(prior.pendingPromptText, app);
        const totalCost = estimateCostUsd(
          app,
          inTokens,
          outTokens,
          this.settings.costRates,
        );
        updatePromptResponse(prior.pendingPromptId, {
          responseSnippet: responseText.slice(0, 1000),
          completedAt: new Date(now),
          firstTokenAt: new Date(prior.pendingPromptSentAt),
          latencyMs: now - prior.pendingPromptSentAt,
          estResponseTokens: outTokens,
          estCostUsd: totalCost,
        });
        prior.pendingPromptId = null;
        prior.pendingPromptText = "";
        prior.pendingPromptSentAt = 0;
        prior.assistantStableSince = 0;
      }
    }

    prior.composer = snap.composer;
    prior.assistant = snap.lastAssistantText;
  }
}
