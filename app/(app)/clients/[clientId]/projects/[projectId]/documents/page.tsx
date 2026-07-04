import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listDocuments } from "@/lib/queries";
import { DocExplorer } from "@/components/doc-explorer";
import { ProjectFilesManager } from "@/components/project-files-manager";

export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { projectId } = await params;

  const docs = await listDocuments(session.workspaceId, "project", projectId, "file");

  // Doc types the agents produce as results (shown on the right, not as inputs).
  // Besides generic `output` docs, the pipeline saves its Sourcing Plan and
  // Qualification criteria as their own canonical doc types.
  const AGENT_OUTPUT_TYPES = new Set(["output", "sourcing_plan", "qualification"]);

  // "Your documents": the inputs you set up (JD, intake notes, scorecard, …) —
  // excluding CVs (a per-run input) and agent outputs (shown on the right).
  const inputDocs = docs.filter(
    (d) => d.doc_type !== "cv" && !AGENT_OUTPUT_TYPES.has(d.doc_type ?? ""),
  );
  // "Agent-created documents": what agent runs saved back, newest first. Generic
  // outputs always show; the canonical Sourcing Plan / Qualification show their
  // current (active) version, not the superseded ones.
  const outputDocs = docs
    .filter(
      (d) =>
        (d.doc_type === "output" && d.is_active) ||
        (AGENT_OUTPUT_TYPES.has(d.doc_type ?? "") && d.is_active),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-xl font-semibold">Your documents</h2>
        <p className="mb-4 text-sm text-navy-800/55">
          JD, intake notes, scorecard — set once, reused on every run. A new JD
          automatically archives the old one.
        </p>
        <ProjectFilesManager scopeId={projectId} docs={inputDocs} />
      </section>

      <section>
        <h2 className="mb-1 text-xl font-semibold">Agent-created documents</h2>
        <p className="mb-4 text-sm text-navy-800/55">
          Results your agents saved to this project. Open one to read it, or edit
          and rename it like any other document.
        </p>
        <DocExplorer
          scopeType="project"
          scopeId={projectId}
          docs={outputDocs}
          mode="files"
          allowUpload={false}
          emptyHint="No agent results yet. Run an agent and its output is saved here."
        />
      </section>
    </div>
  );
}
