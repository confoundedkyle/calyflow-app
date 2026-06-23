import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import { db } from "./db";
import { getLibraryAgentBySlug } from "./queries";
import { ensureStarterPack } from "./starter-pack";
import type { Doc, DocType } from "./types";

/**
 * Provisions (idempotently) every new user's **Demo project** — a real project,
 * surfaced in the sidebar's DEMO section, instantiated from a shared template so
 * a brand-new user can run any starter agent end to end with ZERO setup.
 *
 * The template content lives as version-controlled files in `data/demo/` (JD,
 * intake notes, scorecard, candidate CVs) — improve those over time and bump
 * TEMPLATE_VERSION to re-sync every existing demo project's docs to the latest.
 *
 * The demo client/project keep `is_demo = true` (so demo runs stay out of real
 * metrics), but they're shown explicitly in the sidebar. Everything is reused by
 * the live run pipeline (`POST /api/agents/run`), so the demo is the real product.
 * Safe to call on every app-shell load.
 */

const DEMO_CLIENT_NAME = "Northwind";
const DEMO_PROJECT_NAME = "Senior Backend Engineer";
const CV_SCREENER_SLUG = "cv-screener";

// Bump when you change the template (files below, or the client/project names)
// so existing demo projects re-sync on next load.
export const TEMPLATE_VERSION = 2;

interface TemplateDoc {
  docType: DocType;
  /** File under data/demo/ holding the content. */
  file: string;
  /** Display filename of the document in the project. */
  filename: string;
  /** Whether the doc is active (seen by agents) by default. */
  isActive: boolean;
}

// The project template. Singleton doc types (jd/intake_notes/scorecard) are
// active so the document-gated starter agents are immediately runnable; the CVs
// are inactive inputs the user toggles on for the CV Screener.
const DEMO_TEMPLATE: TemplateDoc[] = [
  {
    docType: "jd",
    file: "job-description.md",
    filename: "Senior Backend Engineer — JD.md",
    isActive: true,
  },
  {
    docType: "intake_notes",
    file: "intake-notes.md",
    filename: "Northwind — Intake notes.md",
    isActive: true,
  },
  {
    docType: "scorecard",
    file: "scorecard.md",
    filename: "Senior Backend Engineer — Scorecard.md",
    isActive: true,
  },
  {
    docType: "cv",
    file: "cv-priya-sharma.md",
    filename: "Priya Sharma — CV.md",
    isActive: false,
  },
  {
    docType: "cv",
    file: "cv-marcus-bell.md",
    filename: "Marcus Bell — CV.md",
    isActive: false,
  },
  {
    docType: "cv",
    file: "cv-jenna-okafor.md",
    filename: "Jenna Okafor — CV.md",
    isActive: false,
  },
];

function readDemoFile(file: string): string {
  return readFileSync(join(process.cwd(), "data", "demo", file), "utf8");
}

// --- Demo Automation Hub --------------------------------------------------
// An agency-level set of configured automations so the Automation Hub shows a
// realistic library on first visit. The bound connectors are NOT connected in a
// fresh workspace, so the Hub renders every row as inactive (red) with an empty
// last run — a clear "connect your tools to activate these" state. Provisioned
// idempotently per workspace: skipped once the workspace has any automation of
// its own, so it never duplicates and never overwrites real config.

interface DemoAutomation {
  slug: string;
  /** Pre-filled connector bindings (shown as the "Greenhouse → Apollo"
   *  subtitle). They stay inactive until the user actually connects them. */
  bindings: Record<string, string>;
}

const DEMO_AUTOMATIONS: DemoAutomation[] = [
  { slug: "ats-enrichment", bindings: { ats: "vincere", tool: "coresignal" } },
  { slug: "crm-enrichment", bindings: { crm: "hubspot", tool: "coresignal" } },
  { slug: "daily-ats-reporting", bindings: { ats: "vincere", comms: "slack" } },
  { slug: "daily-crm-reporting", bindings: { crm: "hubspot", comms: "slack" } },
  { slug: "existing-client-research", bindings: { ats: "vincere", tool: "coresignal", data: "google-sheets" } },
  { slug: "new-client-research", bindings: { crm: "hubspot", tool: "coresignal", data: "google-sheets" } },
];

/**
 * Idempotently provision the demo Automation Hub for a workspace. No-op once the
 * workspace has any automation row (so real config is never touched and the demo
 * isn't re-added after the user archives it). Safe to call on every Hub load.
 *
 * No runs are seeded: the bound connectors aren't connected, so the automations
 * can't have run — the Hub surfaces them as inactive (red) until the user
 * connects the tools.
 */
