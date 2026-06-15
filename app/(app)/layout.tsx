import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { getSession } from "@/lib/auth";
import { listActiveModuleKeys, listClientsWithProjects } from "@/lib/queries";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { PostHogIdentify } from "@/components/posthog-identify";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.workspace.workspace_type) redirect("/onboarding");
  const [clients, modules] = await Promise.all([
    listClientsWithProjects(session.workspace.id),
    listActiveModuleKeys(session.workspace.id),
  ]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <PostHogIdentify
        userId={session.userId}
        workspaceId={session.workspaceId}
        workspaceName={session.workspace.name}
        workspaceType={session.workspace.workspace_type}
      />
      <AppSidebar clients={clients} modules={modules} />
      {/* min-w-0 lets grids/tables shrink instead of overflowing on mobile */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopbar session={session} clients={clients} modules={modules} />
        {/* `relative` makes <main> the containing block for absolutely-positioned
            descendants (e.g. Tailwind `sr-only` file inputs). Without it they
            anchor to <body> at their in-flow offset, escaping this scroller's
            overflow and adding phantom page height below the viewport. */}
        <main className="relative flex flex-1 flex-col overflow-y-auto px-4 pt-6 sm:px-6 lg:px-10 lg:pt-2">
          <div className="flex-1">{children}</div>
          <footer className="mt-16 border-t border-navy-800/8 py-4 text-center text-xs text-navy-800/35">
            Calyflow — open-source recruiting OS ·{" "}
            <span className="font-mono">AGPL-3.0</span> ·{" "}
            <a
              href={`mailto:${config.contactEmail}`}
              className="hover:text-mint-700"
            >
              Contact: {config.contactEmail}
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
