/**
 * Uploads a private harness (the prompt/IP) to the private `system-config`
 * Storage bucket. Run once per environment — harnesses are deliberately NOT
 * committed to the repo, so they live in files outside the git tree (e.g.
 * ./secrets/*.md, which is .gitignored).
 *
 * Usage:
 *   node scripts/upload-harness.mjs <path-to-harness.md> [object-key]
 *
 * object-key defaults to "sourcing-plan/harness.md" for back-compat. The other
 * harnesses are "shortlist/harness.md" and "qualification/harness.md".
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local for
 * local runs, or the real environment in CI/prod).
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const BUCKET = "system-config";

const path = process.argv[2];
const OBJECT_KEY = process.argv[3] ?? "sourcing-plan/harness.md";
if (!path) {
  console.error(
    "Usage: node scripts/upload-harness.mjs <path-to-harness.md> [object-key]",
  );
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

let body;
try {
  body = readFileSync(path);
} catch (err) {
  console.error(`Could not read ${path}:`, err.message);
  process.exit(1);
}
if (body.length === 0) {
  console.error(`${path} is empty — nothing to upload.`);
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

// The bucket is created by migration 0027; create it here too so the script
// works against a fresh DB before migrations, idempotently.
await db.storage.createBucket(BUCKET, { public: false }).catch(() => {});

const { error } = await db.storage
  .from(BUCKET)
  .upload(OBJECT_KEY, body, { contentType: "text/markdown", upsert: true });
if (error) {
  console.error("Upload failed:", error.message);
  process.exit(1);
}

console.log(
  `Uploaded ${body.length} bytes → ${BUCKET}/${OBJECT_KEY}. ` +
    "It will be used on the next run (cached up to 5 min).",
);
