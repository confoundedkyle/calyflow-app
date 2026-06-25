import { describe, expect, it } from "vitest";
import { budgetReached } from "@/lib/shortlist/budget";
import {
  deriveQualified,
  deriveStatus,
  QUALIFIED_SCORE_THRESHOLD,
} from "@/lib/candidates/qualified";

describe("budgetReached", () => {
  it("is false when no budget is set", () => {
    expect(budgetReached(1000, null)).toBe(false);
    expect(budgetReached(1000, 0)).toBe(false);
  });

  it("is false while spend is under the budget", () => {
    expect(budgetReached(9.99, 10)).toBe(false);
  });

  it("is true once spend reaches the budget", () => {
    expect(budgetReached(10, 10)).toBe(true);
    expect(budgetReached(20, 10)).toBe(true);
  });
});

describe("deriveQualified", () => {
  it("honours an explicit boolean over the score", () => {
    expect(deriveQualified(95, false)).toBe(false);
    expect(deriveQualified(10, true)).toBe(true);
  });

  it("derives from the score and threshold when not explicit", () => {
    expect(deriveQualified(QUALIFIED_SCORE_THRESHOLD, null)).toBe(true);
    expect(deriveQualified(QUALIFIED_SCORE_THRESHOLD - 1, null)).toBe(false);
  });

  it("is false with no score and no flag", () => {
    expect(deriveQualified(null, null)).toBe(false);
    expect(deriveQualified(undefined, undefined)).toBe(false);
  });
});

describe("deriveStatus", () => {
  it("keeps an explicit status", () => {
    expect(deriveStatus("rejected", true)).toBe("rejected");
  });

  it("derives from qualified when absent", () => {
    expect(deriveStatus(null, true)).toBe("qualified");
    expect(deriveStatus(null, false)).toBe("sourced");
  });
});
