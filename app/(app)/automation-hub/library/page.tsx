import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listLibraryAutomations } from "@/lib/queries";
import { importAutomationAction } from "@/lib/actions/automations";
import { scheduleLabel } from "@/lib/automations";
import { Button, Card, Chip, PageHeader } from "@/components/ui";

export const metadata = { title: "Automation library · Calyflow" };

export default async function AutomationLibraryPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const automations = await listLibraryAutomations();

  return (
    <>
      <p className="mb-1 text-sm text-navy-800/45">
        {session.workspace.name} / Automation Hub / Library
      </p>
      <PageHeader
        title="Automation library"
        description="Add an automation to your workspace, then bind your connectors and set its schedule. Each runs autonomously once enabled."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {automations.map((a) => (
          <Card key={a.id} className="flex h-full flex-col p-5">
            <h3 className="text-[17px] font-semibold leading-tight">{a.name}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {a.default_schedule ? (
                <Chip tone="navy">{scheduleLabel(a.default_schedule)}</Chip>
              ) : null}
              {(a.required_connectors ?? []).map((rc) => (
                <span
                  key={rc.category}
                  className="rounded-full bg-navy-800/8 px-2 py-0.5 text-[11px] font-semibold text-navy-800/65"
                >
                  any {rc.label}
                </span>
              ))}
            </div>
            <p className="mt-2.5 flex-1 text-sm leading-relaxed text-navy-800/55">
              {a.summary ?? a.description}
            </p>
            <form
              action={importAutomationAction.bind(null, a.id)}
              className="mt-4"
            >
              <Button type="submit" variant="small">
                Add to workspace
              </Button>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
