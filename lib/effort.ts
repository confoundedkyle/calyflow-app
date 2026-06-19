// Single source of truth for the per-run "effort" control. Pure + client-safe
// (no server imports) so the slider UI (components/effort-slider.tsx) and the
// run pipeline (app/api/agents/run/route.ts) stay in lockstep.
//
// Effort tunes how hard an agent works on a run: it both raises/lowers the
// tool-call budget (`max_steps`) and tells the agent — in its system prompt —
// how broadly to use its tools. More effort = more tool calls, deeper research,
// and a higher token cost.

export type Effort = "low" | "medium" | "high";

export interface EffortLevel {
  value: Effort;
  label: string;
  /** One-line explanation shown under the slider for the selected level. */
  blurb: string;
}

// Ordered left → right for the slider (Low | Medium | High).
export const EFFORT_LEVELS: readonly EffortLevel[] = [
  {
    value: "low",
    label: "Low",
    blurb: "Fast & cheap — the fewest tool calls and the quickest result.",
  },
  {
    value: "medium",
    label: "Medium",
    blurb: "Balanced — solid research at a moderate token cost.",
  },
  {
    value: "high",
    label: "High",
    blurb:
      "Thorough — many more tool calls and deeper research, at a higher token cost.",
  },
] as const;

export const DEFAULT_EFFORT: Effort = "medium";

/** Coerce an untrusted value (request body, storage) to a valid Effort. */
export function parseEffort(value: unknown): Effort {
  return value === "low" || value === "high" ? value : DEFAULT_EFFORT;
}

// How effort scales an agent's curated step budget. Medium keeps the agent's
// own `max_steps`; Low halves it; High roughly doubles it. Floored so even a
// tiny agent can still act, and capped so a high-effort run can't blow past the
// request timeout with an unbounded tool loop.
const EFFORT_STEP_FACTOR: Record<Effort, number> = {
  low: 0.5,
  medium: 1,
  high: 1.75,
};
const MIN_STEPS = 4;
const MAX_STEPS = 36;
const FALLBACK_BASE_STEPS = 12; // mirrors the route's `?? 12` default

/** Map an effort level to a concrete tool-call budget for `stepCountIs`. */
export function effortMaxSteps(
  baseMaxSteps: number | null | undefined,
  effort: Effort,
): number {
  const base = baseMaxSteps && baseMaxSteps > 0 ? baseMaxSteps : FALLBACK_BASE_STEPS;
  const scaled = Math.round(base * EFFORT_STEP_FACTOR[effort]);
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, scaled));
}

const EFFORT_GUIDANCE: Record<Effort, string> = {
  low: [
    "# Effort level: Low (fast & cheap)",
    "Keep this run lightweight. Favour speed and a low token cost: make as few",
    "tool calls as possible, take the most direct path to a usable result, and",
    "stop as soon as the task is reasonably satisfied. Do not over-research. When",
    "gathering or sourcing items, aim for the lower end of any requested range and",
    "skip extra verification or enrichment passes.",
  ].join("\n"),
  medium: [
    "# Effort level: Medium (balanced)",
    "Apply a balanced amount of effort: research enough to produce an accurate,",
    "reliable result without exhaustive exploration. Use tool calls where they",
    "clearly add value, and stop once the task is well covered.",
  ].join("\n"),
  high: [
    "# Effort level: High (thorough & exhaustive)",
    "Be thorough — the user accepts a higher token cost and a longer run. Explore",
    "broadly: use multiple search strategies and tool calls, cross-check and enrich",
    "your findings, and aim for the upper end of any requested range. Prefer",
    "completeness and accuracy over speed.",
  ].join("\n"),
};

/** System-prompt block telling the agent how hard to work this run. */
export function effortGuidance(effort: Effort): string {
  return EFFORT_GUIDANCE[effort];
}
