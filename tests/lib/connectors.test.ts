import { describe, expect, it } from "vitest";
import { CONNECTORS } from "@/lib/connectors";
import { getAdapter, isLiveConnector } from "@/lib/integrations";

describe("connector catalog", () => {
  it("has unique names", () => {
    const names = CONNECTORS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every live connector a provider and auth type", () => {
    // Built-in, keyless connectors (e.g. DuckDuckGo) have no auth/adapter.
    for (const c of CONNECTORS.filter((c) => c.live && !c.builtin)) {
      expect(c.provider, `${c.name} needs a provider id`).toBeTruthy();
      expect(c.auth, `${c.name} needs an auth type`).toBeTruthy();
    }
  });

  it("backs every live connector with a registered adapter", () => {
    for (const c of CONNECTORS.filter((c) => c.live && !c.builtin)) {
      expect(isLiveConnector(c.provider!), `${c.name} has no adapter`).toBe(
        true,
      );
      expect(getAdapter(c.provider!)!.authType).toBe(c.auth);
    }
  });

  it("marks built-in connectors as keyless (no auth, no adapter)", () => {
    for (const c of CONNECTORS.filter((c) => c.builtin)) {
      expect(c.auth, `${c.name} should have no auth`).toBeUndefined();
      expect(c.live, `${c.name} should be live`).toBe(true);
    }
  });

  it("does not list a provider id without marking the connector live", () => {
    for (const c of CONNECTORS.filter((c) => c.provider)) {
      expect(c.live, `${c.name} has a provider but is not live`).toBe(true);
    }
  });

  it("keeps catalog and registry in sync: no orphaned adapters", () => {
    const catalogProviders = new Set(
      CONNECTORS.filter((c) => c.provider).map((c) => c.provider),
    );
    for (const provider of ["airtable", "apollo", "ashby", "contactout", "hunter"]) {
      expect(catalogProviders.has(provider), `${provider} missing from catalog`).toBe(true);
    }
  });
});