export async function ensureDemoAutomations(
  workspaceId: string,
  userId: string | null,
): Promise<void> {
  const { count } = await db()
    .from("workspace_automations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (count && count > 0) return;

  const { data: libs } = await db()
    .from("library_automations")
    .select("id, slug, name, instructions, allowed_tools, model, max_steps, default_schedule, version");
  const bySlug = new Map((libs ?? []).map((l) => [l.slug as string, l]));

  for (const demo of DEMO_AUTOMATIONS) {
    const lib = bySlug.get(demo.slug);
    if (!lib) continue; // library not seeded yet — skip silently
    const schedule =
      (lib.default_schedule as
        | { kind: "daily" | "weekly" | "hourly"; time?: string }
        | null) ?? null;
    await db()
      .from("workspace_automations")
      .insert({
        workspace_id: workspaceId,
        library_automation_id: lib.id,
        name: lib.name,
        instructions: lib.instructions,
        allowed_tools: lib.allowed_tools,
        model: lib.model,
        max_steps: lib.max_steps,
        imported_version: lib.version,
        connector_bindings: demo.bindings,
        schedule,
        enabled: true,
        status: "healthy",
        last_run_at: null,
        next_run_at: null,
        created_by: userId,
      });
  }
}

export interface DemoContext {
  clientId: string;
  projectId: string;
  agentId: string;
  jd: { id: string; filename: string };
  cvs: { id: string; filename: string }[];
}

export async function ensureDemoProject(
  workspaceId: string,
  userId: string | null,
): Promise<DemoContext> {
  const clientId = await ensureDemoClient(workspaceId);
  const { projectId, templateVersion } = await ensureDemoProjectRow(
    workspaceId,
    clientId,
  );
  // Make every starter agent (and the CV Screener) runnable in the demo project.
  await ensureStarterPack(workspaceId);
  const agentId = await ensureCvScreenerAgent(workspaceId);

  const seeded = await ensureTemplateDocs(
    workspaceId,
    projectId,
    userId,
    templateVersion,
  );

  const jd = seeded.find((d) => d.docType === "jd")!;
  const cvs = seeded.filter((d) => d.docType === "cv");
  return {
    clientId,
    projectId,
    agentId,
    jd: { id: jd.id, filename: jd.filename },
    cvs: cvs.map((c) => ({ id: c.id, filename: c.filename })),
  };
}

async function ensureDemoClient(workspaceId: string): Promise<string> {
  const { data: existing } = await db()
    .from("clients")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  if (existing) {
    // Keep the name in sync with the template (e.g. after a rename).
    if (existing.name !== DEMO_CLIENT_NAME) {
      await db()
        .from("clients")
        .update({ name: DEMO_CLIENT_NAME })
        .eq("id", existing.id);
    }
    return existing.id as string;
  }

  const { data, error } = await db()
    .from("clients")
    .insert({ workspace_id: workspaceId, name: DEMO_CLIENT_NAME, is_demo: true })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function ensureDemoProjectRow(
  workspaceId: string,
  clientId: string,
): Promise<{ projectId: string; templateVersion: number | null }> {
  const { data: existing } = await db()
    .from("projects")
    .select("id, name, template_version")
    .eq("client_id", clientId)
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  if (existing) {
    if (existing.name !== DEMO_PROJECT_NAME) {
      await db()
        .from("projects")
        .update({ name: DEMO_PROJECT_NAME })
        .eq("id", existing.id);
    }
    return {
      projectId: existing.id as string,
      templateVersion: (existing.template_version as number | null) ?? null,
    };
  }

  const { data, error } = await db()
    .from("projects")
    .insert({ client_id: clientId, name: DEMO_PROJECT_NAME, is_demo: true })
    .select("id")
    .single();
  if (error) throw error;
  return { projectId: data.id as string, templateVersion: null };
}

/** Find the workspace's CV Screener agent copy, importing a snapshot if none. */
async function ensureCvScreenerAgent(workspaceId: string): Promise<string> {
  const library = await getLibraryAgentBySlug(CV_SCREENER_SLUG);
  if (!library) throw new Error("CV Screener is not in the agent library");

  const { data: existing } = await db()
    .from("workspace_agents")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("library_agent_id", library.id)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await db()
    .from("workspace_agents")
    .insert({
      workspace_id: workspaceId,
      library_agent_id: library.id,
      name: library.name,
      instructions: library.instructions,
      allowed_tools: library.allowed_tools,
      model: library.model,
      max_steps: library.max_steps,
      imported_version: library.version,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

interface SeededDoc {
  id: string;
  filename: string;
  docType: DocType;
}

/**
 * Reconcile the demo project's documents with the template. Missing docs are
 * always inserted (self-heal). When the stored template_version is behind
 * TEMPLATE_VERSION, existing template-origin docs are re-synced to the latest
 * content and the project's template_version is advanced. Only the demo project
 * is touched.
 */
async function ensureTemplateDocs(
  workspaceId: string,
  projectId: string,
  userId: string | null,
  templateVersion: number | null,
): Promise<SeededDoc[]> {
  const needsSync = (templateVersion ?? 0) < TEMPLATE_VERSION;

  const { data } = (await db()
    .from("documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("scope_type", "project")
    .eq("scope_id", projectId)) as { data: Doc[] | null };
  const existingDocs = data ?? [];

  const seeded: SeededDoc[] = [];
  for (const spec of DEMO_TEMPLATE) {
    // Match a template doc by its type + filename (filenames are stable per slot).
    const match = existingDocs.find(
      (d) => d.doc_type === spec.docType && d.filename === spec.filename,
    );
    const text = readDemoFile(spec.file);

    if (!match) {
      const { data: inserted, error } = await db()
        .from("documents")
        .insert({
          scope_type: "project",
          scope_id: projectId,
          workspace_id: workspaceId,
          kind: "file",
          doc_type: spec.docType,
          source: "pasted",
          filename: spec.filename,
          extracted_text: text,
          is_active: spec.isActive,
          created_by: userId,
        })
        .select("id, filename")
        .single();
      if (error) throw error;
      seeded.push({
        id: inserted.id as string,
        filename: inserted.filename as string,
        docType: spec.docType,
      });
      continue;
    }

    if (needsSync && match.extracted_text !== text) {
      await db()
        .from("documents")
        .update({ extracted_text: text })
        .eq("id", match.id);
    }
    seeded.push({
      id: match.id,
      filename: match.filename ?? spec.filename,
      docType: spec.docType,
    });
  }

  if (needsSync) {
    await db()
      .from("projects")
      .update({ template_version: TEMPLATE_VERSION })
      .eq("id", projectId);
  }

  return seeded;
}
