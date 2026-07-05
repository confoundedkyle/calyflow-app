import { describe, expect, it } from "vitest";
import { formatUsd } from "@/lib/money";

describe("formatUsd", () => {
  it("shows sub-cent non-zero spend instead of rounding to zero", () => {
    expect(formatUsd(0.0032)).toBe("$0.0032");
  });

  it("uses cents for ordinary budget amounts", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12.345)).toBe("$12.35");
  });
});
