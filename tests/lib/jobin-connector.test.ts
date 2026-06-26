import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  CONNECTOR_DOMAINS,
  connectorsForCategory,
  providerToolPrefix,
} from "@/lib/connectors";
import { jobinAdapter } from "@/lib/integrations/jobin";
import { getAdapter, isLiveConnector } from "@/lib/integrations";
import { ALL_TOOL_NAMES } from "@/lib/agents/tools";

describe("Jobin Cloud connector catalog", () => {
  const jobin = CONNECTORS.find((c) => c.provider === "jobin-cloud");

  it("is a live, API-key ATS connector (also CRM)", () => {
    expect(jobin).toBeDefined();
    expect(jobin!.name).toBe("Jobin Cloud");
    expect(jobin!.category).toBe("ats");
    expect(jobin!.extraCategories).toContain("crm");
    expect(jobin!.live).toBe(true);
    expect(jobin!.auth).toBe("apikey");
  });

  it("shows up under ATS and CRM", () => {
    expect(connectorsForCategory("ats").some((c) => c.provider === "jobin-cloud")).toBe(true);
    expect(connectorsForCategory("crm").some((c) => c.provider === "jobin-cloud")).toBe(true);
  });

  it("maps to the clean jobin_ tool prefix with ≥1 real tool", () => {
    expect(providerToolPrefix("jobin-cloud")).toBe("jobin_");
    expect(ALL_TOOL_NAMES.filter((t) => t.startsWith("jobin_")).length).toBeGreaterThan(0);
  });

  it("has a brand domain", () => {
    expect(CONNECTOR_DOMAINS["jobin-cloud"]).toBe("jobin.cloud");
  });
});

describe("jobinAdapter", () => {
  it("is a registered API-key adapter under the jobin-cloud provider", () => {
    expect(jobinAdapter.provider).toBe("jobin-cloud");
    expect(jobinAdapter.authType).toBe("apikey");
    expect(typeof jobinAdapter.validateApiKey).toBe("function");
    expect(isLiveConnector("jobin-cloud")).toBe(true);
    expect(getAdapter("jobin-cloud")!.authType).toBe("apikey");
  });
});
