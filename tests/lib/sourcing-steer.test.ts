import { describe, expect, it } from "vitest";
import { buildRecruiterSteerBlock } from "@/lib/sourcing/steer";

describe("buildRecruiterSteerBlock", () => {
  it("keeps people-search connector requests as the primary channel", () => {
    const block = buildRecruiterSteerBlock("now try Apollo", ["apollo"]);

    expect(block).toContain("Apollo");
    expect(block).toContain("primary channel");
  });

  it("does not let Hunter masquerade as candidate discovery", () => {
    const block = buildRecruiterSteerBlock("search with hunter", ["hunter"]);

    expect(block).toContain("Hunter.io");
    expect(block).toContain("not candidate discovery");
    expect(block).toContain("Do NOT present it as a sourcing search channel");
  });

  it("flags named connectors that are not connected", () => {
    const block = buildRecruiterSteerBlock("search with Coresignal", ["github"]);

    expect(block).toContain("Coresignal");
    expect(block).toContain("not connected");
    expect(block).toContain("Do NOT propose using Coresignal");
  });

  it("is empty when no connector is named", () => {
    expect(buildRecruiterSteerBlock("focus on London healthtech", ["apollo"])).toBe("");
  });
});
