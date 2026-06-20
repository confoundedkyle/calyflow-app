import Link from "next/link";
import type { Metadata } from "next";
import { DocHeader } from "@/components/docs/doc-blocks";

export const metadata: Metadata = {
  title: "Calyflow documentation",
  description:
    "Learn how Calyflow works: agents, connectors, knowledge base, modules, and how to set everything up — written for recruiters, no technical background needed.",
};

const CARDS = [
  {
    href: "/docs/getting-started",
    title: "Getting started",
    body: "Your first run in a few minutes — clients, projects, and agents explained.",
  },
  {
    href: "/docs/connectors",
    title: "Connectors",
    body: "Connect your ATS, CRM, spreadsheets, mailbox, and sourcing tools.",
  },
  {
    href: "/docs/capabilities",
    title: "What agents can do",
    body: "The actions your agents can take, grouped by the tool they use.",
  },
  {
    href: "/docs/knowledge-base",
    title: "Knowledge base",
    body: "Teach Calyflow your agency's voice and each client's preferences.",
  },
  {
    href: "/docs/automation/slack",
    title: "Run agents from Slack",
    body: "Trigger agents and get project reports right in your team's Slack.",
  },
  {
    href: "/docs/security",
    title: "Security & privacy",
    body: "How your data and credentials are kept safe — encryption, isolation, your own keys.",
  },
  {
    href: "/docs/self-hosting",
    title: "Self-hosting & OAuth apps",
    body: "Run your own Calyflow instance and wire up connector OAuth apps.",
  },
];

export default function DocsHome() {
  return (
    <article>
      <DocHeader
        eyebrow="Documentation"
        title="Calyflow, explained"
        lead="Calyflow is an open-source recruiting OS: you run AI agents on your projects to source, screen, and reach out to candidates — using your own data and tools. These docs explain how everything fits together, written for recruiters. No technical background needed."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-card border border-navy-800/12 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lift"
          >
            <h3 className="font-display text-lg font-semibold text-navy-900 group-hover:text-mint-700">
              {c.title}
            </h3>
            <p className="mt-1.5 text-sm text-navy-800/60">{c.body}</p>
          </Link>
        ))}
      </div>

      <p className="mt-10 text-sm text-navy-800/55">
        New here? Start with{" "}
        <Link
          href="/docs/getting-started"
          className="font-semibold text-mint-700 hover:underline"
        >
          Getting started
        </Link>
        .
      </p>
    </article>
  );
}
