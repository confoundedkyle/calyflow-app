import { describe, expect, it } from "vitest";
import { formatFeedbackBlock } from "@/lib/candidates/feedback";

describe("formatFeedbackBlock", () => {
  it("is empty when there's no feedback", () => {
    expect(formatFeedbackBlock([], [])).toBe("");
  });

  it("lists accepted candidates with their title", () => {
    const block = formatFeedbackBlock(
      [{ name: "Ada Lovelace", title: "Staff Engineer" }],
      [],
    );
    expect(block).toContain("# Recruiter feedback on candidates so far");
    expect(block).toContain("Accepted (good fits):");
    expect(block).toContain("- Ada Lovelace — Staff Engineer");
    expect(block).not.toContain("Rejected");
  });

  it("lists rejected candidates with their reason", () => {
    const block = formatFeedbackBlock(
      [],
      [{ name: "John Doe", reason: "Too junior" }],
    );
    expect(block).toContain("Rejected (not a fit):");
    expect(block).toContain("- John Doe — Too junior");
    expect(block).not.toContain("Accepted");
  });

  it("handles missing names and reasons gracefully", () => {
    const block = formatFeedbackBlock(
      [{ name: null }],
      [{ name: "Jane", reason: null }],
    );
    expect(block).toContain("- Unnamed");
    expect(block).toContain("- Jane");
    // No trailing em-dash when there's no reason.
    expect(block).not.toContain("Jane —");
  });
});
