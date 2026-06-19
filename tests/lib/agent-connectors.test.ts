import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_CATEGORY_LABELS,
  CONNECTOR_REQUIREMENT_PREFIX,
  connectorsForCategory,
  providerToolPrefix,
  requiredConnectorCategories,
  CONNECTORS,
} from "@/lib/connectors";
import { ALL_TOOL_NAMES } from "@/lib/agents/tools";
import { deriveAgentGraph } from "@/lib/workflow-graph";

describe("connector requirements", () => {
  it("derives categories from connector: placeholders only", () => {
    expect(
      requiredConnectorCategories([
        "calyflow_search_documents",
        "connector:ats",
        "connector:email",
        "calyflow_create_document",
      ]),
    ).toEqual(["ats", "email"]);
    expect(requiredConnectorCategories(["connector:bogus"])).toEqual([]);
    expect(requiredConnectorCategories(["greenhouse_list_jobs"])).toEqual([]);
  });

  it("maps every live connector's tool prefix onto real tools", () => {
    // Every live provider that has agent tools must be reachable via its
    // prefix; spot-check the exceptions explicitly.
    expect(providerToolPrefix("google-sheets")).toBe("googlesheets_");
    expect(providerToolPrefix("microsoft-excel")).toBe("excel_");
    expect(providerToolPrefix("microsoft-outlook")).toBe("outlook_");
    expect(providerToolPrefix("zoho-crm")).toBe("zohocrm_");
    expect(providerToolPrefix("greenhouse")).toBe("greenhouse_");

    // Each provider of the categories agents can require resolves to ≥1 tool.
    for (const category of ["ats", "crm", "data", "email"] as const) {
      for (const connector of connectorsForCategory(category)) {
        const prefix = providerToolPrefix(connector.provider!);
        const tools = ALL_TOOL_NAMES.filter((t) => t.startsWith(prefix));
        expect(tools.length, `${connector.provider} (${category})`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps tool prefixes unambiguous across providers", () => {
    const prefixes = CONNECTORS.filter((c) => c.live && c.provider).map((c) =>
      providerToolPrefix(c.provider!),
    );
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a === b) continue;
        expect(a.startsWith(b), `${b} is a prefix of ${a}`).toBe(false);
      }
    }
  });
});

describe("agent library YAMLs", () => {
  const dir = join(__dirname, "../../agents");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));

  it("every allowed tool is a known tool or a known category placeholder", () => {
    expect(files.length).toBeGreaterThan(0);
    const knownTools = new Set<string>(ALL_TOOL_NAMES);
    const knownCategories = Object.keys(CONNECTOR_CATEGORY_LABELS);
    for (const file of files) {
      const agent = load(readFileSync(join(dir, file), "utf8")) as {
        allowed_tools: string[];
      };
      for (const tool of agent.allowed_tools) {
        if (tool.startsWith(CONNECTOR_REQUIREMENT_PREFIX)) {
          expect(
            knownCategories,
            `${file}: ${tool}`,
          ).toContain(tool.slice(CONNECTOR_REQUIREMENT_PREFIX.length));
        } else {
          expect(knownTools.has(tool), `${file}: ${tool}`).toBe(true);
        }
      }
    }
  });

  it("every agent can save its result and any connector categories are valid", () => {
    const knownCategories = Object.keys(CONNECTOR_CATEGORY_LABELS);
    // Most agents deliver by saving a project document. A few deliver elsewhere
    // (e.g. the Slack reporter posts its digest to a channel) and intentionally
    // don't write a document.
    const nonDocDelivery = new Set(["slack-daily-report"]);
    for (const file of files) {
      const agent = load(readFileSync(join(dir, file), "utf8")) as {
        slug: string;
        allowed_tools: string[];
      };
      if (!nonDocDelivery.has(agent.slug)) {
        // Document-writing agents must be able to save their result; connectors
        // are optional (KB-only agents exist).
        expect(agent.allowed_tools, file).toContain("calyflow_create_document");
      }
      for (const cat of requiredConnectorCategories(agent.allowed_tools)) {
        expect(knownCategories, `${file}: ${cat}`).toContain(cat);
      }
    }
  });
});

describe("deriveAgentGraph", () => {
  const slots = [
    {
      category: "data",
      categoryLabel: "Data",
      selectedProvider: "google-sheets",
      selectedLabel: "Google Sheets",
    },
    {
      category: "email",
      categoryLabel: "Email",
      selectedProvider: null,
    },
  ];

  it("renders selected slots as inputs and the email slot as the output", () => {
    const graph = deriveAgentGraph({
      name: "Candidate Outreach From Sheet via Email",
      connectors: slots,
      model: { providerLabel: "OpenAI", modelId: "gpt-5-mini" },
    });

    const data = graph.nodes.find((n) => n.id === "itm-conn-data")!;
    expect(data).toMatchObject({
      title: "Google Sheets",
      parentId: "grp-connectors",
      brandLogos: ["google-sheets"],
    });
    // The email connector is the destination — never an input item.
    expect(graph.nodes.some((n) => n.id === "itm-conn-email")).toBe(false);
    const out = graph.nodes.find((n) => n.id === "out")!;
    expect(out).toMatchObject({ title: "Emails", icon: "email", badge: "Missing" });

    const sent = deriveAgentGraph({
      name: "Outreach",
      connectors: [
        { ...slots[1], selectedProvider: "gmail", selectedLabel: "Gmail" },
      ],
      model: null,
    });
    expect(sent.nodes.find((n) => n.id === "out")!).toMatchObject({
      title: "Emails via Gmail",
      brandLogos: ["gmail"],
    });

    // The skill node is labelled generically; the engine/output shape holds.
    expect(graph.nodes.find((n) => n.id === "skill")!.title).toBe(
      "Advanced skill",
    );
    const step = graph.nodes.find((n) => n.id === "step")!;
    expect(step.title).toBe("AI Engine");
    expect(step.icon).toBe("robot"); // the advanced-agent engine treatment
    expect(step.modelLine).toBe("OpenAI · gpt-5-mini");
    expect(graph.edges.map((e) => e.kind)).toEqual([
      "knowledge",
      "project",
      "skill",
      "output",
    ]);
    expect(graph.width).toBeGreaterThan(0);
    expect(graph.height).toBeGreaterThan(0);
  });
});
