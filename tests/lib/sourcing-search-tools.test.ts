import { describe, expect, it } from "vitest";
import { SOURCING_AGENT_TOOLS, ALL_TOOL_NAMES } from "@/lib/agents/tools";

// Sourcing finds prospects via connectors' SEARCH APIs, but must NOT reveal
// emails/phones — that spends contact credits and is a separate, deliberate step.
describe("sourcing connector tools", () => {
  const SEARCH_TOOLS = [
    "apollo_search_people",
    "apollo_source_people",
    "contactout_people_search",
    "rocketreach_search_people",
    "signalhire_search_people",
    "coresignal_source_employees",
  ];

  // Contact-reveal / enrichment tools that burn credits per profile.
  const ENRICH_TOOLS = [
    "apollo_enrich_person",
    "contactout_linkedin_enrich",
    "contactout_person_enrich",
    "contactout_email_verify",
    "findymail_find_email",
    "findymail_find_phone",
    "findymail_verify_email",
    "hunter_domain_search",
    "hunter_email_finder",
    "hunter_email_verifier",
    "rocketreach_lookup_person",
    "rocketreach_check_lookup",
    "signalhire_enrich_person",
  ];

  it("gives the Sourcing Agent every people-search tool", () => {
    for (const name of SEARCH_TOOLS) {
      expect(ALL_TOOL_NAMES).toContain(name); // the tool exists
      expect(SOURCING_AGENT_TOOLS).toContain(name); // and is available
    }
  });

  it("withholds every contact-reveal / enrichment tool from sourcing", () => {
    for (const name of ENRICH_TOOLS) {
      expect(ALL_TOOL_NAMES).toContain(name); // the tool exists elsewhere
      expect(SOURCING_AGENT_TOOLS).not.toContain(name); // but not in sourcing
    }
  });
});
