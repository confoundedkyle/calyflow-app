"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireSession, syncClerkOrgName } from "../auth";
import { db } from "../db";
import { encrypt } from "../crypto";
import { env } from "../env";
import { SUPPORTED_PROVIDERS, validateApiKey } from "../providers";
import { ensureStarterPack } from "../starter-pack";
import { getPostHogClient } from "../posthog-server";
import type { WorkspaceType } from "../types";

// All settings mutations require the admin ("Owner") role — enforced
// server-side on every action; UI hiding is cosmetic (SPEC §9).

export async function updateWorkspaceNameAction(formData: FormData) {
  const session = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");
  const { error } = await db()
    .from("workspaces")
    .update({ name })
    .eq("id", session.workspaceId);
  if (error) throw error;
  // Keep Clerk's org name (shown in the OrganizationSwitcher) in sync.
  await syncClerkOrgName(session.workspace.clerk_org_id, name);
  revalidatePath("/settings");
  revalidatePath("/onboarding");
}

export async function setWorkspaceTypeAction(formData: FormData) {
  const session = await requireAdmin();
  const type = String(formData.get("workspaceType")) as WorkspaceType;
  if (!["independent", "agency", "inhouse"].includes(type))
    throw new Error("Pick a workspace type");
  const update: Record<string, unknown> = { workspace_type: type };
  // Agency / in-house get a 30-day trial clock; independent is free forever.
  if (
    (type === "agency" || type === "inhouse") &&
    !session.workspace.trial_ends_at
  ) {
    update.trial_ends_at = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
  }
  const { error } = await db()
    .from("workspaces")
    .update(update)
    .eq("id", session.workspaceId);
  if (error) throw error;
  getPostHogClient().capture({
    distinctId: session.userId,
    event: "workspace_type_set",
    properties: {
      workspace_type: type,
      workspace_id: session.workspaceId,
      has_trial: type !== "independent",
    },
  });
  revalidatePath("/settings");
  revalidatePath("/onboarding");
}

export async function setMonthlySpendLimitAction(formData: FormData) {
  const session = await requireAdmin();
  const raw = String(formData.get("limit") ?? "").trim();
  const limit = raw === "" ? null : Number(raw);
  if (limit !== null && (!Number.isFinite(limit) || limit < 0))
    throw new Error("Enter a valid amount");
  const { error } = await db()
    .from("workspaces")
    .update({ monthly_spend_limit_usd: limit })
    .eq("id", session.workspaceId);
  if (error) throw error;
  revalidatePath("/settings");
}

export interface SaveProviderResult {
  ok: boolean;
  error?: string;
}

