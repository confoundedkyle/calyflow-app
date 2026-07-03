import "server-only";
import { z } from "zod";
import { env } from "../env";
import { loadHarness, HarnessNotProvisionedError } from "../harness";
import type { RocketReachLadderSpec } from "../integrations/rocketreach";

// The RocketReach search ladder driving rocketreach_source_people. Ships a BASIC
// committed default (RocketReach search is free); an advanced spec overrides it
// from the private `system-config` bucket (or the ROCKETREACH_LADDER env var):
//   node scripts/upload-harness.mjs secrets/sourcing/rocketreach-ladder.json sourcing/rocketreach-ladder.json

const OBJECT_KEY = "sourcing/rocketreach-ladder.json";

const tierSchema = z.object({
  name: z.string(),
  weight: z.number(),
  titlesFrom: z.string().optional(),
  useSkills: z.boolean().optional(),
  keywordsAsSkills: z.boolean().optional(),
  useCompanies: z.boolean().optional(),
  useLocation: z.boolean().optional(),
  pages: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});

const specSchema = z.object({
  defaults: z.object({
    targetCount: z.number().int().positive(),
    maxSearches: z.number().int().positive(),
    limit: z.number().int().positive().optional(),
    concurrency: z.number().int().positive().optional(),
  }),
  tiers: z.array(tierSchema).min(1),
});

/** Parse + validate a raw ladder spec. Exported for tests. */
export function parseRocketReachLadderSpec(raw: string): RocketReachLadderSpec {
  return specSchema.parse(JSON.parse(raw)) as RocketReachLadderSpec;
}

// Committed ladder — deliberately BASIC: titles + skills + location, then titles
// + location. The advanced ladder (company targeting, adjacent titles,
// geo-widening, multi-page) lives in the bucket and overrides this.
const GENERIC_SPEC: RocketReachLadderSpec = {
  defaults: { targetCount: 25, maxSearches: 6, limit: 25, concurrency: 3 },
  tiers: [
    {
      name: "titles + skills + location",
      weight: 2,
      titlesFrom: "currentTitles",
      useSkills: true,
      keywordsAsSkills: true,
      useLocation: true,
      limit: 25,
    },
    {
      name: "titles + location",
      weight: 1,
      titlesFrom: "currentTitles",
      useLocation: true,
      limit: 25,
    },
  ],
};

export async function loadRocketReachLadder(): Promise<RocketReachLadderSpec> {
  try {
    const raw = await loadHarness(
      OBJECT_KEY,
      env.rocketreachLadder,
      "ROCKETREACH_LADDER",
    );
    return parseRocketReachLadderSpec(raw);
  } catch (err) {
    if (err instanceof HarnessNotProvisionedError) return GENERIC_SPEC;
    throw err;
  }
}
