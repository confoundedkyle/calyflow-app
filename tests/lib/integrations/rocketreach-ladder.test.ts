import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRocketReachTierSearches,
  rocketreachAdapter,
  type RocketReachLadderSpec,
  type RocketReachLadderTier,
  type RocketReachSourceArgs,
} from "@/lib/integrations/rocketreach";
import { parseRocketReachLadderSpec } from "@/lib/sourcing/rocketreach-ladder";
import { jsonResponse } from "../../helpers/http";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const args: RocketReachSourceArgs = {
  currentTitles: ["Tech Lead", "Lead Engineer"],
  adjacentTitles: ["Staff Engineer"],
  skills: ["React", "Node"],
  keywords: "TypeScript",
  companies: ["Acme"],
  location: "London",
};

/** A RocketReach search response with the given linkedin→name profiles. */
function profiles(map: Record<string, string>) {
  return jsonResponse({
    profiles: Object.entries(map).map(([linkedin_url, name], i) => ({
      id: i + 1,
      name,
      linkedin_url,
    })),
    pagination: { total: Object.keys(map).length },
  });
}

describe("buildRocketReachTierSearches", () => {
  it("passes titles + skills(+keywords) + location in one search", () => {
    const tier: RocketReachLadderTier = {
      name: "tight",
      weight: 5,
      titlesFrom: "currentTitles",
      useSkills: true,
      keywordsAsSkills: true,
      useLocation: true,
    };
    expect(buildRocketReachTierSearches(tier, args)).toEqual([
      {
        titles: ["Tech Lead", "Lead Engineer"],
        employers: undefined,
        locations: ["London"],
        skills: ["React", "Node", "TypeScript"],
        limit: undefined,
        page: 1,
      },
    ]);
  });

  it("emits one search per page", () => {
    const searches = buildRocketReachTierSearches(
      { name: "p", weight: 3, titlesFrom: "currentTitles", pages: 3 },
      args,
    );
    expect(searches.map((s) => s.page)).toEqual([1, 2, 3]);
  });

  it("returns [] for an empty declared title source, and for no filters", () => {
    expect(
      buildRocketReachTierSearches(
        { name: "adj", weight: 1, titlesFrom: "adjacentTitles" },
        { currentTitles: ["x"] },
      ),
    ).toEqual([]);
    expect(
      buildRocketReachTierSearches({ name: "empty", weight: 1 }, args),
    ).toEqual([]);
  });
});

describe("sourcePeople ladder", () => {
  const spec: RocketReachLadderSpec = {
    defaults: { targetCount: 25, maxSearches: 6, limit: 25 },
    tiers: [
      { name: "titles+location", weight: 5, titlesFrom: "currentTitles", useLocation: true },
      { name: "adjacent+location", weight: 3, titlesFrom: "adjacentTitles", useLocation: true },
    ],
  };

  it("dedupes across tiers by linkedin url and ranks by tier weight", async () => {
    fetchMock
      .mockResolvedValueOnce(profiles({ "li/a": "Ada" }))
      .mockResolvedValueOnce(profiles({ "li/a": "Ada", "li/c": "Cyd" }));
    const res = await rocketreachAdapter.sourcePeople("key", args, spec);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.count).toBe(2);
    expect(res.text.indexOf("Ada")).toBeLessThan(res.text.indexOf("Cyd"));
    expect(res.text).toContain("no credits");
  });

  it("early-stops once the target is met", async () => {
    fetchMock.mockResolvedValue(profiles({ "li/a": "A", "li/b": "B" }));
    const res = await rocketreachAdapter.sourcePeople("key", args, {
      defaults: { targetCount: 2, maxSearches: 6 },
      tiers: spec.tiers,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.count).toBe(2);
  });

  it("surfaces the error when every search fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "bad key" }, 401));
    const res = await rocketreachAdapter.sourcePeople("key", args, spec);
    expect(res.count).toBe(0);
    expect(res.text).toContain("couldn't run");
  });

  it("sends the current_title query field", async () => {
    fetchMock.mockResolvedValue(profiles({ "li/a": "A" }));
    await rocketreachAdapter.sourcePeople("key", args, {
      defaults: { targetCount: 25, maxSearches: 6 },
      tiers: [{ name: "t", weight: 1, titlesFrom: "currentTitles" }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.query.current_title).toEqual(["Tech Lead", "Lead Engineer"]);
  });
});

describe("parseRocketReachLadderSpec", () => {
  it("accepts a valid spec and rejects a malformed one", () => {
    const raw = JSON.stringify({
      defaults: { targetCount: 10, maxSearches: 4 },
      tiers: [{ name: "t", weight: 1, titlesFrom: "currentTitles", useLocation: true }],
    });
    expect(parseRocketReachLadderSpec(raw).tiers).toHaveLength(1);
    expect(() => parseRocketReachLadderSpec('{"tiers":[]}')).toThrow();
  });
});
