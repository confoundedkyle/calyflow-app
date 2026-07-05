import { CONNECTORS, connectorLabel } from "../connectors";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function aliasesFor(provider: string, name: string): string[] {
  const aliases = new Set<string>([
    normalize(provider),
    normalize(name),
    normalize(name.replace(/\.io$/i, "")),
  ]);
  if (provider === "hunter") aliases.add("hunterio");
  if (provider === "rocketreach") aliases.add("rocket");
  return [...aliases].filter(Boolean);
}

export function buildRecruiterSteerBlock(
  task: string,
  connectedProviders: string[],
): string {
  const normalizedTask = normalize(task);
  if (!normalizedTask) return "";

  const connected = new Set(connectedProviders);
  const mentioned = CONNECTORS.filter((c) => c.provider).filter((connector) =>
    aliasesFor(connector.provider!, connector.name).some((alias) =>
      normalizedTask.includes(alias),
    ),
  );
  if (mentioned.length === 0) return "";

  const lines = [
    "# Recruiter steer interpretation",
    "Treat the recruiter's latest message as a hard constraint unless it is impossible or unsafe.",
  ];

  for (const connector of mentioned) {
    const provider = connector.provider!;
    const name = connector.name;
    if (!connected.has(provider) && !connector.builtin) {
      lines.push(
        `- The recruiter named ${name}, but it is not connected. Do NOT propose using ${name}; say it needs to be connected first or offer connected/free alternatives.`,
      );
      continue;
    }
    if (connector.peopleSearch) {
      lines.push(
        `- The recruiter named ${name}. It is an active people-search channel; make ${name} the primary channel in the proposal unless the live status/budget makes that impossible.`,
      );
      continue;
    }
    if (connector.category === "contacts") {
      lines.push(
        `- The recruiter named ${name}. ${name} is contact enrichment / email verification, not candidate discovery. Do NOT present it as a sourcing search channel. If they asked to "search with ${connectorLabel(provider)}", explain briefly that sourcing must first find candidates through search channels, then ${name} can be used later to find/verify emails for selected candidates.`,
      );
      continue;
    }
    lines.push(
      `- The recruiter named ${name}. It is connected but not a primary people-search connector; only include it if it directly supports the requested constraint, otherwise explain the limitation and use search channels for discovery.`,
    );
  }

  return lines.join("\n");
}
