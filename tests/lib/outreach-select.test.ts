import { describe, expect, it } from "vitest";
import {
  selectOutreachCandidates,
  canSendDraft,
  isEmailProvider,
  hasEmail,
} from "@/lib/outreach/select";
import type { Candidate } from "@/lib/types";

function cand(p: Partial<Candidate>): Candidate {
  return {
    id: p.id ?? "c1",
    workspace_id: "w",
    project_id: "p",
    source: "github",
    name: p.name ?? "Test",
    email: p.email ?? null,
    linkedin: null,
    score: p.score ?? null,
    qualified: p.qualified ?? false,
    status: "sourced",
    raw: {},
    storage_path: null,
    feedback: p.feedback ?? null,
    feedback_reason: null,
    feedback_at: null,
    feedback_by: null,
    created_by: null,
    created_at: "2026-06-26",
  };
}

describe("selectOutreachCandidates", () => {
  it("picks accepted-with-email when any candidate was fit-reviewed", () => {
    const list = [
      cand({ id: "a", email: "a@x.com", feedback: "accepted", qualified: true }),
      cand({ id: "b", email: "b@x.com", feedback: "rejected", qualified: true }),
      cand({ id: "c", email: "c@x.com", qualified: true }), // qualified but not accepted
    ];
    expect(selectOutreachCandidates(list).map((c) => c.id)).toEqual(["a"]);
  });

  it("excludes accepted candidates that have no email", () => {
    const list = [
      cand({ id: "a", email: null, feedback: "accepted" }),
      cand({ id: "b", email: "b@x.com", feedback: "accepted" }),
    ];
    expect(selectOutreachCandidates(list).map((c) => c.id)).toEqual(["b"]);
  });

  it("falls back to qualified-with-email when nothing was accepted", () => {
    const list = [
      cand({ id: "a", email: "a@x.com", qualified: true }),
      cand({ id: "b", email: "b@x.com", qualified: false }),
      cand({ id: "c", email: null, qualified: true }),
    ];
    expect(selectOutreachCandidates(list).map((c) => c.id)).toEqual(["a"]);
  });

  it("is empty when no one qualifies with an email", () => {
    expect(selectOutreachCandidates([cand({ email: null })])).toEqual([]);
  });
});

describe("hasEmail", () => {
  it("treats blank/whitespace as no email", () => {
    expect(hasEmail({ email: "  " })).toBe(false);
    expect(hasEmail({ email: null })).toBe(false);
    expect(hasEmail({ email: "x@y.com" })).toBe(true);
  });
});

describe("canSendDraft", () => {
  it("allows draft and failed (retry) when a recipient exists", () => {
    expect(canSendDraft("draft", "x@y.com")).toBe(true);
    expect(canSendDraft("failed", "x@y.com")).toBe(true);
  });
  it("blocks sent and rejected", () => {
    expect(canSendDraft("sent", "x@y.com")).toBe(false);
    expect(canSendDraft("rejected", "x@y.com")).toBe(false);
  });
  it("blocks when there's no recipient", () => {
    expect(canSendDraft("draft", null)).toBe(false);
    expect(canSendDraft("draft", "  ")).toBe(false);
  });
});

describe("isEmailProvider", () => {
  it("recognizes the supported mailboxes", () => {
    expect(isEmailProvider("gmail")).toBe(true);
    expect(isEmailProvider("microsoft-outlook")).toBe(true);
    expect(isEmailProvider("slack")).toBe(false);
  });
});
