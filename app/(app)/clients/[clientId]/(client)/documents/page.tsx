import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getClient, listDocuments } from "@/lib/queries";
import { DocExplorer } from "@/components/doc-explorer";

export default async function ClientFilesPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { clientId } = await params;
  const client = await getClient(session.workspaceId, clientId);
  if (!client) notFound();

  const docs = await listDocuments(session.workspaceId, "client", clientId, "file");
  const activeDocs = docs.filter((d) => d.is_active);

  return (
    <>
      <p className="mb-6 max-w-2xl text-sm text-navy-800/55">
        Company deck, benefits overview, rate card — used to sell the company
        in outreach and submissions.{" "}
        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-cream-100 px-2.5 py-0.5 align-middle text-xs font-semibold text-navy-800/45">
          Not sent to AI
        </span>
      </p>
      <DocExplorer
        scopeType="client"
        scopeId={clientId}
        docs={activeDocs}
        mode="files"
      />
    </>
  );
}
