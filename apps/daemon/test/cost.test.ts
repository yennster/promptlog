import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, estimateCostUsd } from "../src/cost.js";
import { DEFAULT_COST_RATES } from "@promptlog/shared";

test("estimateTokens — empty or missing text", () => {
  assert.equal(estimateTokens("", "claude"), 0);
  assert.equal(estimateTokens("", "chatgpt"), 0);
});

test("estimateTokens — Claude (Anthropic)", () => {
  const text = "Hello world from Claude!";
  const tokens = estimateTokens(text, "claude");
  assert.ok(tokens > 0, "should return a valid token count");
  // @anthropic-ai/tokenizer is a byte-pair tokenizer, hello world is usually ~5 tokens
  assert.ok(tokens < text.length, "token count should be less than char length");
});

test("estimateTokens — ChatGPT/Codex (GPT)", () => {
  const text = "Hello world from ChatGPT!";
  const tokens = estimateTokens(text, "chatgpt");
  assert.ok(tokens > 0, "should return a valid token count");
  assert.ok(tokens < text.length, "token count should be less than char length");

  const codexTokens = estimateTokens(text, "codex");
  assert.equal(codexTokens, tokens, "Codex and ChatGPT should estimate the same for same text");
});

test("estimateTokens — Antigravity (Gemini char/4 heuristic)", () => {
  const text = "This is a longer sentence meant to test the char/4 heuristic.";
  const expected = Math.ceil(text.length / 4);
  const tokens = estimateTokens(text, "antigravity");
  assert.equal(tokens, expected, "Gemini/Antigravity should use char/4");
});

test("estimateCostUsd — standard rate calculation", () => {
  // Claude standard rates: input $3/1M, output $15/1M
  const cost = estimateCostUsd("claude", 1_000_000, 1_000_000, DEFAULT_COST_RATES);
  assert.equal(cost, 3 + 15);

  const partialCost = estimateCostUsd("claude", 100_000, 50_000, DEFAULT_COST_RATES);
  // 0.1 * 3 + 0.05 * 15 = 0.3 + 0.75 = 1.05
  assert.equal(partialCost, 1.05);
});

test("estimateCostUsd — customized rate calculation", () => {
  const customRates = {
    ...DEFAULT_COST_RATES,
    claude: { input: 10, output: 50 },
  };
  const cost = estimateCostUsd("claude", 1_000_000, 1_000_000, customRates);
  assert.equal(cost, 10 + 50);
});
