import "server-only";
import { db } from "./db";

// Generic loader for a private "harness" — the prompt/IP that drives a
// private-harness agent (Sourcing Plan, Shortlist, Qualification). Harnesses are
// deliberately kept OUT of the repo (treated as public). Each is pulled at
// runtime from the private `system-config` Supabase Storage bucket, server-side
// only, and cached in-process per object key.
//
// Provisioning is out-of-band:
//   node scripts/upload-harness.mjs <file> <object-key>
// Self-hosters without the bucket can set the matching env var (envFallback).

const BUCKET = "system-config";
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { text: string; at: number }>();

/** Thrown when no harness is provisioned (bucket object missing AND no env
 *  fallback), so the caller can surface a clear, actionable message. */
export class HarnessNotProvisionedError extends Error {
  constructor(objectKey: string, envVar: string) {
    super(
      `Harness "${objectKey}" is not provisioned. Upload it with ` +
        `\`node scripts/upload-harness.mjs <path> ${objectKey}\` or set ${envVar}.`,
    );
    this.name = "HarnessNotProvisionedError";
  }
}

/**
 * Load a harness by storage object key, preferring the private bucket and
 * falling back to the given env value. Cached per key for CACHE_TTL_MS so a busy
 * workspace hits Storage once per window, not once per run.
 */
export async function loadHarness(
  objectKey: string,
  envFallback: string,
  envVarName: string,
): Promise<string> {
  const hit = cache.get(objectKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;

  // Primary: the private bucket object.
  const { data, error } = await db().storage.from(BUCKET).download(objectKey);
  if (!error && data) {
    const text = (await data.text()).trim();
    if (text) {
      cache.set(objectKey, { text, at: Date.now() });
      return text;
    }
  }

  // Fallback: env var (self-hosting without the bucket).
  const fromEnv = envFallback.trim();
  if (fromEnv) {
    cache.set(objectKey, { text: fromEnv, at: Date.now() });
    return fromEnv;
  }

  throw new HarnessNotProvisionedError(objectKey, envVarName);
}
