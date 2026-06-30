import "server-only";
import { generateText, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { db } from "./db";
import { decrypt } from "./crypto";
import { env } from "./env";
import type { AiProvider } from "./types";
import { agenticPlatformModel } from "./ai-catalog";

export { SUPPORTED_PROVIDERS, providerLabel } from "./ai-catalog";

export async function getLanguageModel(
  provider: string,
  apiKey: string,
  modelId: string,
): Promise<LanguageModel> {
  // The "calyflow" platform default runs on whatever real provider the
  // platform key belongs to (CALYFLOW_PLATFORM_PROVIDER) — Anthropic by
  // default, but configurable so an OpenAI/Google key works as the default.
  const effective = provider === "calyflow" ? env.platformProvider : provider;
  switch (effective) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey })(modelId);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey })(modelId);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey })(modelId);
    }
    case "mistral": {
      const { createMistral } = await import("@ai-sdk/mistral");
      return createMistral({ apiKey })(modelId);
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      return createXai({ apiKey })(modelId);
    }
    case "deepseek": {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      return createDeepSeek({ apiKey })(modelId);
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq({ apiKey })(modelId);
    }
    case "cohere": {
      const { createCohere } = await import("@ai-sdk/cohere");
      return createCohere({ apiKey })(modelId);
    }
    default:
      throw new Error(`Unsupported provider: ${effective}`);
  }
}

/**
 * Provider-agnostic reasoning ("Thought") enablement for an agent run.
 *
 * Returns the extra `generateText`/`streamText` settings needed to make the
 * run's model surface its reasoning, so an agent loop can record a
 * Thought → Action → Observation trace. The reasoning text itself is read
 * uniformly from each step's `reasoningText` (the AI SDK normalises it across
 * providers) — this helper only flips the per-provider switch that makes the
 * model emit those thoughts in the first place.
 *
 * It chooses the right knob for the run's model: we only enable it on models
 * we KNOW support reasoning, gated by model id. For every other model — and for
 * providers (xAI, DeepSeek, Groq, Mistral, Cohere) whose reasoning models stream
 * thoughts automatically — it returns `{}` and we simply capture `reasoningText`
 * when present. So a non-reasoning model is never sent an option it would reject.
 */
export function reasoningSettings(
  provider: string,
  modelId: string,
): {
  providerOptions?: ProviderOptions;
  /** Set only when a provider needs headroom above its thinking budget. */
  maxOutputTokens?: number;
} {
  // 'calyflow' runs on the platform's real provider — resolve it the same way
  // the rest of this module does so model-id gating sees the true model.
  const effective = provider === "calyflow" ? env.platformProvider : provider;
  const id = modelId.toLowerCase();
  switch (effective) {
    case "anthropic": {
      // Extended thinking: Claude Opus/Sonnet/Haiku 4.x and 3.7 Sonnet.
      const supportsThinking =
        /claude-(opus|sonnet|haiku)-4/.test(id) ||
        /claude-3-7-sonnet/.test(id);
      if (!supportsThinking) return {};
      // Anthropic requires max_tokens > thinking budget, so pair them.
      return {
        providerOptions: {
          anthropic: { thinking: { type: "enabled", budgetTokens: 4096 } },
        },
        maxOutputTokens: 16384,
      };
    }
    case "google": {
      // Gemini 2.5 series; includeThoughts surfaces the thought summaries.
      if (!/gemini-2\.5/.test(id)) return {};
      return {
        providerOptions: {
          google: { thinkingConfig: { includeThoughts: true } },
        },
      };
    }
    case "openai": {
      // Reasoning models (o-series, gpt-5*); reasoningSummary surfaces thoughts.
      const isReasoning = /^o\d/.test(id) || id.includes("gpt-5");
      if (!isReasoning) return {};
      return { providerOptions: { openai: { reasoningSummary: "auto" } } };
    }
    default:
      return {};
  }
}

/** Cheap ping used to validate a key on save (SPEC §10). */
export async function validateApiKey(
  provider: string,
  apiKey: string,
  modelId: string,
): Promise<{ valid: boolean; message?: string }> {
  try {
    const model = await getLanguageModel(provider, apiKey, modelId);
    await generateText({ model, prompt: "ping", maxOutputTokens: 16 });
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : "Validation failed",
    };
  }
}

export interface ResolvedProvider {
  row: AiProvider;
  apiKey: string;
  model: string;
}

/**
 * Providers for a run, in priority order, with decrypted keys.
 * 'calyflow' resolves to the platform key — uniform, no special-casing.
 */
export interface ResolvedProviders {
  providers: ResolvedProvider[];
  /** Provider names whose saved key couldn't be decrypted (need re-saving). */
  unreadableKeys: string[];
}

export async function resolveRunProviders(
  workspaceId: string,
): Promise<ResolvedProviders> {
  const { data, error } = await db()
    .from("workspace_ai_providers")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("priority");
  if (error) throw error;

  const providers: ResolvedProvider[] = [];
  const unreadableKeys: string[] = [];
  for (const row of (data ?? []) as AiProvider[]) {
    if (row.provider === "calyflow") {
      if (!env.platformProviderEnabled) continue;
      // The platform model is centrally configured (env), not per-workspace —
      // use it directly so it can't drift from a value stored at row creation.
      providers.push({
        row,
        apiKey: env.platformApiKey,
        // Never run the platform default on a mini tier — fall back to a
        // capable model for the provider so agent runs aren't degraded.
        model: agenticPlatformModel(env.platformProvider, env.platformModel),
      });
    } else {
      if (!row.api_key_cipher || !row.default_model) continue;
      // A key that can't be decrypted (e.g. APP_ENCRYPTION_KEY rotated since
      // it was saved) must not crash the whole run — skip it and fall through
      // to the next provider (often the Calyflow fallback). The user re-saves
      // the key in Settings → AI Providers to restore it.
      let apiKey: string;
      try {
        apiKey = decrypt(row.api_key_cipher);
      } catch {
        console.warn(
          `Skipping ${row.provider} for workspace ${workspaceId}: stored API key could not be decrypted.`,
        );
        unreadableKeys.push(row.provider);
        continue;
      }
      providers.push({ row, apiKey, model: row.default_model });
    }
  }
  return { providers, unreadableKeys };
}

interface Pricing {
  input?: number; // USD per 1M input tokens
  output?: number; // USD per 1M output tokens
  cache_read?: number; // USD per 1M cached input tokens
}

/**
 * Cost snapshotted at run time from model_catalog pricing (SPEC §4).
 * models.dev prices are USD per million tokens.
 */
export async function computeCostUsd(
  provider: string,
  modelId: string,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
  },
): Promise<number | null> {
  const catalogProvider =
    provider === "calyflow" ? env.platformProvider : provider;
  const { data } = await db()
    .from("model_catalog")
    .select("pricing")
    .eq("provider", catalogProvider)
    .eq("model_id", modelId)
    .maybeSingle();
  const pricing = data?.pricing as Pricing | null;
  if (!pricing?.input || !pricing?.output) return null;

  const cached = usage.cachedInputTokens ?? 0;
  const uncachedInput = Math.max((usage.inputTokens ?? 0) - cached, 0);
  const cost =
    (uncachedInput * pricing.input +
      (usage.outputTokens ?? 0) * pricing.output +
      cached * (pricing.cache_read ?? pricing.input)) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
