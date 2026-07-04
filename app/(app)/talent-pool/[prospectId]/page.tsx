import Link from "next/link";
import { notFound } from "next/navigation";
import { requireModulePage } from "@/lib/modules";
import { getProspect, listDocuments } from "@/lib/queries";
import { AddDocument } from "@/components/add-document";
import { Card, Chip, PageHeader } from "@/components/ui";

export default async function ProspectPage({
  params,
}: {
  params: Promise<{ prospectId: string }>;
}) {
  const session = await requireModulePage("talent_pool");
  const { prospectId } = await params;

  const prospect = await getProspect(session.workspaceId, prospectId);
  if (!prospect) notFound();

  const docs = await listDocuments(
    session.workspaceId,
    "prospect",
    prospectId,
    "file",
  );
  const cvs = docs.filter((d) => d.doc_type === "cv");

  const location = [prospect.city, prospect.country].filter(Boolean).join(", ");

  return (
    <>
      <Link
        href="/talent-pool"
        className="mb-4 inline-block text-sm text-navy-800/45 hover:text-mint-700"
      >
        ← LinkedIn Connections
      </Link>
      <PageHeader title={prospect.name} />

      <Card className="mb-6">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Detail label="Job title" value={prospect.job_title} />
          <Detail label="Email" value={prospect.email} />
          <Detail label="Phone" value={prospect.phone} />
          <Detail label="Location" value={location || null} />
          <Detail
            label="LinkedIn"
            value={
              prospect.linkedin_url ? (
                <a
                  href={prospect.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-mint-700 hover:underline"
                >
                  {prospect.linkedin_url}
                </a>
              ) : null
            }
          />
        </dl>
        {prospect.notes && (
          <div className="mt-4">
            <p className="mb-1 text-sm font-semibold text-navy-800/80">Notes</p>
            <p className="whitespace-pre-wrap text-sm text-navy-800/60">
              {prospect.notes}
            </p>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-lg font-semibold">CV</h2>
          {cvs.length > 0 && <Chip tone="mint">{cvs.length}</Chip>}
        </div>

        {cvs.length > 0 && (
          <ul className="mb-5 space-y-2">
            {cvs.map((cv) => (
              <li key={cv.id}>
                <Link
                  href={`/document/${cv.id}`}
                  className="text-sm font-medium text-mint-700 hover:underline"
                >
                  📄 {cv.filename ?? "CV"}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <AddDocument
          scopeType="prospect"
          scopeId={prospect.id}
          kind="file"
          docTypes={["cv"]}
          compact
        />
      </Card>
    </>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null;
}) {
  return (
    <div>
      <dt className="text-sm font-semibold text-navy-800/80">{label}</dt>
      <dd className="mt-0.5 text-sm text-navy-800/60">{value ?? "—"}</dd>
    </div>
  );
}
