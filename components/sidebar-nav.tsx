"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { hideDemoProjectAction } from "@/lib/actions/demo";
import { MODULES, type Client, type ModuleKey, type Project } from "@/lib/types";

export type ClientWithProjects = Client & { projects: Project[] };

const mainNav = [
  { href: "/", label: "Dashboard", exact: true },
  { href: "/agents", label: "Agents" },
  { href: "/knowledge", label: "Knowledge Base" },
  { href: "/settings", label: "Settings" },
];

const operationsNav = [{ href: "/automation-hub", label: "Automation Hub" }];

function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function SidebarNav({
  clients,
  demo = null,
  modules = [],
}: {
  clients: ClientWithProjects[];
  /** The per-user Demo client+project, shown in its own DEMO section. */
  demo?: ClientWithProjects | null;
  modules?: ModuleKey[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const activeModules = MODULES.filter((m) => modules.includes(m.key));

  const [hidingDemo, startHidingDemo] = useTransition();
  const hideDemo = () => {
    if (
      !window.confirm("Hide the demo project from this workspace?")
    )
      return;
    startHidingDemo(async () => {
      await hideDemoProjectAction();
      router.refresh();
    });
  };

  // Expand every client by default so projects are visible without clicking;
  // users can still collapse any client individually. The demo client too.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([...(demo ? [demo.id] : []), ...clients.map((c) => c.id)]),
  );

  const toggle = (clientId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  // One client row + its projects. Reused for the demo client and real clients
  // so the demo project looks and links exactly like a real one.
  const clientBlock = (client: ClientWithProjects) => {
    const isClientActive = pathname.startsWith(`/clients/${client.id}`);
    // On a project page the project link below carries the highlight;
    // the client row is highlighted on the client's own pages/tabs.
    const onProjectPage = pathname.includes("/projects/");
    const isOpen = expanded.has(client.id);

    return (
      <div key={client.id}>
        <div
          className={cn(
            "flex items-center gap-0.5 rounded-lg transition-colors",
            isClientActive && (!onProjectPage || !isOpen) ? "bg-mint-400/15" : "",
          )}
        >
          <button
            onClick={() => toggle(client.id)}
            className="flex h-8 w-6 flex-shrink-0 items-center justify-center text-navy-800/30 transition-colors hover:text-navy-800/60"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            <Chevron
              className={cn(
                "transition-transform duration-150",
                isOpen ? "rotate-90" : "",
              )}
            />
          </button>
          <Link
            href={`/clients/${client.id}`}
            className={cn(
              "flex-1 truncate py-1.5 pr-2 text-sm transition-colors",
              isClientActive && (!onProjectPage || !isOpen)
                ? "font-medium text-mint-700"
                : isClientActive
                  ? "font-medium text-navy-900"
                  : "text-navy-800/65 hover:text-navy-900",
            )}
          >
            {client.name}
          </Link>
        </div>

        {isOpen && (
          <div className="ml-5 flex flex-col gap-0.5 pb-0.5">
            {client.projects.length === 0 && (
              <p className="px-3 py-1 text-xs text-navy-800/30">No projects</p>
            )}
            {client.projects.map((project) => {
              const href = `/clients/${client.id}/projects/${project.id}`;
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={project.id}
                  href={href}
                  className={cn(
                    "truncate rounded-lg px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-mint-400/15 font-medium text-mint-700"
                      : "text-navy-800/55 hover:bg-cream-100 hover:text-navy-900",
                  )}
                >
                  {project.name}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {mainNav.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive(item.href, item.exact)
              ? "bg-mint-400/15 text-mint-700"
              : "text-navy-800/65 hover:bg-cream-100 hover:text-navy-900",
          )}
        >
          {item.label}
        </Link>
      ))}

      {activeModules.length > 0 && (
        <>
          <div className="my-2 border-t border-navy-800/10" />
          {activeModules.map((module) => (
            <Link
              key={module.key}
              href={module.href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive(module.href)
                  ? "bg-mint-400/15 text-mint-700"
                  : "text-navy-800/65 hover:bg-cream-100 hover:text-navy-900",
              )}
            >
              {module.label}
            </Link>
          ))}
        </>
      )}

      {demo && (
        <>
          <div className="my-2 border-t border-navy-800/10" />
          <div className="mb-1 flex items-center justify-between px-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-mint-700/70">
              Demo
            </span>
            <button
              type="button"
              onClick={hideDemo}
              disabled={hidingDemo}
              className="rounded-chip px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-navy-800/40 transition hover:bg-coral-400/10 hover:text-coral-400 disabled:opacity-50"
              title="Hide the demo project from this workspace"
            >
              {hidingDemo ? "Hiding…" : "Hide"}
            </button>
          </div>
          {clientBlock(demo)}
        </>
      )}

      <div className="my-2 border-t border-navy-800/10" />

      <div className="mb-1 flex items-center justify-between px-3">
        <Link
          href="/clients"
          className="text-[11px] font-semibold uppercase tracking-widest text-navy-800/35 transition-colors hover:text-navy-800/70"
        >
          Clients
        </Link>
        <Link
          href="/clients"
          className="text-xs text-navy-800/35 transition-colors hover:text-navy-800/70"
          title={clients.length === 0 ? "Add client" : "All projects"}
        >
          {clients.length === 0 ? "+" : "See all"}
        </Link>
      </div>

      {clients.length === 0 && (
        <div className="mx-1 mt-1 rounded-card border border-mint-400/40 bg-mint-400/10 px-3 py-3">
          <p className="text-xs leading-relaxed text-navy-800/60">
            No clients yet — add your first client to create projects and run
            workflows.
          </p>
          <Link
            href="/clients"
            className="mt-2 inline-flex items-center rounded-chip bg-mint-400 px-2.5 py-1 text-xs font-semibold text-navy-900 transition hover:opacity-85"
          >
            + Add client
          </Link>
        </div>
      )}

      {clients.map((client) => clientBlock(client))}

      <div className="my-2 border-t border-navy-800/10" />
      <div className="mb-1 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-navy-800/35">
          Operations
        </span>
      </div>
      {operationsNav.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive(item.href)
              ? "bg-mint-400/15 text-mint-700"
              : "text-navy-800/65 hover:bg-cream-100 hover:text-navy-900",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
