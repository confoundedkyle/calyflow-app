import { describe, expect, it } from "vitest";
import {
  buildEnrichmentCsv,
  parseCsv,
  detectHeader,
  normalizeLinkedinUrl,
  canonicalLinkedinUrl,
  heuristicEnrichmentMapping,
  coerceEnrichmentMapping,
  rowsToEnrichmentRecords,
  mappingHasEmail,
} from "@/lib/enrichment/csv";

describe("buildEnrichmentCsv", () => {
  it("writes a header + a blank email column and quotes risky cells", () => {
    const csv = buildEnrichmentCsv([
      { id: "c1", name: "Ada Lovelace", linkedin: "https://linkedin.com/in/ada" },
      { id: "c2", name: 'Grace, "Amazing" Hopper', linkedin: null },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("calyflow_id,name,linkedin_url,email");
    expect(lines[1]).toBe("c1,Ada Lovelace,https://linkedin.com/in/ada,");
    expect(lines[2]).toBe('c2,"Grace, ""Amazing"" Hopper",,');
  });
});

describe("parseCsv", () => {
  it("handles quoted fields, escaped quotes, CRLF, and a BOM", () => {
    const table = parseCsv('﻿a,b\r\n"x,y","he said ""hi"""\r\n');
    expect(table).toEqual([
      ["a", "b"],
      ["x,y", 'he said "hi"'],
    ]);
  });
});

describe("detectHeader", () => {
  it("returns the first non-blank row even after a blank line", () => {
    const got = detectHeader([["", ""], ["Name", "Email"], ["Ada", "a@b.com"]]);
    expect(got).toEqual({ index: 1, cells: ["Name", "Email"] });
  });
  it("returns null for an all-blank table", () => {
    expect(detectHeader([["", ""]])).toBeNull();
  });
});

describe("normalizeLinkedinUrl", () => {
  it("strips scheme, www, query, trailing slash and lower-cases", () => {
    expect(normalizeLinkedinUrl("HTTPS://www.LinkedIn.com/in/Ada/?utm=x")).toBe(
      "linkedin.com/in/ada",
    );
  });
});

describe("canonicalLinkedinUrl", () => {
  it("adds a trailing slash, is idempotent, and ignores non-LinkedIn URLs", () => {
    expect(canonicalLinkedinUrl("https://rs.linkedin.com/in/vl-jednak")).toBe(
      "https://rs.linkedin.com/in/vl-jednak/",
    );
    expect(canonicalLinkedinUrl("https://linkedin.com/in/ada/")).toBe(
      "https://linkedin.com/in/ada/",
    );
    expect(canonicalLinkedinUrl("https://github.com/ada")).toBe(
      "https://github.com/ada",
    );
    expect(canonicalLinkedinUrl(null)).toBeNull();
  });
  it("keeps the query after the slash", () => {
    expect(canonicalLinkedinUrl("https://linkedin.com/in/ada?x=1")).toBe(
      "https://linkedin.com/in/ada/?x=1",
    );
  });
});

describe("heuristicEnrichmentMapping", () => {
  it("classifies a ContactOut-style header, ignoring status columns", () => {
    const headers = [
      "calyflow_id",
      "Name",
      "LinkedIn URL",
      "Personal Email",
      "Other Personal Emails",
      "Work Email",
      "Work Email Status",
      "Phone",
    ];
    expect(heuristicEnrichmentMapping(headers)).toEqual([
      "calyflow_id",
      "name",
      "linkedin_url",
      "personal_email",
      "personal_email",
      "work_email",
      null, // "Work Email Status" is not an address
      "phone",
    ]);
  });
  it("maps a bare 'Email' header to other_email and leaves unknowns null", () => {
    expect(heuristicEnrichmentMapping(["Email", "Seniority"])).toEqual([
      "other_email",
      null,
    ]);
  });
});

describe("coerceEnrichmentMapping", () => {
  it("keeps valid field keys, nulls the rest, aligned to header count", () => {
    expect(
      coerceEnrichmentMapping(["personal_email", "bogus", "name"], 4),
    ).toEqual(["personal_email", null, "name", null]);
  });
});

describe("mappingHasEmail", () => {
  it("is true only when an email field is present", () => {
    expect(mappingHasEmail(["name", "work_email"])).toBe(true);
    expect(mappingHasEmail(["name", "phone", null])).toBe(false);
  });
});

describe("rowsToEnrichmentRecords", () => {
  const headers = [
    "calyflow_id",
    "Name",
    "LinkedIn URL",
    "Personal Email",
    "Other Personal Emails",
    "Work Email",
    "Work Email Status",
    "Seniority",
  ];
  const mapping = heuristicEnrichmentMapping(headers);

  it("prefers a personal email, collects all emails, and keeps extra columns", () => {
    const rows = [
      [
        "c1",
        "Ada Lovelace",
        "https://linkedin.com/in/ada",
        "ada@gmail.com",
        "ada2@gmail.com, ada3@yahoo.com",
        "ada@work.com",
        "Verified",
        "Senior",
      ],
    ];
    const [rec] = rowsToEnrichmentRecords(rows, headers, mapping);
    expect(rec.id).toBe("c1");
    expect(rec.linkedin).toBe("https://linkedin.com/in/ada");
    expect(rec.primaryEmail).toBe("ada@gmail.com"); // personal preferred
    expect(rec.emails.personal).toEqual([
      "ada@gmail.com",
      "ada2@gmail.com",
      "ada3@yahoo.com",
    ]);
    expect(rec.emails.work).toEqual(["ada@work.com"]);
    // The status column isn't an address, but its value is still kept as data.
    expect(rec.extra).toEqual({
      "Work Email Status": "Verified",
      Seniority: "Senior",
    });
  });

  it("falls back to the work email when there's no personal one", () => {
    const rows = [
      ["c2", "Otto", "https://linkedin.com/in/otto", "", "", "otto@work.com", "Verified", ""],
    ];
    const [rec] = rowsToEnrichmentRecords(rows, headers, mapping);
    expect(rec.primaryEmail).toBe("otto@work.com");
  });

  it("skips rows with no email at all", () => {
    const rows = [
      ["c3", "NoEmail", "https://linkedin.com/in/none", "", "", "", "", "Lead"],
    ];
    expect(rowsToEnrichmentRecords(rows, headers, mapping)).toEqual([]);
  });
});
