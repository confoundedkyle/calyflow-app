"use client";

import {
  DocAgentPanel,
  type DocAgentConfig,
  type DocAgentConversation,
} from "./doc-agent-panel";

export type QualificationConversation = DocAgentConversation;

interface CriteriaDoc {
  id: string;
  filename: string;
  text: string;
  createdAt: string;
}

const QUALIFICATION_CONFIG: DocAgentConfig = {
  endpoint: "/api/qualification/generate",
  storageKey: "calyflow:qualification:effort",
  heading: "Qualification",
  description:
    "Define how candidates are judged — clear, testable criteria (like test " +
    "cases) the sourcing agent scores every candidate against, 0–100. Built " +
    "from the JD and intake notes; edit it directly or refine it with the agent.",
  leftHeading: "The criteria",
  docNoun: "criteria",
  emptyText:
    "No qualification criteria yet. Generate a scoring rubric the sourcing " +
    "agent will use to rank candidates 0–100.",
  generateLabel: "✨ Generate criteria",
  doneNew: "Drafted the criteria — see them on the left.",
  doneRevise: "Updated the criteria — see them on the left.",
  askPlaceholder:
    "e.g. Weight hands-on Kubernetes experience higher and add a knock-out for no payments background.",
};

export function QualificationPanel({
  projectId,
  criteria,
  hasJd,
  archived,
  model,
  documentsHref,
  initialConversation = null,
}: {
  projectId: string;
  criteria: CriteriaDoc | null;
  hasJd: boolean;
  archived: boolean;
  model: { providerLabel: string; modelId: string } | null;
  documentsHref: string;
  initialConversation?: QualificationConversation | null;
}) {
  return (
    <DocAgentPanel
      config={QUALIFICATION_CONFIG}
      projectId={projectId}
      doc={criteria}
      hasJd={hasJd}
      archived={archived}
      model={model}
      documentsHref={documentsHref}
      initialConversation={initialConversation}
    />
  );
}
