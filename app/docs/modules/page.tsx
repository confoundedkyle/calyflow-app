import Link from "next/link";
import type { Metadata } from "next";
import { DocHeader, Markdown } from "@/components/docs/doc-blocks";

export const metadata: Metadata = {
  title: "Modules",
  description:
    "Optional Calyflow modules — ATS, CRM, and LinkedIn Connections — that turn synced data into working lists you manage in the app.",
};

const BODY = `
**Modules** are optional product areas that turn the data your connectors sync
into working lists inside Calyflow. There are three:

- **[ATS](/docs/modules/ats)** — candidates, organized by the role they're up for.
- **[CRM](/docs/modules/crm)** — the companies you work with and the people at them.
- **[LinkedIn Connections](/docs/modules/talent-pool)** — people your team knows
  from LinkedIn imports, with notes, CVs, and relationship context.

## Turning modules on and off

Modules are **opt-in**. A workspace admin enables them under **Settings →
Modules**. Turning a module **off** only hides it from the menu — your data is
kept and comes straight back when you turn it on again.

## Where the data comes from

Each module fills up from the **connectors** you've linked (or from records you
add by hand):

- **ATS** ← your applicant tracking system (Greenhouse, Lever, Bullhorn, Ashby, …)
- **CRM** ← your CRM (HubSpot, Pipedrive, Attio, …)
- **LinkedIn Connections** ← CSV imports, sourcing & enrichment tools, plus manual adds

See [Connectors](/docs/connectors) for how to link each one.
`;

export default function ModulesOverviewPage() {
  return (
    <article>
      <DocHeader
        eyebrow="How Calyflow is organized"
        title="Modules"
        lead="Optional areas — ATS, CRM, LinkedIn Connections — that turn synced data into lists you manage."
      />
      <Markdown>{BODY}</Markdown>
      <p className="mt-8 text-sm text-navy-800/55">
        Jump to a module:{" "}
        <Link href="/docs/modules/ats" className="font-semibold text-mint-700 hover:underline">ATS</Link>
        {" · "}
        <Link href="/docs/modules/crm" className="font-semibold text-mint-700 hover:underline">CRM</Link>
        {" · "}
        <Link href="/docs/modules/talent-pool" className="font-semibold text-mint-700 hover:underline">LinkedIn Connections</Link>
      </p>
    </article>
  );
}
