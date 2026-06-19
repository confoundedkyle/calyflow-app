import type { AssembledContext } from "../context";
import type { UserPreferences } from "../types";

// System-prompt blocks shared by the interactive agent run route and the
// headless runner (cron / Slack), so both assemble context identically.

/** Folds assembled project/KB context into a system-prompt block so the agent
 *  starts with full context (the JD, scorecards, notes) instead of having to
 *  guess search terms. The read tools remain for anything not included here
 *  (e.g. CVs, or docs trimmed by the per-scope caps). */
export function contextBlock(c: AssembledContext): string {
  const sections: [string, string][] = [
    ["Workspace knowledge base", c.workspaceKb],
    ["Client knowledge base", c.clientKb],
    ["Client files", c.clientFiles],
    ["Project files", c.projectFiles],
  ].filter(([, v]) => v && v.trim()) as [string, string][];
  if (sections.length === 0) return "";
  const body = sections.map(([t, v]) => `## ${t}\n${v}`).join("\n\n");
  return (
    "# Project context\nThe following documents from this project and its " +
    "knowledge base are already available — use them directly; only call the " +
    "search/read tools for anything not present here.\n\n" +
    body
  );
}

/** The recruiter's own details from Settings > Personal, folded into every
 *  agent run as HIGHER-priority context than the knowledge base — so an agent
 *  uses the recruiter's real name, company, and signature, and these win over
 *  any conflicting KB info. */
export function personalBlock(p: UserPreferences | null): string {
  if (!p) return "";
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  const lines: string[] = [];
  if (name) lines.push(`- Recruiter's name: ${name}`);
  if (p.company_name) lines.push(`- Recruiter's company name: ${p.company_name}`);
  if (p.company_website)
    lines.push(`- Recruiter's company website: ${p.company_website}`);
  const sig = p.email_signature?.trim();
  if (lines.length === 0 && !sig) return "";
  let out =
    "# Recruiter & sender details\n" +
    "These are the recruiter's own details from their Calyflow settings. They " +
    "take precedence over anything in the knowledge base or project context " +
    "above — if a detail here conflicts with the KB, use THIS one.\n";
  if (lines.length > 0) out += `\n${lines.join("\n")}\n`;
  if (sig)
    out +=
      "\n## Email signature\n" +
      "Use this verbatim when signing off emails; do not alter or reformat it.\n" +
      sig +
      "\n";
  return out.trim();
}
