import { describe, expect, it } from "vitest";
import { reasoningSettings } from "@/lib/providers";

describe("reasoningSettings", () => {
  it("enables Anthropic extended thinking on thinking-capable Claude models", () => {
    for (const id of [
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "claude-3-7-sonnet-latest",
    ]) {
      const r = reasoningSettings("anthropic", id);
      expect(r.providerOptions?.anthropic).toEqual({
        thinking: { type: "enabled", budgetTokens: 4096 },
      });
      // Anthropic requires max_tokens > thinking budget.
      expect(r.maxOutputTokens).toBeGreaterThan(4096);
    }
  });

  it("leaves non-thinking Anthropic models untouched", () => {
    expect(reasoningSettings("anthropic", "claude-3-5-haiku-latest")).toEqual(
      {},
    );
  });

  it("surfaces thoughts on Gemini 2.5 but not older Gemini", () => {
    expect(
      reasoningSettings("google", "gemini-2.5-pro").providerOptions?.google,
    ).toEqual({ thinkingConfig: { includeThoughts: true } });
    expect(reasoningSettings("google", "gemini-1.5-pro")).toEqual({});
  });

  it("enables reasoning summaries on OpenAI reasoning models only", () => {
    expect(
      reasoningSettings("openai", "gpt-5").providerOptions?.openai,
    ).toEqual({ reasoningSummary: "auto" });
    expect(
      reasoningSettings("openai", "o3-mini").providerOptions?.openai,
    ).toEqual({ reasoningSummary: "auto" });
    expect(reasoningSettings("openai", "gpt-4o")).toEqual({});
  });

  it("resolves the 'calyflow' platform provider to its real provider", () => {
    // Platform default provider is Anthropic in tests.
    expect(
      reasoningSettings("calyflow", "claude-opus-4-8").providerOptions
        ?.anthropic,
    ).toBeDefined();
  });

  it("relies on automatic capture for providers that stream reasoning", () => {
    expect(reasoningSettings("deepseek", "deepseek-reasoner")).toEqual({});
    expect(reasoningSettings("xai", "grok-4-fast-reasoning")).toEqual({});
    expect(reasoningSettings("groq", "anything")).toEqual({});
  });
});
