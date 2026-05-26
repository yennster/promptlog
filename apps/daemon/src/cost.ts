import { countTokens as countAnthropic } from "@anthropic-ai/tokenizer";
import { encode as encodeGpt } from "gpt-tokenizer";
import type { CostRates, TargetApp } from "@promptlog/shared";

export function estimateTokens(text: string, app: TargetApp): number {
  if (!text) return 0;
  try {
    if (app === "claude") return countAnthropic(text);
    if (app === "chatgpt" || app === "codex") return encodeGpt(text).length;
  } catch {
    /* fall through */
  }
  // Antigravity (Gemini) — no canonical tokenizer here, use char/4 heuristic.
  return Math.ceil(text.length / 4);
}

export function estimateCostUsd(
  app: TargetApp,
  inputTokens: number,
  outputTokens: number,
  rates: CostRates,
) {
  const r = rates[app];
  return (
    (inputTokens / 1_000_000) * r.input + (outputTokens / 1_000_000) * r.output
  );
}
