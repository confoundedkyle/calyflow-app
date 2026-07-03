import "server-only";
import { z } from "zod";
import { env } from "../env";
import { loadHarness, HarnessNotProvisionedError } from "../harness";
import type { ContactOutLadderSpec } from "../integrations/contactout";

// The ContactOut search ladder driving contactout_source_people. Like SignalHire
// it ships a BASIC committed default (ContactOut search is free), and an
// advanced spec can override it from the private `system-config` bucket (or the
// CONTACTOUT_LADDER env var). Provision the override with:
//   node scripts/upload-harness.mjs secrets/sourcing/contactout-ladder.json sourcing/contactout-ladder.json

const OBJECT_KEY = "sourcing/contactout-ladder.json";

const tierSchema = z.object({
  name: z.string(),
  weight: z.number(),
  titlesFrom: z.string().optional(),
  useSkills: z.boolean().optional(),
  keywordsAsSkills: z.boolean().optional(),
  useCompanies: z.boolean().optional(),
  useLocation: z.boolean().optional(),
  useSeniority: z.boolean().optional(),
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
export function parseContactOutLadderSpec(raw: string): ContactOutLadderSpec {
  return specSchema.parse(JSON.parse(raw)) as ContactOutLadderSpec;
}

// Committed ladder — deliberately BASIC: titles + skills + location, then titles
// + location. Enough to work out of the box; the advanced ladder (seniority,
// company targeting, adjacent titles, geo-widening, multi-page) lives in the
// bucket and overrides this when provisioned.
const GENERIC_SPEC: ContactOutLadderSpec = {
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

export async function loadContactOutLadder(): Promise<ContactOutLadderSpec> {
  try {
    const raw = await loadHarness(
      OBJECT_KEY,
      env.contactoutLadder,
      "CONTACTOUT_LADDER",
    );
    return parseContactOutLadderSpec(raw);
  } catch (err) {
    if (err instanceof HarnessNotProvisionedError) return GENERIC_SPEC;
    throw err;
  }
}
