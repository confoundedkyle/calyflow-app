import "server-only";
import { env } from "../env";
import { loadHarness, HarnessNotProvisionedError } from "../harness";

// The Qualification harness is the prompt/IP that drives criteria authoring —
// the "test-case" format for candidate evaluation and the 0-100 scoring contract
// the Sourcing Agent later applies. Private: pulled from the `system-config`
// bucket, never committed.

export { HarnessNotProvisionedError };

const OBJECT_KEY = "qualification/harness.md";

export function loadQualificationHarness(): Promise<string> {
  return loadHarness(
    OBJECT_KEY,
    env.qualificationHarness,
    "QUALIFICATION_HARNESS",
  );
}
