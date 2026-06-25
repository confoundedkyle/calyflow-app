import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  getActiveQualification,
  getActiveQualificationConversation,
  getPrimaryRunModel,
  getProject,
  listDocuments,
} from "@/lib/queries";
import { QualificationPanel } from "@/components/qualification-panel";

export default async function QualificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { clientId, projectId } = await params;
  const { c: conversationParam } = await searchParams;
  const project = await getProject(session.workspaceId, projectId);
  if (!project || project.client.id !== clientId) notFound();

  const [criteria, conversation, model, projectDocs] = await Promise.all([
    getActiveQualification(session.workspaceId, projectId),
    getActiveQualificationConversation(
      session.workspaceId,
      projectId,
      conversationParam,
    ),
    getPrimaryRunModel(session.workspaceId),
    listDocuments(session.workspaceId, "project", projectId, "file"),
  ]);

  const hasJd = projectDocs.some((d) => d.is_active && d.doc_type === "jd");

  return (
    <QualificationPanel
      key={conversation?.conversationId ?? "new"}
      projectId={project.id}
      criteria={
        criteria
          ? {
              id: criteria.id,
              filename: criteria.filename ?? "Qualification criteria",
              text: criteria.extracted_text ?? "",
              createdAt: criteria.created_at,
            }
          : null
      }
      hasJd={hasJd}
      archived={project.status !== "active"}
      model={model}
      documentsHref={`/clients/${clientId}/projects/${projectId}/documents`}
      initialConversation={conversation}
    />
  );
}
