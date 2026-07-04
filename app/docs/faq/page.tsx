import type { Metadata } from "next";
import { DocHeader, Markdown } from "@/components/docs/doc-blocks";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Common questions about Calyflow — connectors, agents, data, and setup.",
};

const BODY = `
## Do I need to be technical to use Calyflow?

No. You set up your context (clients, projects, documents, knowledge base), connect
the tools you already use, and press **Run**. You never write prompts or code.

## Do I have to connect anything to get started?

No. New workspaces come with a ready-to-run **Demo project** and starter agents, so
you can try a real run with no setup. Connect your own tools when you want agents to
work with your live data.

## What's the difference between a connector and a module?

A **connector** links Calyflow to an outside tool (your ATS, CRM, a sourcing tool).
A **module** (ATS, CRM, LinkedIn Connections) is a place *inside* Calyflow where that synced
data becomes a working list you manage. See [Connectors](/docs/connectors) and
[Modules](/docs/modules).

## How does an agent know about my role?

Every run automatically includes your **knowledge base** and the project's
**documents**, so the agent has the role's context before it starts. See
[Knowledge base](/docs/knowledge-base) and [Documents](/docs/documents).

## Are my candidate files sent to the AI?

Project files (job description, intake notes, scorecard) are included on a run.
**CVs are not auto-included** — you pick them per screening run. **Client files**
(decks, rate cards) are for your reference and are **not** sent to the AI. See
[Documents & project files](/docs/documents).

## Which AI does it use? Do I need my own API key?

On the hosted version you can start on Calyflow's built-in model with included
credit, or bring your own provider key. Either way, runs use *your* models and
your connected tools.

## Some connectors say "API key" and some say "Connect" — why?

Some tools authenticate with a one-click **OAuth** flow ("Connect"), others with an
**API key** you paste in. Each connector's page tells you exactly which, and where
to find it.

## Can I run my own instance?

Yes — Calyflow is open source. See
[Self-hosting & OAuth apps](/docs/self-hosting) for what changes (mainly: you
register your own OAuth app per OAuth connector).

## Can my team run agents from Slack?

Yes. Connect Slack, point a channel at a project, and use \`/calyflow\` or
\`@Calyflow\`. See [Running agents from Slack](/docs/automation/slack).
`;

export default function FaqPage() {
  return (
    <article>
      <DocHeader eyebrow="Help" title="Frequently asked questions" />
      <Markdown>{BODY}</Markdown>
    </article>
  );
}
