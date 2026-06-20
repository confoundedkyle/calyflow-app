import { CONNECTORS, type ConnectorCategory } from "../connectors";

// The public docs navigation tree. Static sections plus a Connectors group
// generated from the live catalog, so every connector appears in the sidebar.

export interface DocNavNode {
  title: string;
  href?: string;
  children?: DocNavNode[];
}

// Friendly group headings + order for the Connectors section.
const CONNECTOR_GROUPS: { category: ConnectorCategory; label: string }[] = [
  { category: "ats", label: "ATS" },
  { category: "crm", label: "CRM" },
  { category: "data", label: "Data & spreadsheets" },
  { category: "email", label: "Email" },
  { category: "comms", label: "Slack" },
  { category: "tool", label: "Sourcing & enrichment" },
];

function connectorGroups(): DocNavNode[] {
  const live = CONNECTORS.filter((c) => c.live && c.provider);
  const groups: DocNavNode[] = [];
  for (const { category, label } of CONNECTOR_GROUPS) {
    const items: DocNavNode[] = live
      .filter((c) => c.category === category)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ title: c.name, href: `/docs/connectors/${c.provider}` }));
    if (items.length) groups.push({ title: label, children: items });
  }
  return groups;
}

export const DOC_NAV: DocNavNode[] = [
  { title: "Home", href: "/docs" },
  { title: "Getting started", href: "/docs/getting-started" },
  {
    title: "How Calyflow is organized",
    children: [
      { title: "Agents", href: "/docs/agents" },
      { title: "Clients & projects", href: "/docs/projects" },
      { title: "Knowledge base", href: "/docs/knowledge-base" },
      { title: "Documents & project files", href: "/docs/documents" },
      {
        title: "Modules",
        href: "/docs/modules",
        children: [
          { title: "ATS", href: "/docs/modules/ats" },
          { title: "CRM", href: "/docs/modules/crm" },
          { title: "Talent Pool", href: "/docs/modules/talent-pool" },
        ],
      },
    ],
  },
  { title: "What agents can do", href: "/docs/capabilities" },
  { title: "Running agents from Slack", href: "/docs/automation/slack" },
  { title: "Security & privacy", href: "/docs/security" },
  { title: "Self-hosting & OAuth apps", href: "/docs/self-hosting" },
  { title: "FAQ", href: "/docs/faq" },
  // Connectors is the longest group, so it sits last — keeping the short
  // standalone links above it where users can actually find them.
  {
    title: "Connectors",
    href: "/docs/connectors",
    children: connectorGroups(),
  },
];
