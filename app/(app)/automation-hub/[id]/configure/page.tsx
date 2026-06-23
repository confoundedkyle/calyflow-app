import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getWorkspaceAutomation, listConnections } from "@/lib/queries";
import { configureAutomationAction } from "@/lib/actions/automations";
import {
  CONNECTOR_CATEGORY_LABELS,
  connectorsForCategory,
  requiredConnectorCategories,
  type ConnectorCategory,
} from "@/lib/connectors";
import { Button, Card, Field, PageHeader, inputClass } from "@/components/ui";

export const metadata = { title: "Configure automation · Calyflow" };

export default async function ConfigureAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;
  const automation = await getWorkspaceAutomation(session.workspaceId, id);
  if (!automation) notFound();

  const connections = await listConnections(session.workspaceId);
  const connectedProviders = new Set(
    connections.filter((c) => c.status === "active").map((c) => c.provider),
  );
  const categories = requiredConnectorCategories(automation.allowed_tools ?? []);
  const schedule = automation.schedule ?? { kind: "daily", time: "06:00" };

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-1 text-sm text-navy-800/45">
        {session.workspace.name} / Automation Hub / Configure
      </p>
      <PageHeader
        title={automation.name}
        description={automation.library?.summary ?? undefined}
      />

      <form action={configureAutomationAction} className="space-y-6">
        <input type="hidden" name="automationId" value={automation.id} />

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-navy-800/45">
            Connectors
          </h2>
          {categories.length === 0 ? (
            <p className="text-sm text-navy-800/55">
              This automation needs no connectors.
            </p>
          ) : (
            categories.map((category) => {
              const cat = category as ConnectorCategory;
              const options = connectorsForCategory(cat);
              const anyConnected = options.some(
                (o) => o.provider && connectedProviders.has(o.provider),
              );
              const current = automation.connector_bindings?.[category] ?? "";
              return (
                <Field
                  key={category}
                  label={CONNECTOR_CATEGORY_LABELS[cat]}
                  hint={
                    anyConnected ? undefined : (
                      <>
                        None connected yet —{" "}
                        <Link
                          href={`/settings/connectors?category=${category}`}
                          className="font-semibold text-mint-700 hover:underline"
                        >
                          connect one
                        </Link>{" "}
                        to enable this automation.
                      </>
                    )
                  }
                >
                  <select
                    name={`connector_${category}`}
                    defaultValue={current}
                    className={inputClass}
                  >
                    <option value="">Select a {CONNECTOR_CATEGORY_LABELS[cat]}…</option>
                    {options.map((o) => (
                      <option key={o.provider} value={o.provider}>
                        {o.name}
                        {o.provider && connectedProviders.has(o.provider)
                          ? " ✓ connected"
                          : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-navy-800/45">
            Schedule
          </h2>
          <Field label="Cadence">
            <select
              name="schedule_kind"
              defaultValue={schedule.kind}
              className={inputClass}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="hourly">Hourly</option>
            </select>
          </Field>
          <Field label="Time (UTC — used for daily & weekly)">
            <input
              type="time"
              name="schedule_time"
              defaultValue={schedule.time ?? "06:00"}
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={automation.enabled}
              className="h-4 w-4 rounded border-navy-800/30 accent-mint-400"
            />
            <span className="text-sm font-semibold text-navy-800/80">
              Enable this automation
            </span>
          </label>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit">Save automation</Button>
          <Link
            href="/automation-hub"
            className="text-sm font-semibold text-navy-800/55 hover:text-navy-900"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
