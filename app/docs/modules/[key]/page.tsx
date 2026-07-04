import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DocHeader, Markdown } from "@/components/docs/doc-blocks";

interface ModuleDoc {
  key: string;
  title: string;
  lead: string;
  body: string;
}

const MODULE_DOCS: Record<string, ModuleDoc> = {
  ats: {
    key: "ats",
    title: "ATS module",
    lead: "Your candidate pipeline, organized by the role each person is up for.",
    body: `
The **ATS** module is your candidate pipeline inside Calyflow. Candidates are
shown by stage — sourced, screening, interview, offer, hired, rejected — and tied
to the **project (role)** they're being considered for.

## Where the data comes from

Candidates flow in from a connected **applicant tracking system** — Greenhouse,
Lever, Bullhorn, Ashby, Workable, SmartRecruiters, and more — or you can add them
by hand. See the [ATS connectors](/docs/connectors).

## What you can do

- Browse and filter candidates across your roles.
- See where each candidate sits in the process.
- Feed candidates into agents (e.g. CV screening, outreach).

**Example:** filter to the candidates at the "Screening" stage for an open role
and run the CV Screener on just that group to rank them.

## Turning it on

An admin enables it under **Settings → Modules**. Turning it off hides the module
but keeps all your candidate data.
`,
  },
  crm: {
    key: "crm",
    title: "CRM module",
    lead: "The companies you work with and the people at them.",
    body: `
The **CRM** module tracks your **accounts** (companies) and the **leads** (people)
connected to them — your business-development side of recruiting.

## Where the data comes from

Accounts and leads sync from a connected **CRM** — HubSpot, Pipedrive, Attio,
Zoho CRM, and more — or you can add them manually. See the
[CRM connectors](/docs/connectors).

## What you can do

- Keep client companies and their contacts in one place.
- Give agents (e.g. client prospecting research) the context they need.

**Example:** before a business-development call, open the account to see its open
deals and the right contact, then run Client Prospecting Research for a brief.

## Turning it on

An admin enables it under **Settings → Modules**. Turning it off hides the module
but preserves your accounts and leads.
`,
  },
  "talent-pool": {
    key: "talent-pool",
    title: "LinkedIn Connections module",
    lead: "A shared map of people your recruiting team knows from LinkedIn imports.",
    body: `
**LinkedIn Connections** is a shared database of people your recruiting team knows
from LinkedIn imports and manual adds. Each person can carry a LinkedIn URL,
contact details, notes, and a CV, so the team can see who is already known before
starting a new search.

## Where the data comes from

People come from **CSV imports**, sourcing & enrichment tools, and manual adds.
Sourcing agents can add the people they find here. See the
[sourcing & enrichment connectors](/docs/connectors).

## What you can do

- Import a simple list of names and LinkedIn URLs.
- See which people are already known to your team.
- Store notes, contact details, and CVs against each person.
- Pull warm connections into outreach when the right role opens.

**Example:** several recruiters import their LinkedIn connection lists. When a new
finance role opens, Calyflow can show which matching people are already known by
the team before anyone starts cold sourcing.

## Turning it on

An admin enables it under **Settings → Modules**. Turning it off hides the module
but keeps every connection.
`,
  },
};

export function generateStaticParams() {
  return Object.keys(MODULE_DOCS).map((key) => ({ key }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  const doc = MODULE_DOCS[key];
  if (!doc) return { title: "Module" };
  return { title: doc.title, description: doc.lead };
}

export default async function ModulePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const doc = MODULE_DOCS[key];
  if (!doc) notFound();
  return (
    <article>
      <DocHeader eyebrow="Modules" title={doc.title} lead={doc.lead} />
      <Markdown>{doc.body}</Markdown>
    </article>
  );
}
