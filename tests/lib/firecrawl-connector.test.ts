import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  CONNECTOR_DOMAINS,
  connectorsForCategory,
  pickFirecrawlKey,
} from "@/lib/connectors";
import { firecrawlAdapter } from "@/lib/integrations/firecrawl";
import { SOURCING_AGENT_TOOLS, ALL_TOOL_NAMES } from "@/lib/agents/tools";

describe("Firecrawl connector catalog", () => {
  const firecrawl = CONNECTORS.find((c) => c.provider === "firecrawl");

  it("is a live, API-key Tool-category connector", () => {
    expect(firecrawl).toBeDefined();
    expect(firecrawl!.category).toBe("tool");
    expect(firecrawl!.live).toBe(true);
    expect(firecrawl!.auth).toBe("apikey");
    expect(firecrawl!.name).toBe("Firecrawl");
  });

  it("shows up under the Tool category", () => {
    expect(
      connectorsForCategory("tool").some((c) => c.provider === "firecrawl"),
    ).toBe(true);
  });

  it("has a brand domain for its logo", () => {
    expect(CONNECTOR_DOMAINS.firecrawl).toBe("firecrawl.dev");
  });
});

describe("firecrawlAdapter", () => {
  it("is an API-key adapter registered under the firecrawl provider", () => {
    expect(firecrawlAdapter.provider).toBe("firecrawl");
    expect(firecrawlAdapter.authType).toBe("apikey");
    expect(typeof firecrawlAdapter.validateApiKey).toBe("function");
  });
});

describe("pickFirecrawlKey", () => {
  it("prefers a workspace's own connected key (BYO)", () => {
    expect(pickFirecrawlKey("fc-workspace", "fc-platform")).toBe("fc-workspace");
  });

  it("falls back to the platform env key when not connected", () => {
    expect(pickFirecrawlKey(null, "fc-platform")).toBe("fc-platform");
  });

  it("is null when neither a workspace nor a platform key exists", () => {
    expect(pickFirecrawlKey(null, "")).toBeNull();
  });
});

describe("sourcing agents can use Firecrawl web search", () => {
  it("exposes web_search and web_scrape to the main Sourcing Agent", () => {
    expect(SOURCING_AGENT_TOOLS).toContain("web_search");
    expect(SOURCING_AGENT_TOOLS).toContain("web_scrape");
  });

  it("web_search and web_scrape are real tools", () => {
    expect(ALL_TOOL_NAMES).toContain("web_search");
    expect(ALL_TOOL_NAMES).toContain("web_scrape");
  });
});
