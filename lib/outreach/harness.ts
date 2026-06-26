import "server-only";
import { env } from "../env";
import { loadHarness, HarnessNotProvisionedError } from "../harness";

// The Outreach harness is the prompt/IP that drives email drafting — the
// methodology for writing short, personalized, KB-grounded outreach emails. It
// drafts only (never sends). Private: pulled from the `system-config` bucket,
// never committed.

export { HarnessNotProvisionedError };

const OBJECT_KEY = "outreach/harness.md";

export function loadOutreachHarness(): Promise<string> {
  return loadHarness(OBJECT_KEY, env.outreachHarness, "OUTREACH_HARNESS");
}
