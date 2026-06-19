import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProject } from "@/lib/queries";
import { isSlackConnected, listSlackChannels } from "@/lib/slack";
import {
  createProjectChannelAction,
  updateProjectSlackSettingsAction,
} from "@/lib/actions/project-settings";
import { Button, ButtonLink, Card, EmptyState, Field, inputClass } from "@/components/ui";
import { ToastForm } from "@/components/toast-form";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { clientId, projectId } = await params;
  const project = await getProject(session.workspaceId, projectId);
  if (!project || project.client.id !== clientId) notFound();

  const connected = await isSlackConnected(session.workspaceId);
  const channels = connected ? await listSlackChannels(session.workspaceId) : null;
  const currentChannelValue = project.slack_channel_id
    ? `${project.slack_channel_id}|${project.slack_channel_name ?? ""}`
    : "";

  // Always offer the currently-mapped channel as an option, even if the Slack
  // channel list doesn't include it yet — a channel created via "Create a
  // dedicated channel" can lag the list API, and we never want the picker to
  // silently drop the project's real channel.
  const channelOptions = [...(channels ?? [])];
  if (
    project.slack_channel_id &&
    !channelOptions.some((c) => c.id === project.slack_channel_id)
  ) {
    channelOptions.unshift({
      id: project.slack_channel_id,
      name: project.slack_channel_name ?? project.slack_channel_id,
      isPrivate: false,
      isMember: true,
    });
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <h2 className="mb-1 text-xl font-semibold">Slack</h2>
        <p className="mb-4 text-sm text-navy-800/55">
          Connect this project to a Slack channel so your team can run recruiting
          agents from Slack and receive automated project reports. We recommend a
          dedicated channel per project.
        </p>

        {!connected ? (
          <EmptyState
            title="Slack isn't connected yet"
            description="Connect your workspace's Slack to pick a channel for this project."
            action={
              <ButtonLink href="/settings/connectors" variant="small">
                Connect Slack
              </ButtonLink>
            }
          />
        ) : (
          <div className="grid gap-5">
            <ToastForm
              action={updateProjectSlackSettingsAction.bind(null, projectId)}
              message="Slack settings saved"
              className="grid gap-4"
            >
              <Field
                label="Channel"
                hint="Where this project's agents post and reports are sent."
              >
                {channelOptions.length > 0 ? (
                  // `key` re-mounts the uncontrolled <select> when the mapped
                  // channel changes (e.g. after creating one) so defaultValue
                  // re-applies — otherwise it keeps showing the old selection.
                  <select
                    key={currentChannelValue}
                    name="slackChannel"
                    defaultValue={currentChannelValue}
                    className={inputClass}
                  >
                    <option value="">— Select a channel —</option>
                    {channelOptions.map((c) => (
                      <option key={c.id} value={`${c.id}|${c.name}`}>
                        {c.isPrivate ? "🔒 " : "#"}
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    key={currentChannelValue}
                    name="slackChannel"
                    defaultValue={currentChannelValue}
                    placeholder="C0123456789"
                    className={inputClass}
                  />
                )}
              </Field>

              <Field
                label="Automated report"
                hint="A short project digest posted to the channel by the Reporting on Slack agent."
              >
                <select
                  name="reportFrequency"
                  defaultValue={project.report_frequency}
                  className={inputClass}
                >
                  <option value="off">Off</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </Field>

              <div>
                <Button variant="small" type="submit">
                  Save
                </Button>
              </div>
            </ToastForm>

            <div className="border-t border-navy-800/10 pt-4">
              <p className="mb-2 text-sm text-navy-800/55">
                Prefer a fresh channel? Create one named after this project and
                map it automatically.
              </p>
              <ToastForm
                action={createProjectChannelAction.bind(null, projectId)}
                message="Dedicated channel created"
              >
                <Button variant="smallSecondary" type="submit">
                  Create a dedicated channel
                </Button>
              </ToastForm>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
