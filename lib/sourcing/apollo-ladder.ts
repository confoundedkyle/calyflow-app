import "server-only";
import { z } from "zod";
import { env } from "../env";
import { loadHarness, HarnessNotProvisionedError } from "../harness";
import type { ApolloLadderSpec } from "../integrations/apollo";

// The Apollo search ladder driving apollo_source_people. It ships a BASIC
// committed default; a proprietary tuned spec can override it from the private
// `system-config` bucket (or the APOLLO_LADDER env var). Provision with:
//   node scripts/upload-harness.mjs secrets/sourcing/apollo-ladder.json sourcing/apollo-ladder.json

const OBJECT_KEY = "sourcing/apollo-ladder.json";

const tierSchema = z.object({
  name: z.string(),
  weight: z.number(),
  titlesFrom: z.string().optional(),
  useCompanies: z.boolean().optional(),
  useDomain: z.boolean().optional(),
  useLocation: z.boolean().optional(),
  useSeniorities: z.boolean().optional(),
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
export function parseApolloLadderSpec(raw: string): ApolloLadderSpec {
  return specSchema.parse(JSON.parse(raw)) as ApolloLadderSpec;
}

// Committed ladder — deliberately BASIC: titles + location, then titles only.
// The advanced ladder (domain/company targeting, seniority, adjacent titles,
// geo-widening, multi-page) lives in the private bucket and overrides this.
const GENERIC_SPEC: ApolloLadderSpec = {
  defaults: { targetCount: 25, maxSearches: 6, limit: 25, concurrency: 3 },
  tiers: [
    {
      name: "titles + location",
      weight: 2,
      titlesFrom: "currentTitles",
      useLocation: true,
      limit: 25,
    },
    {
      name: "titles",
      weight: 1,
      titlesFrom: "currentTitles",
      limit: 25,
    },
  ],
};

export async function loadApolloLadder(): Promise<ApolloLadderSpec> {
  try {
    const raw = await loadHarness(OBJECT_KEY, env.apolloLadder, "APOLLO_LADDER");
    return parseApolloLadderSpec(raw);
  } catch (err) {
    if (err instanceof HarnessNotProvisionedError) return GENERIC_SPEC;
    throw err;
  }
}
