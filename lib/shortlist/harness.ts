import "server-only";
import { env } from "../env";
import { loadHarness, HarnessNotProvisionedError } from "../harness";

// The Shortlist harness is the prompt/IP for the main Sourcing Agent — the
// sourcing loop, how to pick enrichment tools per role, the inline 0-100 scoring
// against the qualification criteria, and the dedupe/save contract. Private:
// pulled from the `system-config` bucket, never committed.

export { HarnessNotProvisionedError };

const OBJECT_KEY = "shortlist/harness.md";

export function loadShortlistHarness(): Promise<string> {
  return loadHarness(OBJECT_KEY, env.shortlistHarness, "SHORTLIST_HARNESS");
}
