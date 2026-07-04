import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listDocuments } from "@/lib/queries";
import { DocExplorer } from "@/components/doc-explorer";

export default async function WorkspaceFilesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const docs = await listDocuments(
    session.workspaceId,
    "workspace",
    session.workspaceId,
    "file",
  );
  const activeDocs = docs.filter((d) => d.is_active);

  return (
    <>
      <p className="mb-6 max-w-2xl text-sm text-navy-800/55">
        Templates, SOPs, and reference docs your team can access — not sent to
        the AI automatically.{" "}
        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-cream-100 px-2.5 py-0.5 align-middle text-xs font-semibold text-navy-800/45">
          Not sent to AI
        </span>
      </p>
      <DocExplorer
        scopeType="workspace"
        scopeId={session.workspaceId}
        docs={activeDocs}
        mode="files"
      />
    </>
  );
}
