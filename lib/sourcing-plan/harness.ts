import "server-only";
import { env } from "../env";
import { loadHarness, HarnessNotProvisionedError } from "../harness";

// The Sourcing Plan harness is the prompt/IP that drives "Plan mode". It lives
// in the private `system-config` bucket (key below), never in the repo. See
// lib/harness.ts for the loader; provision with scripts/upload-harness.mjs.

export { HarnessNotProvisionedError };

const OBJECT_KEY = "sourcing-plan/harness.md";

export function loadSourcingPlanHarness(): Promise<string> {
  return loadHarness(
    OBJECT_KEY,
    env.sourcingPlanHarness,
    "SOURCING_PLAN_HARNESS",
  );
}
