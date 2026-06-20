import Link from "next/link";
import type { Metadata } from "next";
import { IconAiSpark } from "@/components/icons";
import { ButtonLink } from "@/components/ui";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

export const metadata: Metadata = {
  title: { default: "Docs", template: "%s · Calyflow docs" },
  description:
    "How Calyflow works: connectors, agents, knowledge base, modules, and setup — explained for recruiters.",
};

// Public documentation shell — its own simplified menu, no app sidebar, no
// session required (the /docs route group is public via proxy.ts).
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-cream-50">
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-navy-800/10 bg-cream-50/90 px-4 backdrop-blur sm:px-6">
        <Link href="/docs" className="flex items-center gap-2 text-mint-700">
          <IconAiSpark size={20} />
          <span className="font-display text-base font-bold text-navy-900">
            Calyflow
          </span>
          <span className="rounded-chip bg-navy-800/8 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-navy-800/55">
            Docs
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-navy-800/70 transition hover:text-navy-900 sm:inline-block"
          >
            Open app
          </Link>
          <ButtonLink href="/sign-up" variant="small">
            Create free account
          </ButtonLink>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1">
        <aside className="hidden w-64 flex-shrink-0 overflow-y-auto border-r border-navy-800/10 lg:block lg:h-[calc(100dvh-3.5rem)] lg:sticky lg:top-14">
          <DocsSidebar />
        </aside>
        <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>
      </div>

      <footer className="border-t border-navy-800/10 bg-cream-100/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-6 text-sm text-navy-800/55 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <div className="flex items-center gap-2">
            <IconAiSpark size={16} className="text-mint-700" />
            <span>
              © {new Date().getFullYear()} Calyflow · Open source{" "}
              <span className="font-mono">(AGPL-3.0)</span>
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href="https://calyflow.ai"
              className="transition hover:text-mint-700"
            >
              Website
            </a>
            <Link href="/" className="transition hover:text-mint-700">
              Open app
            </Link>
            <Link href="/docs" className="transition hover:text-mint-700">
              Docs
            </Link>
            <a
              href="https://github.com/Calyflow/calyflow-app"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-mint-700"
            >
              GitHub
            </a>
            <a
              href="mailto:hello@calyflow.ai"
              className="transition hover:text-mint-700"
            >
              hello@calyflow.ai
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
