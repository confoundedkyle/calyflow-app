"use client";

import {
  DocAgentPanel,
  type DocAgentConfig,
  type DocAgentConversation,
} from "./doc-agent-panel";

export type SourcingPlanConversation = DocAgentConversation;

interface PlanDoc {
  id: string;
  filename: string;
  text: string;
  createdAt: string;
}

const SOURCING_PLAN_CONFIG: DocAgentConfig = {
  endpoint: "/api/sourcing-plan/generate",
  storageKey: "calyflow:sourcing-plan:effort",
  heading: "Sourcing Plan",
  description:
    "Plan mode for this role. The agent researches what exists, the channels " +
    "and communities, target companies and alternative titles — then drafts a " +
    "plan you review and edit. Grounded in your active connectors, the JD, and " +
    "what worked before.",
  leftHeading: "The plan",
  docNoun: "plan",
  emptyText:
    "No sourcing plan yet. Generate one to get a researched, phased plan you " +
    "can edit and refine.",
  generateLabel: "✨ Generate plan",
  doneNew: "Drafted the plan — see it on the left.",
  doneRevise: "Updated the plan — see it on the left.",
  askPlaceholder:
    "e.g. Add two niche communities for this market and drop the generic job boards.",
};

export function SourcingPlanPanel({
  projectId,
  plan,
  hasJd,
  archived,
  model,
  documentsHref,
  initialConversation = null,
}: {
  projectId: string;
  plan: PlanDoc | null;
  hasJd: boolean;
  archived: boolean;
  model: { providerLabel: string; modelId: string } | null;
  documentsHref: string;
  initialConversation?: SourcingPlanConversation | null;
}) {
  return (
    <DocAgentPanel
      config={SOURCING_PLAN_CONFIG}
      projectId={projectId}
      doc={plan}
      hasJd={hasJd}
      archived={archived}
      model={model}
      documentsHref={documentsHref}
      initialConversation={initialConversation}
    />
  );
}
