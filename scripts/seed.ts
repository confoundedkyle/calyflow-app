/**
 * Seeds the database from repo files (SPEC §4, §13):
 *   - /workflows/*.yaml        → library_workflows (upsert by slug)
 *   - /agents/*.yaml           → library_agents (upsert by slug)
 *   - /data/model-catalog-snapshot.json → model_catalog (upsert)
 *
 * The same mechanism that seeds Calyflow cloud seeds any self-hosted
 * instance. Idempotent — safe to run on every deploy.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed.ts
 */
import { config } from "dotenv";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { load } from "js-yaml";

// Load .env.local for local runs (`npm run seed`). In CI/prod the file is
// absent and the vars come from the real environment — config() is a no-op then.
config({ path: ".env.local" });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

interface WorkflowYaml {
  slug: string;
  name: string;
  description: string;
  category: string;
  version: number;
  input_spec: unknown;
  output_spec: unknown;
  prompt_template: string;
  featured?: boolean;
  og_description?: string;
  lead?: string;
  long_description?: string;
}

async function seedWorkflows() {
  const dir = join(__dirname, "..", "workflows");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  } catch {
    files = []; // no workflows directory — everything below retires cleanly
  }

  // Retire library workflows whose YAML was removed from the repo (the curated
  // workflows have been folded into agents). Workspace copies keep working —
  // they're detached (library_workflow_id → null) so the FK allows the row to go.
  const repoSlugs = files.map(
    (f) => (load(readFileSync(join(dir, f), "utf8")) as WorkflowYaml).slug,
  );
  const { data: existing } = await db
    .from("library_workflows")
    .select("id, slug");
  const stale = (existing ?? []).filter((w) => !repoSlugs.includes(w.slug));
  for (const wf of stale) {
    await db
      .from("workspace_workflows")
      .update({ library_workflow_id: null })
      .eq("library_workflow_id", wf.id);
    const { error } = await db
      .from("library_workflows")
      .delete()
      .eq("id", wf.id);
    if (error) throw new Error(`retire ${wf.slug}: ${error.message}`);
    console.log(`✗ retired workflow ${wf.slug}`);
  }

  for (const file of files) {
    const wf = load(readFileSync(join(dir, file), "utf8")) as WorkflowYaml;
    const { error } = await db.from("library_workflows").upsert(
      {
        slug: wf.slug,
        name: wf.name,
        description: wf.description,
        category: wf.category,
        version: wf.version,
        input_spec: wf.input_spec,
        output_spec: wf.output_spec,
        prompt_template: wf.prompt_template,
        featured: wf.featured ?? false,
        og_description: wf.og_description ?? null,
        lead: wf.lead ?? null,
        long_description: wf.long_description ?? null,
      },
      { onConflict: "slug" },
    );
    if (error) throw new Error(`${file}: ${error.message}`);
    console.log(`✓ workflow ${wf.slug} (v${wf.version})`);
  }
}

interface AgentYaml {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  allowed_tools: string[];
  model: string | null;
  max_steps: number;
  context?: string;
  version?: number;
  featured?: boolean;
  summary?: string;
  og_description?: string;
  lead?: string;
  long_description?: string;
}

async function seedAgents() {
  const dir = join(__dirname, "..", "agents");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  } catch {
    return; // no agents directory yet — nothing to seed
  }

  // Retire library agents whose YAML was removed from the repo (e.g. the
  // per-connector agents replaced by category-generic ones). Workspace copies
  // keep working — they're detached (library_agent_id → null) so the FK
  // allows the library row to go.
  const repoSlugs = files.map(
    (f) => (load(readFileSync(join(dir, f), "utf8")) as AgentYaml).slug,
  );
  const { data: existing } = await db.from("library_agents").select("id, slug");
  const stale = (existing ?? []).filter((a) => !repoSlugs.includes(a.slug));
  for (const agent of stale) {
    await db
      .from("workspace_agents")
      .update({ library_agent_id: null })
      .eq("library_agent_id", agent.id);
    const { error } = await db.from("library_agents").delete().eq("id", agent.id);
    if (error) throw new Error(`retire ${agent.slug}: ${error.message}`);
    console.log(`✗ retired agent ${agent.slug}`);
  }

  for (const file of files) {
    const a = load(readFileSync(join(dir, file), "utf8")) as AgentYaml;
    const version = a.version ?? 1;
    const { data: lib, error } = await db
      .from("library_agents")
      .upsert(
        {
          slug: a.slug,
          name: a.name,
          description: a.description,
          instructions: a.instructions,
          allowed_tools: a.allowed_tools,
          model: a.model ?? null,
          max_steps: a.max_steps ?? 12,
          context: a.context ?? "recruiting-project",
          version,
          featured: a.featured ?? false,
          summary: a.summary ?? null,
          og_description: a.og_description ?? null,
          lead: a.lead ?? null,
          long_description: a.long_description ?? null,
        },
        { onConflict: "slug" },
      )
      .select("id")
      .single();
    if (error || !lib) throw new Error(`${file}: ${error?.message ?? "no row"}`);

    // Propagate the new version to imported copies that are BEHIND it, so library
    // improvements reach every workspace on deploy without a manual "Upgrade".
    // Mirrors the in-app upgrade action (instructions/tools/model/max_steps/
    // imported_version); the copy's name and archived state are left alone. Copies
    // already at this version (incl. ones a user just edited at the current
    // version) are untouched.
    const { data: upgraded, error: upErr } = await db
      .from("workspace_agents")
      .update({
        instructions: a.instructions,
        allowed_tools: a.allowed_tools,
        model: a.model ?? null,
        max_steps: a.max_steps ?? 12,
        imported_version: version,
      })
      .eq("library_agent_id", lib.id)
      .is("archived_at", null)
      .or(`imported_version.is.null,imported_version.lt.${version}`)
      .select("id");
    if (upErr) throw new Error(`${file} (upgrade copies): ${upErr.message}`);

    const n = upgraded?.length ?? 0;
    console.log(
      `✓ agent ${a.slug} (v${version})${n ? ` — upgraded ${n} copies` : ""}`,
    );
  }
}

