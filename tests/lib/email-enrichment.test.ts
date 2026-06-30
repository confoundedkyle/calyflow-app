import { describe, expect, it } from "vitest";
import {
  emailEnrichmentConnectors,
  isLiveEmailEnrichmentProvider,
} from "@/lib/connectors";

describe("emailEnrichmentConnectors", () => {
  it("lists connected email finders, live ones first, with the live flag set", () => {
    const got = emailEnrichmentConnectors([
      "github", // not an email finder → excluded
      "hunter", // email finder, CSV-only (not live)
      "signalhire", // email finder, one-click capable (live)
    ]);
    expect(got).toEqual([
      { provider: "signalhire", name: "SignalHire", live: true },
      { provider: "hunter", name: "Hunter.io", live: false },
    ]);
  });

  it("treats SignalHire as a one-click (live) provider", () => {
    expect(isLiveEmailEnrichmentProvider("signalhire")).toBe(true);
    expect(isLiveEmailEnrichmentProvider("hunter")).toBe(false);
  });

  it("returns nothing when no connected provider can enrich emails", () => {
    expect(emailEnrichmentConnectors(["github", "slack"])).toEqual([]);
  });
});
