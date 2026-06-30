// Pure module: AI provider ids + display labels. Deliberately free of
// server-only/db/SDK imports so the public catalog route can use it.

export const SUPPORTED_PROVIDERS = [
  "calyflow",
  "anthropic",
  "openai",
  "google",
  "mistral",
  "xai",
  "deepseek",
  "groq",
  "cohere",
] as const;

// Lightweight "mini / nano / flash-lite" tiers are unreliable at multi-step
// agentic tool loops (they tend to one-shot a templated answer instead of
// calling tools), so we keep them out of the selectable catalog and out of the
// platform default. The hyphen guard avoids matching "ge[mini]".
const NON_AGENTIC_MODEL = /(?:-(?:mini|nano)\b|flash-lite)/i;

/** True if a model is suitable for multi-step agent runs (not a mini tier). */
export function isAgenticModel(modelId: string): boolean {
  return !NON_AGENTIC_MODEL.test(modelId);
}

// Capable stand-in per provider when a configured platform model is a mini.
const CAPABLE_PLATFORM_MODEL: Record<string, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-3-pro-preview",
};

/** The platform model to actually run: the configured one if it's agentic,
 *  otherwise a capable stand-in for that provider (so a mini default can't
 *  quietly degrade agent runs). */
export function agenticPlatformModel(provider: string, modelId: string): string {
  if (isAgenticModel(modelId)) return modelId;
  return CAPABLE_PLATFORM_MODEL[provider] ?? modelId;
}

export function providerLabel(provider: string): string {
  switch (provider) {
    case "calyflow":
      return "Calyflow default";
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "google":
      return "Google";
    case "mistral":
      return "Mistral";
    case "xai":
      return "xAI (Grok)";
    case "deepseek":
      return "DeepSeek";
    case "groq":
      return "Groq";
    case "cohere":
      return "Cohere";
    default:
      return provider;
  }
}
