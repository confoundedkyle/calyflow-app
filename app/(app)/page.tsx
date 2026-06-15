import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  listClients,
  listRecentAgentRuns,
  listRecentRuns,
  listWorkspaceAgents,
} from "@/lib/queries";
import { checkBudgets } from "@/lib/budgets";
import { Card, Chip, ButtonLink, Mono, EmptyState } from "@/components/ui";
import {
  IconClientsBuilding,
  IconRobot,
  IconRocket,
  IconWarning,
} from "@/components/icons";

interface RecentRunRow {
  id: string;
  kind: "workflow" | "agent";
  name: string;
  project: string | null;
  status: string;
  cost: number | null;
  fallback: boolean;
  createdAt: string;
  href: string;
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const [clients, allAgents, workflowRuns, agentRuns, budget] =
    await Promise.all([
      listClients(session.workspaceId),
      listWorkspaceAgents(session.workspaceId),
      listRecentRuns(session.workspaceId),
      listRecentAgentRuns(session.workspaceId),
      checkBudgets(session.workspace, "calyflow"),
    ]);
  const agents = allAgents.filter((a) => !a.archived_at);

  // Workflow runs and agent runs merged into one recency-sorted feed.
  const runs: RecentRunRow[] = [
    ...workflowRuns.map((r) => ({
      id: r.id,
      kind: "workflow" as const,
      name: r.workflow?.name ?? "Workflow",
      project: r.project?.name ?? null,
      status: r.status,
      cost: r.cost_usd != null ? Number(r.cost_usd) : null,
      fallback: r.fallback_used,
      createdAt: r.created_at,
      href: `/runs/${r.id}`,
    })),
    ...agentRuns.map((r) => ({
      id: r.id,
      kind: "agent" as const,
      name: r.agent?.name ?? "Agent",
      project: r.project?.name ?? null,
      status: r.status,
      cost: r.cost_usd != null ? Number(r.cost_usd) : null,
      fallback: false,
      createdAt: r.created_at,
      href: `/agent-runs/${r.id}`,
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  const steps = [
    {
      done: agents.length > 0,
      label: "Import an agent from the library",
      href: "/library",
    },
    {
      done: clients.length > 0,
      label: "Create your first project",
      href: "/clients",
    },
    {
      done: runs.length > 0,
      label: "Run an agent on a project",
      href: clients.length ? `/clients/${clients[0].id}` : "/clients",
    },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <>
      <div className="relative mb-10">
        {/* Decorative glow, clipped to its own rounded layer BEHIND the text so
            the rounded corners never clip the heading/description themselves. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-panel"
        >
          <div
            className="absolute -top-20 right-0 h-56 w-80 max-w-[50%] rounded-full opacity-20 blur-[64px]"
            style={{
              background: "linear-gradient(135deg, #5bc8a8, #9cc3f0)",
            }}
          />
        </div>
        <h1 className="relative text-2xl font-bold sm:text-[32px]">
          Welcome back to {session.workspace.name}
        </h1>
        <p className="relative max-w-[68ch] text-navy-800/55">
          Browse the library, import an agent, attach your documents, and
          run — output docs land right back in your project.
        </p>
        {clients.length === 0 && (
          <ButtonLink
            href="/clients"
            className="relative mt-5 inline-flex text-base"
          >
            ＋ Create your first client
          </ButtonLink>
        )}
      </div>

      {budget.warningFraction !== null && (
        <div className="mb-8 flex items-center gap-3 rounded-card border border-amber-400/40 bg-amber-400/10 px-4 py-3">
          <IconWarning className="shrink-0" />
          <p className="text-sm">
            You&apos;ve used {Math.round(budget.warningFraction * 100)}% of
            your AI budget.{" "}
            <Link href="/settings/usage" className="font-semibold text-mint-700">
              See usage
            </Link>
          </p>
        </div>
      )}

      {!allDone && (
        <Card className="mb-10" featured>
          <h2 className="mb-4 text-xl font-semibold">Get set up</h2>
          <ol className="space-y-3">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold ${
                    s.done
                      ? "bg-mint-400/30 text-mint-700"
                      : "border border-navy-800/20 text-navy-800/40"
                  }`}
                >
                  {s.done ? "✓" : ""}
                </span>
                <Link
                  href={s.href}
                  className={s.done ? "text-navy-800/45 line-through" : "font-medium hover:text-mint-700"}
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="mb-10 grid gap-5 sm:grid-cols-3">
        <Link href="/clients">
          <Card className="h-full hover:-translate-y-0.5 hover:shadow-lift">
            <IconClientsBuilding size={32} className="mb-3 text-navy-800" />
            <h3 className="font-semibold">Projects</h3>
            <p className="text-sm text-navy-800/55">
              {clients.length} project{clients.length === 1 ? "" : "s"}
            </p>
          </Card>
        </Link>
        <Link href="/workflows">
          <Card className="h-full hover:-translate-y-0.5 hover:shadow-lift">
            <IconRobot size={32} className="mb-3 text-navy-800" />
            <h3 className="font-semibold">Agents</h3>
            <p className="text-sm text-navy-800/55">
              {agents.length} imported
            </p>
          </Card>
        </Link>
        <Link href="/settings/usage">
          <Card className="h-full hover:-translate-y-0.5 hover:shadow-lift">
            <IconRocket size={32} className="mb-3 text-navy-800" />
            <h3 className="font-semibold">Usage this month</h3>
            <p className="text-sm text-navy-800/55">
              <Mono>${budget.monthSpendUsd.toFixed(2)}</Mono>
            </p>
          </Card>
        </Link>
      </div>

      <h2 className="mb-4 text-xl font-semibold">Recent runs</h2>
      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Import an agent, open a project, and hit Run — your results will show up here."
          action={<ButtonLink href="/library">Browse the library</ButtonLink>}
        />
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <Link
              key={`${run.kind}-${run.id}`}
              href={run.href}
              className="block"
            >
              <Card className="flex items-center justify-between gap-4 !p-4 hover:border-mint-700/50">
                <div className="min-w-0">
                  <span className="font-medium">{run.name}</span>
                  {run.project && (
                    <span className="ml-2 text-sm text-navy-800/45">
                      {run.project}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {run.fallback && <Chip tone="amber">fallback</Chip>}
                  <Chip
                    tone={
                      run.status === "succeeded"
                        ? "mint"
                        : run.status === "failed"
                          ? "coral"
                          : "sky"
                    }
                  >
                    {run.status}
                  </Chip>
                  <Mono>
                    {run.cost != null ? `$${run.cost.toFixed(4)}` : "—"}
                  </Mono>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