export async function saveProviderAction(
  _prev: SaveProviderResult | null,
  formData: FormData,
): Promise<SaveProviderResult> {
  const session = await requireAdmin();
  const provider = String(formData.get("provider"));
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const defaultModel = String(formData.get("defaultModel") ?? "").trim();

  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider))
    return { ok: false, error: "Unsupported provider" };
  if (provider === "calyflow")
    return { ok: false, error: "The Calyflow default needs no key" };
  if (!defaultModel) return { ok: false, error: "Pick a default model" };

  const supabase = db();
  const { data: existing } = await supabase
    .from("workspace_ai_providers")
    .select("*")
    .eq("workspace_id", session.workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (!apiKey && !existing?.api_key_cipher)
    return { ok: false, error: "An API key is required" };

  // Validate on save with a cheap ping → status badge (SPEC §10).
  let status = existing?.status ?? "unverified";
  let cipher = existing?.api_key_cipher ?? null;
  let last4 = existing?.key_last4 ?? null;
  if (apiKey) {
    const result = await validateApiKey(provider, apiKey, defaultModel);
    status = result.valid ? "valid" : "invalid";
    cipher = encrypt(apiKey);
    last4 = apiKey.slice(-4);
    if (!result.valid) {
      // Still save (so the user sees the invalid badge), but surface why.
      await upsertProvider();
      return {
        ok: false,
        error: `Key saved but failed validation: ${truncate(result.message)}`,
      };
    }
  } else if (existing && defaultModel !== existing.default_model) {
    // Model change with the stored key: re-validate against the new model.
    const { decrypt } = await import("../crypto");
    const result = await validateApiKey(
      provider,
      decrypt(existing.api_key_cipher!),
      defaultModel,
    );
    status = result.valid ? "valid" : "invalid";
  }
  await upsertProvider();
  getPostHogClient().capture({
    distinctId: session.userId,
    event: "provider_saved",
    properties: {
      provider,
      model: defaultModel,
      is_new: !existing,
      status,
      workspace_id: session.workspaceId,
    },
  });
  revalidatePath("/settings/providers");
  return { ok: true };

  async function upsertProvider() {
    if (existing) {
      await supabase
        .from("workspace_ai_providers")
        .update({
          api_key_cipher: cipher,
          key_last4: last4,
          default_model: defaultModel,
          status,
          last_validated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      const { data: rows } = await supabase
        .from("workspace_ai_providers")
        .select("priority")
        .eq("workspace_id", session.workspaceId)
        .order("priority", { ascending: false })
        .limit(1);
      const nextPriority = rows?.length ? rows[0].priority + 1 : 1;
      await supabase.from("workspace_ai_providers").insert({
        workspace_id: session.workspaceId,
        provider,
        api_key_cipher: cipher,
        key_last4: last4,
        default_model: defaultModel,
        priority: nextPriority,
        status,
        last_validated_at: new Date().toISOString(),
      });
    }
  }
}

function truncate(message?: string) {
  if (!message) return "unknown error";
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

/** Move a provider to priority 1 (primary); others keep relative order. */
export async function makePrimaryProviderAction(providerId: string) {
  const session = await requireAdmin();
  const supabase = db();
  const { data: rows, error } = await supabase
    .from("workspace_ai_providers")
    .select("id, priority")
    .eq("workspace_id", session.workspaceId)
    .order("priority");
  if (error) throw error;
  if (!rows?.some((r) => r.id === providerId))
    throw new Error("Provider not found");

  const reordered = [
    providerId,
    ...rows.filter((r) => r.id !== providerId).map((r) => r.id),
  ];
  // Two passes to respect the unique (workspace_id, priority) constraint.
  for (let i = 0; i < reordered.length; i++) {
    await supabase
      .from("workspace_ai_providers")
      .update({ priority: 1000 + i })
      .eq("id", reordered[i]);
  }
  for (let i = 0; i < reordered.length; i++) {
    await supabase
      .from("workspace_ai_providers")
      .update({ priority: i + 1 })
      .eq("id", reordered[i]);
  }
  revalidatePath("/settings/providers");
}

export async function removeProviderAction(providerId: string) {
  const session = await requireAdmin();
  const supabase = db();
  const { error } = await supabase
    .from("workspace_ai_providers")
    .delete()
    .eq("id", providerId)
    .eq("workspace_id", session.workspaceId);
  if (error) throw error;
  // Re-pack priorities so they stay 1..n.
  const { data: rows } = await supabase
    .from("workspace_ai_providers")
    .select("id, priority")
    .eq("workspace_id", session.workspaceId)
    .order("priority");
  for (let i = 0; i < (rows ?? []).length; i++) {
    if (rows![i].priority !== i + 1) {
      await supabase
        .from("workspace_ai_providers")
        .update({ priority: i + 1 })
        .eq("id", rows![i].id);
    }
  }
  revalidatePath("/settings/providers");
}

/**
 * Onboarding step 3 — BYO-key path. Saves the provider and only finishes
 * onboarding when the key validates; otherwise the error is returned so the
 * form can show it and the user can retry or skip.
 */
export async function saveProviderAndFinishOnboardingAction(
  prev: SaveProviderResult | null,
  formData: FormData,
): Promise<SaveProviderResult> {
  const result = await saveProviderAction(prev, formData);
  if (!result.ok) return result;
  await finishOnboardingAction();
  return result;
}

/** Onboarding step 3 — "Use Calyflow default" / "Skip" just confirms the row. */
export async function finishOnboardingAction() {
  const session = await requireSession();
  // Safe default if the user skipped the type step entirely.
  if (!session.workspace.workspace_type) {
    await db()
      .from("workspaces")
      .update({ workspace_type: "independent" })
      .eq("id", session.workspaceId);
  }
  // Give every new workspace the recommended Starter Pack workflows up front.
  await ensureStarterPack(session.workspaceId);
  getPostHogClient().capture({
    distinctId: session.userId,
    event: "onboarding_completed",
    properties: {
      workspace_type: session.workspace.workspace_type,
      workspace_id: session.workspaceId,
    },
  });
  // New users land on the Demo page for an instant "aha" (CV Screener), not the
  // empty Dashboard. The demo project is provisioned lazily on first visit.
  revalidatePath("/");
  redirect("/demo");
}

export async function platformProviderAvailable() {
  return env.platformProviderEnabled;
}
