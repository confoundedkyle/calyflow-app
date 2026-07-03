import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildContactOutTierSearches,
  contactoutAdapter,
  type ContactOutLadderSpec,
  type ContactOutLadderTier,
  type ContactOutSourceArgs,
} from "@/lib/integrations/contactout";
import { parseContactOutLadderSpec } from "@/lib/sourcing/contactout-ladder";
import { jsonResponse } from "../../helpers/http";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const args: ContactOutSourceArgs = {
  currentTitles: ["Tech Lead", "Lead Engineer"],
  adjacentTitles: ["Staff Engineer"],
  skills: ["React", "Node"],
  keywords: "TypeScript",
  companies: ["Acme"],
  location: "London",
  seniority: "senior",
};

/** A ContactOut search response with the given url→name profiles. */
function profiles(map: Record<string, string>) {
  const profiles: Record<string, unknown> = {};
  for (const [url, name] of Object.entries(map))
    profiles[url] = { url, full_name: name };
  return jsonResponse({ profiles, metadata: { total_results: Object.keys(map).length } });
}

describe("buildContactOutTierSearches", () => {
  it("passes the full title list + skills + location + seniority in one search", () => {
    const tier: ContactOutLadderTier = {
      name: "tight",
      weight: 5,
      titlesFrom: "currentTitles",
      useSkills: true,
      keywordsAsSkills: true,
      useLocation: true,
      useSeniority: true,
    };
    expect(buildContactOutTierSearches(tier, args)).toEqual([
      {
        jobTitles: ["Tech Lead", "Lead Engineer"],
        companies: undefined,
        locations: ["London"],
        seniorities: ["senior"],
        skills: ["React", "Node", "TypeScript"],
        limit: undefined,
        page: 1,
      },
    ]);
  });

  it("emits one search per page", () => {
    const tier: ContactOutLadderTier = {
      name: "paged",
      weight: 3,
      titlesFrom: "currentTitles",
      pages: 3,
    };
    const searches = buildContactOutTierSearches(tier, args);
    expect(searches.map((s) => s.page)).toEqual([1, 2, 3]);
  });

  it("returns [] when a declared title source is empty", () => {
    expect(
      buildContactOutTierSearches(
        { name: "adj", weight: 1, titlesFrom: "adjacentTitles" },
        { currentTitles: ["x"] },
      ),
    ).toEqual([]);
  });

  it("returns [] for a tier with no usable filters", () => {
    expect(
      buildContactOutTierSearches({ name: "empty", weight: 1 }, args),
    ).toEqual([]);
  });
});

describe("sourcePeople ladder", () => {
  const spec: ContactOutLadderSpec = {
    defaults: { targetCount: 25, maxSearches: 6, limit: 25 },
    tiers: [
      { name: "titles+location", weight: 5, titlesFrom: "currentTitles", useLocation: true },
      { name: "adjacent+location", weight: 3, titlesFrom: "adjacentTitles", useLocation: true },
    ],
  };

  it("dedupes across tiers by url and ranks by tier weight", async () => {
    fetchMock
      .mockResolvedValueOnce(profiles({ "li/a": "Ada" }))
      .mockResolvedValueOnce(profiles({ "li/a": "Ada", "li/c": "Cyd" }));
    const res = await contactoutAdapter.sourcePeople("key", args, spec);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.count).toBe(2); // a, c — deduped
    expect(res.text.indexOf("Ada")).toBeLessThan(res.text.indexOf("Cyd"));
    expect(res.text).toContain("no credits");
  });

  it("early-stops once the target is met", async () => {
    fetchMock.mockResolvedValue(profiles({ "li/a": "A", "li/b": "B" }));
    const res = await contactoutAdapter.sourcePeople(
      "key",
      args,
      { defaults: { targetCount: 2, maxSearches: 6 }, tiers: spec.tiers },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1); // tier 2 never runs
    expect(res.count).toBe(2);
  });

  it("surfaces the error when every search fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "bad key" }, 401));
    const res = await contactoutAdapter.sourcePeople("key", args, spec);
    expect(res.count).toBe(0);
    expect(res.text).toContain("couldn't run");
  });

  it("sends reveal_info:false (search is contact-free)", async () => {
    fetchMock.mockResolvedValue(profiles({ "li/a": "A" }));
    await contactoutAdapter.sourcePeople("key", args, {
      defaults: { targetCount: 25, maxSearches: 6 },
      tiers: [{ name: "t", weight: 1, titlesFrom: "currentTitles" }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reveal_info).toBe(false);
    expect(body.job_title).toEqual(["Tech Lead", "Lead Engineer"]);
  });
});

describe("parseContactOutLadderSpec", () => {
  it("accepts a valid spec and rejects a malformed one", () => {
    const raw = JSON.stringify({
      defaults: { targetCount: 10, maxSearches: 4 },
      tiers: [{ name: "t", weight: 1, titlesFrom: "currentTitles", useLocation: true }],
    });
    expect(parseContactOutLadderSpec(raw).tiers).toHaveLength(1);
    expect(() => parseContactOutLadderSpec('{"tiers":[]}')).toThrow();
  });
});
