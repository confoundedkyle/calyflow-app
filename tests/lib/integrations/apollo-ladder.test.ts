import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apolloAdapter,
  buildApolloTierSearches,
  type ApolloLadderSpec,
  type ApolloLadderTier,
  type ApolloSourceArgs,
} from "@/lib/integrations/apollo";
import { parseApolloLadderSpec } from "@/lib/sourcing/apollo-ladder";
import { jsonResponse } from "../../helpers/http";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const args: ApolloSourceArgs = {
  currentTitles: ["Tech Lead", "Lead Engineer"],
  adjacentTitles: ["Staff Engineer"],
  companies: ["Acme", "Beta"],
  domain: "acme.com",
  location: "London",
  seniorities: ["senior", "manager"],
};

function people(map: Record<string, string>) {
  return jsonResponse({
    people: Object.entries(map).map(([linkedin_url, name]) => ({
      name,
      linkedin_url,
      title: "Tech Lead",
      organization: { name: "Acme" },
    })),
    pagination: { total_entries: Object.keys(map).length },
  });
}

describe("buildApolloTierSearches", () => {
  it("passes title, domain, location, and seniority filters", () => {
    const tier: ApolloLadderTier = {
      name: "tight",
      weight: 5,
      titlesFrom: "currentTitles",
      useDomain: true,
      useLocation: true,
      useSeniorities: true,
    };
    expect(buildApolloTierSearches(tier, args)).toEqual([
      {
        domain: "acme.com",
        company: undefined,
        titles: ["Tech Lead", "Lead Engineer"],
        seniorities: ["senior", "manager"],
        locations: ["London"],
        limit: undefined,
        page: 1,
      },
    ]);
  });

  it("fans out company searches and pages", () => {
    const searches = buildApolloTierSearches(
      {
        name: "companies",
        weight: 3,
        titlesFrom: "currentTitles",
        useCompanies: true,
        pages: 2,
      },
      args,
    );
    expect(searches.map((s) => [s.company, s.page])).toEqual([
      ["Acme", 1],
      ["Acme", 2],
      ["Beta", 1],
      ["Beta", 2],
    ]);
  });

  it("returns [] for an empty declared title source, and for no anchor", () => {
    expect(
      buildApolloTierSearches(
        { name: "adj", weight: 1, titlesFrom: "adjacentTitles" },
        { currentTitles: ["x"] },
      ),
    ).toEqual([]);
    expect(buildApolloTierSearches({ name: "empty", weight: 1 }, args)).toEqual([]);
  });
});

describe("sourcePeople ladder", () => {
  const spec: ApolloLadderSpec = {
    defaults: { targetCount: 25, maxSearches: 6, limit: 25 },
    tiers: [
      { name: "titles+location", weight: 5, titlesFrom: "currentTitles", useLocation: true },
      { name: "adjacent+location", weight: 3, titlesFrom: "adjacentTitles", useLocation: true },
    ],
  };

  it("dedupes across tiers by linkedin url and ranks by tier weight", async () => {
    fetchMock
      .mockResolvedValueOnce(people({ "li/a": "Ada" }))
      .mockResolvedValueOnce(people({ "li/a": "Ada", "li/c": "Cyd" }));
    const res = await apolloAdapter.sourcePeople("key", args, spec);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.count).toBe(2);
    expect(res.text.indexOf("Ada")).toBeLessThan(res.text.indexOf("Cyd"));
    expect(res.text).toContain("Search may mask emails");
  });

  it("early-stops once the target is met", async () => {
    fetchMock.mockResolvedValue(people({ "li/a": "A", "li/b": "B" }));
    const res = await apolloAdapter.sourcePeople("key", args, {
      defaults: { targetCount: 2, maxSearches: 6 },
      tiers: spec.tiers,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.count).toBe(2);
  });

  it("surfaces the error when every search fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad key" }, 401));
    const res = await apolloAdapter.sourcePeople("key", args, spec);
    expect(res.count).toBe(0);
    expect(res.text).toContain("couldn't run");
  });

  it("sends Apollo people-search fields", async () => {
    fetchMock.mockResolvedValue(people({ "li/a": "A" }));
    await apolloAdapter.sourcePeople("key", args, {
      defaults: { targetCount: 25, maxSearches: 6 },
      tiers: [
        {
          name: "t",
          weight: 1,
          titlesFrom: "currentTitles",
          useDomain: true,
          useSeniorities: true,
          useLocation: true,
        },
      ],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.q_organization_domains).toBe("acme.com");
    expect(body.person_titles).toEqual(["Tech Lead", "Lead Engineer"]);
    expect(body.person_seniorities).toEqual(["senior", "manager"]);
    expect(body.person_locations).toEqual(["London"]);
  });
});

describe("parseApolloLadderSpec", () => {
  it("accepts a valid spec and rejects a malformed one", () => {
    const raw = JSON.stringify({
      defaults: { targetCount: 10, maxSearches: 4 },
      tiers: [{ name: "t", weight: 1, titlesFrom: "currentTitles", useLocation: true }],
    });
    expect(parseApolloLadderSpec(raw).tiers).toHaveLength(1);
    expect(() => parseApolloLadderSpec('{"tiers":[]}')).toThrow();
  });
});
