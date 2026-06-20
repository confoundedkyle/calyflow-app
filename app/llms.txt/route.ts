import { env } from "@/lib/env";
import { CONNECTORS } from "@/lib/connectors";

// /llms.txt — a high-level, link-first map of the product for LLM agents, per the
// llmstxt.org convention: an H1 name, a one-line blockquote summary, then H2
// sections of annotated links. Generated from the docs + connector catalog so it
// stays in sync. A matching public route is allowed in proxy.ts.

export const dynamic = "force-static";

const DOC_PAGES: { path: string; title: string; desc: string }[] = [
  { path: "/docs/getting-started", title: "Getting started", desc: "From sign-up to your first agent run in five steps." },
  { path: "/docs/agents", title: "Agents", desc: "What agents are, how a run works, and the ready-made agents." },
  { path: "/docs/capabilities", title: "What agents can do", desc: "The actions agents can take, grouped by the tool they use." },
  { path: "/docs/projects", title: "Clients & projects", desc: "How work is organized: clients are who you recruit for, projects are the roles." },
  { path: "/docs/knowledge-base", title: "Knowledge base", desc: "Workspace and client context that's auto-injected into every run." },
  { path: "/docs/documents", title: "Documents & project files", desc: "Inputs agents read (JD, intake notes, scorecard) and the outputs they create." },
  { path: "/docs/modules", title: "Modules", desc: "Optional ATS, CRM, and Talent Pool areas fed by your connectors." },
  { path: "/docs/connectors", title: "Connectors", desc: "Connect your ATS, CRM, spreadsheets, mailbox, Slack, and sourcing tools." },
  { path: "/docs/automation/slack", title: "Running agents from Slack", desc: "Trigger agents and receive project reports in Slack." },
  { path: "/docs/security", title: "Security & privacy", desc: "How data and credentials are protected." },
  { path: "/docs/self-hosting", title: "Self-hosting & OAuth apps", desc: "Run your own Calyflow instance and wire up connector OAuth apps." },
  { path: "/docs/faq", title: "FAQ", desc: "Common questions about connectors, agents, data, and setup." },
];

export function GET() {
  const base = (env.appBaseUrl || "https://app.calyflow.ai").replace(/\/$/, "");
  const link = (path: string, title: string, desc: string) =>
    `- [${title}](${base}${path}): ${desc}`;

  const connectorLines = CONNECTORS.filter((c) => c.live && c.provider)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => link(`/docs/connectors/${c.provider}`, c.name, c.blurb));

  const body = [
    "# Calyflow",
    "",
    "> Calyflow is an open-source recruiting OS: recruiters run AI agents on their projects to source, screen, and reach out to candidates — using their own data, connected tools, and AI.",
    "",
    "Agents read your knowledge base and a project's documents, query your connected tools (ATS, CRM, spreadsheets, mailbox, Slack, and sourcing & enrichment), and save results back into the project. This file links to the public documentation.",
    "",
    "## Documentation",
    "",
    ...DOC_PAGES.map((p) => link(p.path, p.title, p.desc)),
    "",
    "## Connectors",
    "",
    ...connectorLines,
    "",
    "## Optional",
    "",
    link("/docs", "Documentation home", "Index of all docs."),
    `- [Calyflow app](${base}/): the product (free account, no card).`,
    "- [Website](https://calyflow.ai): marketing site and overview.",
    "- [Source code](https://github.com/Calyflow/calyflow-app): open source, AGPL-3.0.",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
