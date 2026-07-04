import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  getKbOnboardingConversation,
  getPrimaryRunModel,
  listDocuments,
} from "@/lib/queries";
import { DocExplorer } from "@/components/doc-explorer";
import { KbOnboardingPanel } from "@/components/kb-onboarding-panel";

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { c: conversationParam } = await searchParams;

  const [docs, conversation, model] = await Promise.all([
    listDocuments(session.workspaceId, "workspace", session.workspaceId, "kb"),
    getKbOnboardingConversation(session.workspaceId, conversationParam),
    getPrimaryRunModel(session.workspaceId),
  ]);
  const activeDocs = docs.filter((d) => d.is_active);

  return (
    <>
      <p className="mb-6 max-w-2xl text-sm text-navy-800/55">
        Your agency&apos;s context — tone of voice, screening philosophy, the
        markets you serve. The AI reads this before every run.{" "}
        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-mint-400/20 px-2.5 py-0.5 align-middle text-xs font-semibold text-mint-700">
          Auto-injected into every run
        </span>
      </p>

      <KbOnboardingPanel
        model={model}
        capturedFilenames={activeDocs.map((d) => d.filename ?? "")}
        initialConversation={conversation}
      />

      {activeDocs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-navy-800/45">
            Your documents
          </h2>
          <DocExplorer
            scopeType="workspace"
            scopeId={session.workspaceId}
            docs={activeDocs}
            mode="kb"
          />
        </section>
      )}
    </>
  );
}
