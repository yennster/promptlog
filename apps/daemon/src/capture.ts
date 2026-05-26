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
  // Last known user-message bubble text from the AX tree. Used by the
  // fallback prompt detector for apps that label user bubbles (Antigravity)
  // — see tickApp.
  lastUserText: string;
  assistantStableSince: number;
  pendingPromptId: number | null;
  pendingPromptText: string;
  pendingPromptSentAt: number;
  pendingPromptApp: TargetApp;
}

const STABLE_MS = 1500;
const ACTIVE_POLL_MS = 250;
const IDLE_POLL_MS = 5_000;
// Hard cap on how long we'll wait for a real response before giving up and
// finalizing with whatever we have. Prevents a stuck-pending prompt when the
// app crashes mid-response, the user closes the app, or our filters keep
// stripping the captured text down to nothing.
const PENDING_TIMEOUT_MS = 60_000;

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
    const enabled = (Object.keys(this.settings.enabledApps) as TargetApp[])
      .filter((a) => this.settings.enabledApps[a])
      .join(", ");
    console.log(
      `[capture] session ${sessionId} started, polling: ${enabled || "(none)"}`,
    );
    this.tickSoon(50);
  }

  stop() {
    if (this.activeSessionId !== null) {
      console.log(`[capture] session ${this.activeSessionId} stopped`);
    }
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
        lastUserText: "",
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
    const isFirstSnap = !this.state.has(app);
    const prior = this.prior(app);
    const now = Date.now();

    if (isFirstSnap && this.activeSessionId !== null) {
      console.log(
        `[capture] ${app}: first snapshot ` +
          `(composer=${snap.composer.length}, ` +
          `assistant=${snap.lastAssistantText.length}, ` +
          `userBubble=${snap.lastUserText.length})`,
      );
    }

    // The user-bubble text from the AX tree is wrapped in chrome (the
    // "User message" description label, timestamp, "Copy" button). Strip
    // before using as a prompt source or comparing for change detection.
    const cleanedUserBubble = stripChrome(app, snap.lastUserText);
    const cleanedPriorUserBubble = stripChrome(app, prior.lastUserText);

    // Primary detector: composer transitioned from non-empty to empty.
    const composerSent =
      prior.composer.length >= 2 &&
      snap.composer.length === 0 &&
      this.activeSessionId !== null;

    // Fallback detector: a new user-message bubble appeared in the chat
    // (for apps that label them — currently Antigravity). This catches the
    // case where the app was opened mid-session and the AX tree hadn't
    // surfaced the composer text before submit, so the composer transition
    // was never observed. We only trust this when we don't already have a
    // pending prompt, to avoid double-recording sends that the composer path
    // also caught.
    const userBubbleSent =
      !composerSent &&
      prior.pendingPromptId === null &&
      cleanedUserBubble.length >= 2 &&
      cleanedUserBubble !== cleanedPriorUserBubble &&
      this.activeSessionId !== null;

    const sent = composerSent || userBubbleSent;
    if (sent) {
      // Prefer the user-bubble text when both are available and it's a
      // superstring/longer than the composer-caught text. The composer can
      // be caught mid-typing (e.g. captured "testi" while user was still
      // typing "testing"); the user bubble is the final submitted text.
      let promptText = composerSent ? prior.composer : cleanedUserBubble;
      if (
        composerSent &&
        cleanedUserBubble.length >= promptText.length &&
        cleanedUserBubble.includes(promptText)
      ) {
        promptText = cleanedUserBubble;
      }
      console.log(
        `[capture] ${app}: prompt detected via ${composerSent ? "composer" : "userBubble"} ` +
          `(${promptText.length} chars): "${promptText.slice(0, 60).replace(/\n/g, " ")}"`,
      );
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

      // Run the extractor every tick so we can use the result as a gating
      // condition. Cheap; the blob's bounded by Swift's 16k collectText cap.
      const candidateResponse = extractAssistantResponse(
        app,
        snap.lastAssistantText,
        prior.pendingPromptText,
      );
      // Treat the snapshot as a real assistant response only if there's
      // genuinely something there after chrome stripping + prompt-anchor
      // slicing. Without this, ChatGPT was finalizing at ~1.78s on
      // transitional states where the extracted text came out empty (the
      // captured bubble was the user message, or a streaming-in chrome-only
      // frame). PENDING_TIMEOUT_MS is the safety net for genuinely-empty
      // responses or stuck states.
      const hasContent = candidateResponse.length >= 3;
      const timedOut = now - prior.pendingPromptSentAt >= PENDING_TIMEOUT_MS;

      if (snap.lastAssistantText !== prior.assistant) {
        prior.assistantStableSince = now;
      } else if (
        !isPromptEcho &&
        prior.assistantStableSince > 0 &&
        now - prior.assistantStableSince >= STABLE_MS &&
        snap.lastAssistantText.length > 0 &&
        (hasContent || timedOut)
      ) {
        const responseText = candidateResponse;
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
    prior.lastUserText = snap.lastUserText;
  }
}
