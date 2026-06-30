// CSV helpers for the Shortlist email-enrichment round-trip: export the
// candidates that still need an email (with their LinkedIn URLs) to a CSV the
// recruiter runs through ContactOut / Hunter / similar, then import the enriched
// file back. Tool exports vary wildly (ContactOut alone has "Personal Email",
// "Other Personal Emails", "Work Email", "Work Email Status", …), so the import
// maps columns with an AI agent (lib/actions/enrichment.ts) and falls back to
// the heuristic mapping here. Pure + dependency-free so it runs in the browser
// (download) and on the server (import), and is fully unit-tested.

/** One row of the exported "needs email" CSV. */
export interface EnrichmentExportRow {
  id: string;
  name: string | null;
  linkedin: string | null;
}

const EXPORT_HEADERS = ["calyflow_id", "name", "linkedin_url", "email"] as const;

function csvCell(value: string): string {
  const s = value ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build the CSV the recruiter downloads. The `email` column is left blank for
 *  the enrichment tool to fill; `calyflow_id` lets us match the file back exactly
 *  even if the LinkedIn URL gets reformatted. */
export function buildEnrichmentCsv(rows: EnrichmentExportRow[]): string {
  const lines = [EXPORT_HEADERS.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.id, r.name ?? "", r.linkedin ?? "", ""].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n");
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes
 *  (`""`), both `\n` and `\r\n` line endings, and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAny = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      sawAny = true;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAny = false;
    } else if (c === "\r") {
      // swallow — the following \n closes the line
    } else {
      field += c;
      sawAny = true;
    }
  }
  if (sawAny || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const isBlankRow = (row: string[]) => row.every((c) => !c || c.trim() === "");

export interface DetectedHeader {
  index: number;
  cells: string[];
}

/** The header is the first non-blank row (tool exports occasionally prefix a
 *  blank line or leading empty column). */
export function detectHeader(rows: string[][]): DetectedHeader | null {
  for (let i = 0; i < rows.length; i++) {
    if (!isBlankRow(rows[i])) return { index: i, cells: rows[i] };
  }
  return null;
}

/** Normalize a LinkedIn URL for matching: drop scheme, `www.`, query string,
 *  trailing slash, and lower-case. So the URL we exported matches the one the
 *  tool echoed back even if it was reformatted. */
export function normalizeLinkedinUrl(url: string | null | undefined): string {
  if (!url) return "";
  let s = url.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split(/[?#]/)[0].replace(/\/+$/, "");
  return s;
}

/** Canonicalize a LinkedIn URL to the form LinkedIn itself redirects to: a
 *  single trailing slash on the path. Enrichment tools (ContactOut and similar)
 *  match the canonical, slash-terminated URL — a profile saved without the slash
 *  often fails to pair — so we store URLs in this form. Preserves scheme, host
 *  (incl. country subdomains like `rs.linkedin.com`), and any query/fragment;
 *  only touches LinkedIn URLs so non-LinkedIn values pass through untouched. */
export function canonicalLinkedinUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const s = url.trim();
  if (!s || !/linkedin\.com/i.test(s)) return s || null;
  const [, path = s, suffix = ""] = s.match(/^([^?#]*)([?#].*)?$/) ?? [];
  return `${path.replace(/\/+$/, "")}/${suffix}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Column mapping (AI + heuristic) --------------------------------------

/** The fields an enriched-CSV column can map to. `*_email` are kept distinct so
 *  we can prefer a personal address; everything unmapped is retained verbatim. */
export const ENRICHMENT_FIELDS = [
  "calyflow_id",
  "name",
  "linkedin_url",
  "personal_email",
  "work_email",
  "other_email",
  "phone",
] as const;
export type EnrichmentField = (typeof ENRICHMENT_FIELDS)[number];

export function isEnrichmentField(v: unknown): v is EnrichmentField {
  return (
    typeof v === "string" &&
    (ENRICHMENT_FIELDS as readonly string[]).includes(v)
  );
}

function isEmailField(f: EnrichmentField | null): boolean {
  return f === "personal_email" || f === "work_email" || f === "other_email";
}

/** True when a mapping resolves at least one email column. */
export function mappingHasEmail(mapping: (EnrichmentField | null)[]): boolean {
  return mapping.some(isEmailField);
}

/** Heuristic header → field mapping, used when no AI provider is configured (or
 *  the AI mapping comes back without an email column). Recognises the common
 *  shapes from ContactOut / Hunter / Findymail / etc. and, crucially, ignores
 *  status/validation columns like "Work Email Status". */
export function heuristicEnrichmentMapping(
  headers: string[],
): (EnrichmentField | null)[] {
  return headers.map((raw) => {
    const h = raw.trim().toLowerCase();
    if (!h) return null;
    if (/calyflow[\s_]?id/.test(h) || h === "id" || /candidate.*id/.test(h))
      return "calyflow_id";
    if (/linkedin/.test(h) || /profile.*url/.test(h) || h === "url" || h === "profile")
      return "linkedin_url";
    if (/e-?mail/.test(h)) {
      // "Work Email Status", "Email Validity", "Email Type" etc. aren't addresses.
      if (/status|valid|verif|type|score|deliver|quality|grade/.test(h))
        return null;
      if (/personal/.test(h)) return "personal_email";
      if (/work|business|company|professional/.test(h)) return "work_email";
      return "other_email";
    }
    if (/phone|mobile|\btel\b|cell/.test(h)) return "phone";
    if (/full.?name/.test(h) || h === "name") return "name";
    return null;
  });
}

/** Coerce an AI-produced mapping (array of field strings / null) to our shape,
 *  aligned to `headerCount`. Unknown values become null. */
export function coerceEnrichmentMapping(
  raw: unknown,
  headerCount: number,
): (EnrichmentField | null)[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: headerCount }, (_, i) =>
    isEnrichmentField(arr[i]) ? (arr[i] as EnrichmentField) : null,
  );
}

/** A candidate's enriched data parsed from one CSV row. */
export interface EnrichmentImportRecord {
  /** Our candidate id, if the tool preserved the column. */
  id: string | null;
  /** LinkedIn URL, for matching when there's no id. */
  linkedin: string | null;
  name: string | null;
  /** The email to store on the candidate — a personal address is preferred. */
  primaryEmail: string | null;
  emails: { personal: string[]; work: string[]; other: string[] };
  phone: string | null;
  /** Unmapped, non-empty columns kept verbatim under their original header. */
  extra: Record<string, string>;
}

const dedupe = (arr: string[]) => Array.from(new Set(arr));

/** A cell may hold several addresses ("a@x.com, b@y.com") — split + validate. */
function splitEmails(value: string): string[] {
  return value
    .split(/[;,/]/)
    .map((e) => e.trim())
    .filter((e) => EMAIL_RE.test(e));
}

/**
 * Build enriched records from CSV data rows + a column→field mapping. A row is
 * kept only if it yields at least one email (there's nothing to save otherwise).
 * The primary email prefers personal → work → other; all addresses, the phone,
 * and every unmapped column are retained for the candidate's record.
 */
export function rowsToEnrichmentRecords(
  dataRows: string[][],
  headers: string[],
  mapping: (EnrichmentField | null)[],
): EnrichmentImportRecord[] {
  const out: EnrichmentImportRecord[] = [];
  for (const row of dataRows) {
    if (isBlankRow(row)) continue;
    let id: string | null = null;
    let linkedin: string | null = null;
    let name: string | null = null;
    let phone: string | null = null;
    const personal: string[] = [];
    const work: string[] = [];
    const other: string[] = [];
    const extra: Record<string, string> = {};

    headers.forEach((header, col) => {
      const value = (row[col] ?? "").trim();
      if (!value) return;
      switch (mapping[col] ?? null) {
        case "calyflow_id":
          id ??= value;
          break;
        case "linkedin_url":
          linkedin ??= value;
          break;
        case "name":
          name ??= value;
          break;
        case "phone":
          phone ??= value;
          break;
        case "personal_email":
          personal.push(...splitEmails(value));
          break;
        case "work_email":
          work.push(...splitEmails(value));
          break;
        case "other_email":
          other.push(...splitEmails(value));
          break;
        default:
          extra[header.trim() || `column_${col + 1}`] = value;
      }
    });

    const p = dedupe(personal);
    const w = dedupe(work);
    const o = dedupe(other);
    const primaryEmail = p[0] ?? w[0] ?? o[0] ?? null;
    if (!primaryEmail) continue;
    out.push({
      id,
      linkedin,
      name,
      primaryEmail,
      emails: { personal: p, work: w, other: o },
      phone,
      extra,
    });
  }
  return out;
}
