import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  updateWorkspaceNameAction,
  setWorkspaceTypeAction,
  finishOnboardingAction,
} from "@/lib/actions/settings";
import { Button, Field, inputClass } from "@/components/ui";
import { IconAiSpark } from "@/components/icons";

const TYPES = [
  {
    value: "independent",
    label: "Individual recruiter",
    note: "Solo. Free forever.",
  },
  {
    value: "agency",
    label: "Agency",
    note: "A team recruiting for clients. Free for 30 days.",
  },
  {
    value: "inhouse",
    label: "Corporate / in-house",
    note: "Hiring for your own company. Free for 30 days.",
  },
] as const;

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  // One step: name the workspace and say what it's for, then jump into the app.
  // AI setup is deferred — runs use the built-in model, or add your own key later
  // in Settings → AI Providers.
  async function setUp(formData: FormData) {
    "use server";
    await updateWorkspaceNameAction(formData);
    await setWorkspaceTypeAction(formData);
    // Provisions the Demo project + starter agents and lands the user on a
    // runnable agent (also marks onboarding complete).
    await finishOnboardingAction();
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <div className="mb-8 flex items-center gap-2 text-mint-700">
        <IconAiSpark />
        <span className="font-display text-xl font-bold text-navy-900">
          Calyflow
        </span>
      </div>

      <div className="rounded-panel border border-navy-800/12 bg-white p-8">
        <h1 className="text-2xl font-bold">Set up your workspace</h1>
        <p className="mb-6 mt-1 text-navy-800/55">
          Your team, clients, and projects live here. You can change any of this
          later in Settings.
        </p>

        <form action={setUp} className="space-y-6">
          <Field label="Workspace name">
            <input
              name="name"
              defaultValue={session.workspace.name}
              required
              className={inputClass}
            />
          </Field>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-medium text-navy-800/70">
              What describes you best?
            </legend>
            {TYPES.map((t) => (
              <label
                key={t.value}
                className="flex cursor-pointer items-start gap-3 rounded-card border border-navy-800/15 p-4 transition hover:border-mint-700"
              >
                <input
                  type="radio"
                  name="workspaceType"
                  value={t.value}
                  required
                  defaultChecked={session.workspace.workspace_type === t.value}
                  className="mt-1.5 accent-[#1b7a5f]"
                />
                <span>
                  <span className="block font-semibold">{t.label}</span>
                  <span className="block text-sm text-navy-800/55">
                    {t.note}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <Button type="submit">Get started</Button>
        </form>
      </div>
    </main>
  );
}
