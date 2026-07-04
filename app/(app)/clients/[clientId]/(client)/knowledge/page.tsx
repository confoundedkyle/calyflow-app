import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { getClient, listDocuments } from "@/lib/queries";
import { DocExplorer } from "@/components/doc-explorer";
import { ImportDomain } from "@/components/import-domain";

export default async function ClientKnowledgePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { clientId } = await params;
  const client = await getClient(session.workspaceId, clientId);
  if (!client) notFound();

  const docs = await listDocuments(session.workspaceId, "client", clientId, "kb");
  const activeDocs = docs.filter((d) => d.is_active);

  return (
    <>
      <p className="mb-6 max-w-2xl text-sm text-navy-800/55">
        How THEY work — preferences and learned quirks (&quot;hates
        job-hoppers&quot;, &quot;always asks about notice periods&quot;).
        Persists across every search.{" "}
        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-sky-300/35 px-2.5 py-0.5 align-middle text-xs font-semibold text-navy-800/75">
          Auto-injected into every run
        </span>
      </p>
      <DocExplorer
        scopeType="client"
        scopeId={clientId}
        docs={activeDocs}
        mode="kb"
        importSlot={
          env.firecrawlApiKey ? <ImportDomain clientId={clientId} /> : null
        }
      />
    </>
  );
}
