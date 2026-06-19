import { describe, it, expect } from "vitest";
import {
  agentMenuText,
  parseInvocation,
  resolveAgentForToken,
  type RunnableAgent,
} from "@/lib/agents/slack-bot";

function agent(
  name: string,
  slug: string | null,
  context: string | null = "recruiting-project",
): RunnableAgent {
  return {
    id: `id-${slug ?? name}`,
    name,
    library: slug || context ? { slug, context } : null,
    archived_at: null,
  } as RunnableAgent;
}

const agents = [
  agent("GitHub Sourcer", "github-sourcer"),
  agent("CV Screener", "cv-screener"),
  agent("My Custom Agent", null), // no library slug → match by name
];

describe("parseInvocation", () => {
  it("splits the first word as the agent token, the rest as the task", () => {
    expect(parseInvocation("github-sourcer find 5 Rust engineers")).toEqual({
      token: "github-sourcer",
      task: "find 5 Rust engineers",
    });
  });

  it("treats empty / help / agents as a menu request (no token)", () => {
    expect(parseInvocation("").token).toBeNull();
    expect(parseInvocation("  help ").token).toBeNull();
    expect(parseInvocation("agents").token).toBeNull();
  });

  it("handles an agent token with no task", () => {
    expect(parseInvocation("cv-screener")).toEqual({ token: "cv-screener", task: "" });
  });
});

describe("resolveAgentForToken", () => {
  it("matches by library slug (case-insensitive)", () => {
    expect(resolveAgentForToken(agents, "GitHub-Sourcer")?.name).toBe("GitHub Sourcer");
  });

  it("falls back to a slugified name match", () => {
    expect(resolveAgentForToken(agents, "my-custom-agent")?.name).toBe("My Custom Agent");
  });

  it("returns null for an unknown token", () => {
    expect(resolveAgentForToken(agents, "nope")).toBeNull();
  });
});

describe("agentMenuText", () => {
  it("lists each agent by slug and includes a usage example", () => {
    const text = agentMenuText(agents);
    expect(text).toContain("`github-sourcer`");
    expect(text).toContain("/calyflow github-sourcer");
  });

  it("guides the user when no agents are imported", () => {
    expect(agentMenuText([])).toContain("No recruiting agents");
  });
});