interface AutomationYaml {
  slug: string;
  name: string;
  description: string;
  summary?: string;
  instructions: string;
  allowed_tools: string[];
  model: string | null;
  max_steps: number;
  required_connectors?: { category: string; label: string }[];
  default_schedule?: { kind: string; time?: string } | null;
  task?: string;
  version?: number;
  featured?: boolean;
  og_description?: string;
  lead?: string;
  long_description?: string;
}

async function seedAutomations() {
  const dir = join(__dirname, "..", "automations");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  } catch {
    return; // no automations directory yet — nothing to seed
  }

  // Retire library automations whose YAML was removed from the repo. Workspace
  // copies keep working — they're detached (library_automation_id → null).
  const repoSlugs = files.map(
    (f) => (load(readFileSync(join(dir, f), "utf8")) as AutomationYaml).slug,
  );
  const { data: existing } = await db
    .from("library_automations")
    .select("id, slug");
  const stale = (existing ?? []).filter((a) => !repoSlugs.includes(a.slug));
  for (const auto of stale) {
    await db
      .from("workspace_automations")
      .update({ library_automation_id: null })
      .eq("library_automation_id", auto.id);
    const { error } = await db
      .from("library_automations")
      .delete()
      .eq("id", auto.id);
    if (error) throw new Error(`retire ${auto.slug}: ${error.message}`);
    console.log(`✗ retired automation ${auto.slug}`);
  }

  for (const file of files) {
    const a = load(readFileSync(join(dir, file), "utf8")) as AutomationYaml;
    const version = a.version ?? 1;
    const { data: lib, error } = await db
      .from("library_automations")
      .upsert(
        {
          slug: a.slug,
          name: a.name,
          description: a.description,
          summary: a.summary ?? null,
          instructions: a.instructions,
          allowed_tools: a.allowed_tools,
          model: a.model ?? null,
          max_steps: a.max_steps ?? 12,
          required_connectors: a.required_connectors ?? [],
          default_schedule: a.default_schedule ?? null,
          task: a.task ?? null,
          version,
          featured: a.featured ?? false,
          og_description: a.og_description ?? null,
          lead: a.lead ?? null,
          long_description: a.long_description ?? null,
        },
        { onConflict: "slug" },
      )
      .select("id")
      .single();
    if (error || !lib) throw new Error(`${file}: ${error?.message ?? "no row"}`);

    // Propagate the new version to imported copies BEHIND it — but only the
    // library-owned fields (instructions/tools/model/max_steps/version). The
    // workspace's own config — connector_bindings, schedule, enabled, name,
    // archived state — is left untouched.
    const { data: upgraded, error: upErr } = await db
      .from("workspace_automations")
      .update({
        instructions: a.instructions,
        allowed_tools: a.allowed_tools,
        model: a.model ?? null,
        max_steps: a.max_steps ?? 12,
        imported_version: version,
      })
      .eq("library_automation_id", lib.id)
      .is("archived_at", null)
      .or(`imported_version.is.null,imported_version.lt.${version}`)
      .select("id");
    if (upErr) throw new Error(`${file} (upgrade copies): ${upErr.message}`);

    const n = upgraded?.length ?? 0;
    console.log(
      `✓ automation ${a.slug} (v${version})${n ? ` — upgraded ${n} copies` : ""}`,
    );
  }
}

async function seedCatalog() {
  const snapshot = JSON.parse(
    readFileSync(join(__dirname, "..", "data", "model-catalog-snapshot.json"), "utf8"),
  ) as { models: Record<string, unknown>[] };
  const rows = snapshot.models.map((m) => ({
    ...m,
    raw: { source: "snapshot" },
    synced_at: new Date().toISOString(),
  }));
  const { error } = await db
    .from("model_catalog")
    .upsert(rows, { onConflict: "provider,model_id" });
  if (error) throw new Error(error.message);
  console.log(`✓ model catalog (${rows.length} models)`);
}

(async () => {
  await seedWorkflows();
  await seedAgents();
  await seedAutomations();
  await seedCatalog();
  console.log("Seed complete.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
