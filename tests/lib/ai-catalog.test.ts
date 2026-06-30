import { describe, expect, it } from "vitest";
import { isAgenticModel, agenticPlatformModel } from "@/lib/ai-catalog";

describe("isAgenticModel", () => {
  it("excludes mini / nano / flash-lite tiers", () => {
    for (const id of [
      "gpt-5-mini",
      "gpt-4o-mini",
      "o3-mini",
      "o4-mini",
      "gpt-5-nano",
      "gemini-2.5-flash-lite",
    ]) {
      expect(isAgenticModel(id)).toBe(false);
    }
  });

  it("keeps capable models — including ones that merely contain 'mini' like gemini", () => {
    for (const id of [
      "gpt-5.1",
      "claude-sonnet-4-6",
      "claude-opus-4-8",
      "claude-haiku-4-5",
      "gemini-3-pro-preview",
      "gemini-2.5-flash",
    ]) {
      expect(isAgenticModel(id)).toBe(true);
    }
  });
});

describe("agenticPlatformModel", () => {
  it("passes through an agentic model unchanged", () => {
    expect(agenticPlatformModel("openai", "gpt-5.1")).toBe("gpt-5.1");
    expect(agenticPlatformModel("anthropic", "claude-sonnet-4-6")).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("substitutes a capable model when the default is a mini", () => {
    expect(agenticPlatformModel("openai", "gpt-5-mini")).toBe("gpt-5.4");
    expect(agenticPlatformModel("anthropic", "claude-haiku-4-5-mini")).toBe(
      "claude-sonnet-4-6",
    );
    expect(agenticPlatformModel("google", "gemini-2.5-flash-lite")).toBe(
      "gemini-3-pro-preview",
    );
  });

  it("leaves a mini as-is when no capable fallback is known for the provider", () => {
    expect(agenticPlatformModel("groq", "some-mini")).toBe("some-mini");
  });
});
