import "server-only";
import { z } from "zod";
import { env } from "../env";
import { loadHarness, HarnessNotProvisionedError } from "../harness";
import type { SignalHireLadderSpec } from "../integrations/signalhire";

// The SignalHire search ladder: the tier order + field mapping that drives
// signalhire_source_people. Like the Coresignal ladder it can be overridden by a
// proprietary spec in the private `system-config` bucket (or the
// SIGNALHIRE_LADDER env var). UNLIKE the Coresignal one it ships a GENERIC
// committed default here, so the tool works out of the box — SignalHire's search
// is free, so there's no credit-strategy IP to protect. Provision an override
// with:
//   node scripts/upload-harness.mjs secrets/sourcing/signalhire-ladder.json sourcing/signalhire-ladder.json

const OBJECT_KEY = "sourcing/signalhire-ladder.json";

const tierSchema = z.object({
  name: z.string(),
  weight: z.number(),
  titlesFrom: z.string().optional(),
  companiesFrom: z.string().optional(),
  keywordsFrom: z.array(z.string()).optional(),
  keywordsJoin: z.enum(["AND", "OR"]).optional(),
  useLocation: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  maxSearches: z.number().int().positive().optional(),
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
export function parseSignalHireLadderSpec(raw: string): SignalHireLadderSpec {
  return specSchema.parse(JSON.parse(raw)) as SignalHireLadderSpec;
}

// Committed ladder — deliberately BASIC: a plain title+skills keyword search,
// then a broader skills-only pass. It just needs to work out of the box. The
// advanced, tuned ladder (company fan-out, adjacent titles, geo-widening, per-
// tier weighting) lives in the private `system-config` bucket
// (sourcing/signalhire-ladder.json) and overrides this when provisioned.
const GENERIC_SPEC: SignalHireLadderSpec = {
  defaults: { targetCount: 25, maxSearches: 8, limit: 25, concurrency: 3 },
  tiers: [
    {
      name: "title + skills + location",
      weight: 2,
      titlesFrom: "currentTitles",
      keywordsFrom: ["skills", "keywords"],
      keywordsJoin: "AND",
      useLocation: true,
      limit: 25,
    },
    {
      name: "broad keywords",
      weight: 1,
      keywordsFrom: ["skills", "keywords"],
      keywordsJoin: "OR",
      useLocation: true,
      limit: 25,
    },
  ],
};

export async function loadSignalHireLadder(): Promise<SignalHireLadderSpec> {
  try {
    const raw = await loadHarness(
      OBJECT_KEY,
      env.signalhireLadder,
      "SIGNALHIRE_LADDER",
    );
    return parseSignalHireLadderSpec(raw);
  } catch (err) {
    // No override provisioned → the committed generic ladder.
    if (err instanceof HarnessNotProvisionedError) return GENERIC_SPEC;
    throw err;
  }
}
