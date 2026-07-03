import "server-only";
import { connectorLabel } from "../connectors";

// A single, cost-ordered description of the sourcing channels a workspace has
// connected — shared by the actual Sourcing Agent run (lib/shortlist/run.ts) and
// the Sourcing-tab strategist (app/api/sourcing/strategize) so both reason about
// cost the same way. The guiding rule: spend the CHEAPEST channels first and
// reach for the most expensive one (Firecrawl web_scrape) only when a specific
// profile genuinely needs it — never open a wave with it.

// Free/quota people-search databases: their SEARCH endpoint finds prospects at no
// per-search cost (SignalHire's free quota; Apollo / ContactOut / RocketReach
// search is free — only revealing a contact spends credits). Prefer these over
// any metered search and over paid web-scraping.
const FREE_SEARCH: Record<string, string> = {
  signalhire:
    "signalhire_source_people — deterministic multi-tier search ladder (free quota; revealing a contact is the paid step). Prefer it over looping signalhire_search_people",
  apollo:
    "apollo_search_people — filter by title, seniority, company, location (search is free)",
  contactout:
    "contactout_source_people — deterministic multi-tier search ladder (free, contact-free). Prefer it over looping contactout_people_search",
  rocketreach:
    "rocketreach_search_people — filter by title, employer, location (search is free)",
};

// People-search databases whose SEARCH itself spends credits — use AFTER the free
// channels are tapped, not first.
const METERED_SEARCH: Record<string, string> = {
  coresignal:
    "coresignal_source_employees — spends credits per search; deep, fresh public employment data",
};

/**
 * The cost-ordered "# Active sourcing channels" block for a system prompt.
 * `providers` = the workspace's connected provider slugs (e.g. from
 * connectedProvidersFrom). Buckets them into a cheapest-first ladder and states
 * the search-only rule.
 */
export function sourcingChannelsBlock(providers: string[]): string {
  const free = providers.filter((p) => FREE_SEARCH[p]);
  const metered = providers.filter((p) => METERED_SEARCH[p]);
  const other = providers.filter(
    (p) => !FREE_SEARCH[p] && !METERED_SEARCH[p],
  );

  const lines: string[] = [
    "# Active sourcing channels — ordered CHEAPEST-FIRST",
    "Work DOWN this cost ladder: exhaust the free / low-cost channels BEFORE " +
      "spending on the expensive ones. Do NOT open a wave with the most expensive " +
      "channel — Firecrawl web_scrape is a last resort, not a starting point.",
    "",
    "1. FREE — no per-search cost, use these FIRST:",
    "   - calyflow_search_talent_pool — the workspace's INTERNAL Talent Pool " +
      "(candidates already imported/saved — a Calyflow module, NOT an external " +
      "ATS). Instant and free; search it first, and ALWAYS when the recruiter " +
      'says "talent pool" or "internal".',
    "   - web_search — general web discovery (GitHub profiles, team pages, Stack Overflow, blogs)",
  ];
  if (free.length) {
    for (const p of free) lines.push(`   - ${FREE_SEARCH[p]}`);
  } else {
    lines.push(
      "   - (no free people-search database connected — connecting SignalHire, " +
        "Apollo, or ContactOut would add free search reach)",
    );
  }
  const scrapeStep = metered.length ? 3 : 2;
  if (metered.length) {
    lines.push(
      "",
      "2. METERED SEARCH — spends that connector's credits per search; reach for " +
        "these once the free channels are tapped for this angle:",
    );
    for (const p of metered) lines.push(`   - ${METERED_SEARCH[p]}`);
  }
  lines.push(
    "",
    `${scrapeStep}. MOST EXPENSIVE — use LAST, and only for a specific profile a ` +
      "free search couldn't resolve:",
    "   - Firecrawl web_scrape — per-page scrape cost; reserve it for reading the " +
      "one profile/page you genuinely need, never for broad discovery",
  );
  if (other.length) {
    lines.push(
      "",
      "Also connected, but NOT first-class sourcing channels: " +
        other.map((p) => connectorLabel(p)).join(", ") +
        ". Contact-enrichment tools reveal emails/phones — a separate paid step " +
        "AFTER the recruiter picks who to reach, never a discovery channel.",
    );
  }
  lines.push(
    "",
    "HARD RULE: sourcing is SEARCH-ONLY. Never reveal or enrich emails/phones " +
      "during sourcing — that spends contact credits per profile. Revealing " +
      "contacts is a separate, deliberate step once the recruiter picks who to reach.",
  );
  return lines.join("\n");
}
