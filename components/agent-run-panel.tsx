"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePersistedSelection } from "@/lib/use-persisted-selection";
import { uploadDocumentAction } from "@/lib/actions/documents";
import { connectorLabel } from "@/lib/connectors";
import { DEFAULT_EFFORT, EFFORT_LEVELS, type Effort } from "@/lib/effort";
import type { AgentChatTurn } from "@/lib/types";
import { EffortSlider } from "./effort-slider";
import { Button } from "./ui";

/** A required project document the agent needs before it can run. */
export interface AgentMissingDoc {
  docType: string;
  label: string;
}

/** A connector category an agent needs, with the workspace's connected
 *  options for it (empty = nothing of that category is connected yet). */
export interface AgentConnectorRequirement {
  category: string;
  label: string;
  options: { provider: string; label: string }[];
}

export interface AgentRunPanelAgent {
  id: string;
  name: string;
  /** Library slug — drives the "Documents" node on the canvas. */
  slug?: string;
  /** Shown under the "Advanced skill" node on the canvas. */
  description?: string;
  /** Full instructions — shown when the skill node on the canvas is opened. */
  instructions?: string;
  requirements: AgentConnectorRequirement[];
  /** Provider slugs the agent binds directly (provider-prefixed tools) — render
   *  as fixed connector nodes on the canvas. */
  boundProviders?: string[];
}

interface Step {
  kind: "tool-call" | "tool-result";
  tool: string;
  summary: string;
}

/** One turn shown in the chat: the user's message and the agent's reply. */
interface ChatTurn {
  id: string;
  task: string;
  output: string;
  steps: Step[];
  outputDocId: string | null;
  running: boolean;
  error: string | null;
}

/** The agent's saved conversation for this project, hydrated on first render. */
export interface InitialConversation {
  conversationId: string;
  turns: AgentChatTurn[];
}

/** Unique markdown-document illustration (200×250 canvas) for the saved-output
 *  card. Drawn with theme tokens so it matches the app. */
function SavedDocArtwork() {
  return (
    <svg
      viewBox="0 0 200 250"
      role="img"
      aria-label="Saved markdown document"
      className="h-36 w-auto shrink-0 drop-shadow-[0_6px_14px_rgba(19,31,56,0.12)]"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* page with a folded top-right corner */}
      <path
        d="M36 18 H138 L170 50 V232 H36 Z"
        className="fill-white stroke-navy-800/15"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M138 18 L170 50 H138 Z" className="fill-mint-400/30" />
      {/* title bar */}
      <rect x="54" y="40" width="64" height="11" rx="5.5" className="fill-mint-400" />
      {/* markdown badge */}
      <rect
        x="54"
        y="62"
        width="46"
        height="28"
        rx="6"
        className="fill-mint-700"
      />
      <text
        x="77"
        y="82"
        textAnchor="middle"
        className="fill-white"
        fontSize="15"
        fontWeight="800"
        fontFamily="ui-monospace, monospace"
      >
        ↓M
      </text>
      {/* body text lines */}
      <rect x="54" y="106" width="92" height="7" rx="3.5" className="fill-navy-800/20" />
      <rect x="54" y="122" width="76" height="7" rx="3.5" className="fill-navy-800/12" />
      <rect x="54" y="138" width="86" height="7" rx="3.5" className="fill-navy-800/12" />
      <rect x="54" y="162" width="58" height="7" rx="3.5" className="fill-navy-800/12" />
      <rect x="54" y="178" width="88" height="7" rx="3.5" className="fill-navy-800/12" />
      <rect x="54" y="194" width="70" height="7" rx="3.5" className="fill-navy-800/12" />
      {/* "done" check badge */}
      <circle
        cx="150"
        cy="198"
        r="24"
        className="fill-mint-400 stroke-white"
        strokeWidth="5"
      />
      <path
        d="M139 198 l8 8 l14 -16"
        className="stroke-white"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function SavedDocumentCard({ docId }: { docId: string }) {
  return (
    <Link
      href={`/document/${docId}`}
      className="group flex items-center gap-5 rounded-card border-[1.5px] border-mint-400/50 bg-mint-400/[0.06] p-5 transition hover:border-mint-700 hover:bg-mint-400/10"
    >
      <SavedDocArtwork />
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-mint-700">
          Saved result
        </p>
        <p className="mt-0.5 text-lg font-semibold text-navy-800">
          View the saved document{" "}
          <span className="inline-block transition-transform group-hover:translate-x-1">
            →
          </span>
        </p>
        <p className="mt-1 text-sm text-navy-800/55">
          The agent wrote its output to your project files — open it to read,
          share, or download.
        </p>
      </div>
    </Link>
  );
}

function toChatTurn(t: AgentChatTurn): ChatTurn {
  return {
    id: t.id,
    task: t.task ?? "",
    output: t.output_text ?? "",
    steps: (t.steps ?? []).map((s) => ({
      kind: s.type === "tool-call" ? "tool-call" : "tool-result",
      tool: s.tool,
      summary: s.summary,
    })),
    outputDocId: t.output_doc_id,
    running: false,
    error: t.error_message,
  };
}

/** A file attached for this run only — its extracted text is sent with the run
 *  and never saved as a project document. */
interface RunAttachment {
  name: string;
  text: string;
}

const ATTACH_ACCEPT = ".pdf,.docx,.txt,.md";
const ATTACH_MAX_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

const TOOL_LABELS: Record<string, string> = {
  calyflow_search_documents: "Searched knowledge base",
  calyflow_read_document: "Read document",
  calyflow_create_document: "Saved document",
  calyflow_log_sourcing_progress: "Logged sourcing progress",
  gmail_send_email: "Sent email (Gmail)",
  outlook_send_email: "Sent email (Outlook)",
};

/** "greenhouse_list_jobs" → "greenhouse · list jobs" for unmapped tools. */
function toolLabel(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool];
  const [prefix, ...rest] = tool.split("_");
  return rest.length ? `${prefix} · ${rest.join(" ")}` : tool;
}

function defaultChoices(agent: AgentRunPanelAgent | undefined) {
  const choices: Record<string, string> = {};
  for (const req of agent?.requirements ?? []) {
    if (req.options[0]) choices[req.category] = req.options[0].provider;
  }
  return choices;
}

export function AgentRunPanel({
  projectId,
  agents,
  model,
  connectorsHref,
  documentsHref,
  missingDocs = [],
  archived,
  initialConversation = null,
  workspaceKbAvailable = false,
  clientKbAvailable = false,
  connectedProviders = [],
  workspaceKbHref = "/knowledge",
  clientKbHref,
  skillHref,
  aiProviderHref = "/settings/providers",
}: {
  projectId: string;
  agents: AgentRunPanelAgent[];
  model: { providerLabel: string; modelId: string } | null;
  connectorsHref: string;
  /** Project Documents tab — where to add the required docs. */
  documentsHref?: string;
  /** Required project documents that are not present yet — blocks the run. */
  missingDocs?: AgentMissingDoc[];
  archived: boolean;
  /** The agent's most recent saved chat for this project, resumed on load. */
  initialConversation?: InitialConversation | null;
  /** Whether the agency / client knowledge bases have any content (drives the
   *  amber "empty" badge). */
  workspaceKbAvailable?: boolean;
  clientKbAvailable?: boolean;
  /** Provider slugs the workspace has connected — to mark bound connectors. */
  connectedProviders?: string[];
  /** Where each badge links so the user can adjust it. */
  workspaceKbHref?: string;
  clientKbHref?: string;
  /** The agent's edit page (update its skill/instructions). */
  skillHref?: string;
  aiProviderHref?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Remember the last agent this project ran, so switching tabs/pages doesn't
  // snap the picker back to the first one.
  const [agentId, setAgentId] = usePersistedSelection(
    `calyflow:run-panel:agent:${projectId}`,
    agents[0]?.id ?? "",
    (id) => agents.some((a) => a.id === id),
  );
  // Per-agent connector picks, lazily defaulted — switching agents restores
  // that agent's previous picks instead of resetting them in an effect.
  const [choicesByAgent, setChoicesByAgent] = useState<
    Record<string, Record<string, string>>
  >({});
  const [task, setTask] = useState("");
  // How hard the agent works this run (tool-call budget + research depth).
  // Persisted per project, like the agent and connector picks.
  const [effort, setEffort] = usePersistedSelection(
    `calyflow:run-panel:effort:${projectId}`,
    DEFAULT_EFFORT,
    (v) => EFFORT_LEVELS.some((l) => l.value === v),
  );
  const [turns, setTurns] = useState<ChatTurn[]>(
    () => initialConversation?.turns.map(toChatTurn) ?? [],
  );
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversation?.conversationId ?? null,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mutate the in-flight (last) turn as stream events arrive.
  const updateLastTurn = (patch: (t: ChatTurn) => ChatTurn) =>
    setTurns((prev) =>
      prev.map((t, i) => (i === prev.length - 1 ? patch(t) : t)),
    );
  // Sentinel at the end of the chat; scrolling it into view scrolls the whole
  // page (not just an inner box) so a new/streaming turn is always visible.
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = (behavior: ScrollBehavior = "auto") =>
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });

  // Reflect the active conversation in the URL (?c=<id>) via the router so a
  // reload, bookmark, or shared link reopens the same chat (and Next keeps the
  // change instead of a router.refresh() reverting it).
  const syncConversationUrl = (cid: string | null) => {
    router.replace(cid ? `${pathname}?c=${cid}` : pathname, { scroll: false });
  };

  // On open, canonicalize the URL to the loaded conversation (?c=<id>) so the
  // address is stable to copy/share — not "whatever was most recent".
  useEffect(() => {
    if (
      conversationId &&
      typeof window !== "undefined" &&
      !new URLSearchParams(window.location.search).has("c")
    ) {
      syncConversationUrl(conversationId);
    }
    // run once on mount for the initially-loaded conversation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadDocType, setUploadDocType] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Files attached for this run only (not saved to the project).
  const attachRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<RunAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function addAttachments(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} files per run.`);
      return;
    }
    setAttaching(true);
    try {
      for (const file of Array.from(list).slice(0, room)) {
        if (file.size > ATTACH_MAX_BYTES) {
          setError(`${file.name} is over the 20 MB limit.`);
          continue;
        }
        const fd = new FormData();
        fd.set("file", file);
        const res = await fetch("/api/agents/extract", {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? `Couldn't attach ${file.name}`);
          continue;
        }
        setAttachments((prev) => [...prev, { name: data.name, text: data.text }]);
      }
    } finally {
      setAttaching(false);
      if (attachRef.current) attachRef.current.value = "";
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadRequiredDoc(file: File, docType: string) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("scopeType", "project");
      fd.set("scopeId", projectId);
      fd.set("kind", "file");
      fd.set("docType", docType);
      await uploadDocumentAction(fd);
      router.refresh(); // server recomputes missingDocs → the gate clears
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload the file");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const agent = useMemo(
    () => agents.find((a) => a.id === agentId),
    [agents, agentId],
  );
  const choices = choicesByAgent[agentId] ?? defaultChoices(agent);
  const setChoice = (category: string, provider: string) =>
    setChoicesByAgent((prev) => ({
      ...prev,
      [agentId]: { ...(prev[agentId] ?? defaultChoices(agent)), [category]: provider },
    }));

  const missingCategories = (agent?.requirements ?? []).filter(
    (req) => req.options.length === 0,
  );
  // Provider-bound connectors the agent needs (e.g. GitHub) that aren't
  // connected — block the run just like a missing category connector.
  const missingProviders = (agent?.boundProviders ?? []).filter(
    (p) => !connectedProviders.includes(p),
  );
  // A missing required connector is a hard external blocker → render the
  // readiness box (and its connector items) in red, not amber.
  const connectorBlocked =
    missingCategories.length > 0 || missingProviders.length > 0;
  const blocked = connectorBlocked || missingDocs.length > 0;
  const ready = !blocked;

  // Compact "what's involved" badges that replace the canvas: a dot per piece,
  // green = ready, amber = optional-but-missing, red = required-but-missing.
  const badges = useMemo<
    {
      label: string;
      status: "ok" | "warn" | "missing";
      hint: string;
      href?: string;
    }[]
  >(() => {
    if (!agent) return [];
    const items: {
      label: string;
      status: "ok" | "warn" | "missing";
      hint: string;
      href?: string;
    }[] = [
      {
        label: "Knowledge base",
        status: workspaceKbAvailable ? "ok" : "warn",
        hint: workspaceKbAvailable
          ? "Your agency knowledge base has content. Click to manage it."
          : "Your agency knowledge base is empty — click to add content.",
        href: workspaceKbHref,
      },
      {
        label: "Client knowledge",
        status: clientKbAvailable ? "ok" : "warn",
        hint: clientKbAvailable
          ? "This client's knowledge base has content. Click to manage it."
          : "This client has no knowledge yet — click to add some.",
        href: clientKbHref,
      },
    ];
    // Category connectors the user picks (connected = at least one option).
    for (const req of agent.requirements) {
      const connected = req.options.length > 0;
      items.push({
        label: `${req.label} connector`,
        status: connected ? "ok" : "missing",
        hint: connected
          ? `${req.label} connector is connected. Click to manage connectors.`
          : `Connect ${/^[aeio]/i.test(req.label) ? "an" : "a"} ${req.label} connector — click to open Connectors.`,
        href: `${connectorsHref}?category=${req.category}`,
      });
    }
    // Provider-bound connectors (e.g. GitHub) — required for this agent.
    for (const provider of agent.boundProviders ?? []) {
      const connected = connectedProviders.includes(provider);
      const name = connectorLabel(provider);
      items.push({
        label: `${name} connector`,
        status: connected ? "ok" : "missing",
        hint: connected
          ? `${name} is connected. Click to manage connectors.`
          : `Connect ${name} — click to open Connectors.`,
        href: connectorsHref,
      });
    }
    items.push({
      label: "Skill",
      status: "ok",
      hint: "The agent's instructions that drive the run. Click to edit them.",
      href: skillHref,
    });
    items.push({
      label: "AI Engine",
      status: model ? "ok" : "missing",
      hint: model
        ? `Runs on ${model.providerLabel} · ${model.modelId}. Click to manage providers.`
        : "No run model is configured — click to add an AI provider.",
      href: aiProviderHref,
    });
    return items;
  }, [
    agent,
    workspaceKbAvailable,
    clientKbAvailable,
    connectedProviders,
    model,
    connectorsHref,
    workspaceKbHref,
    clientKbHref,
    skillHref,
    aiProviderHref,
  ]);

  function startNewChat() {
    if (running) return;
    setTurns([]);
    setConversationId(null);
    setError(null);
    setTask("");
    setAttachments([]);
    syncConversationUrl(null);
  }

  async function send() {
    if (!agent || running || !ready) return;
    const sentTask = task.trim();
    if (turns.length > 0 && !sentTask) return; // follow-ups need a message
    setError(null);
    // Append the new turn and clear the composer.
    setTurns((prev) => [
      ...prev,
      {
        id: `pending-${prev.length}`,
        task: sentTask,
        output: "",
        steps: [],
        outputDocId: null,
        running: true,
        error: null,
      },
    ]);
    const sentAttachments = attachments;
    setTask("");
    setAttachments([]);
    setRunning(true);
    // Reveal the new (running) turn once it's painted.
    requestAnimationFrame(() => scrollToBottom("smooth"));
    try {
      const response = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          agentId: agent.id,
          task: sentTask,
          conversationId,
          connectors: choices,
          attachments: sentAttachments,
          effort,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Run failed (${response.status})`);
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let resolvedConvId = conversationId;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "done" && ev.conversationId)
            resolvedConvId = ev.conversationId;
          handleEvent(ev);
        }
        scrollToBottom();
      }
      // A brand-new chat just got its id → put it in the URL (router.replace also
      // refetches). Continuing an existing chat → refresh to update stats/runs.
      if (resolvedConvId && resolvedConvId !== conversationId) {
        setConversationId(resolvedConvId);
        syncConversationUrl(resolvedConvId);
      } else {
        router.refresh();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Run failed";
      updateLastTurn((t) => ({ ...t, error: message }));
    } finally {
      updateLastTurn((t) => ({ ...t, running: false }));
      setRunning(false);
    }
  }

  function handleEvent(ev: {
    type: string;
    value?: string;
    tool?: string;
    summary?: string;
    message?: string;
    conversationId?: string;
    outputDocId?: string | null;
  }) {
    switch (ev.type) {
      case "text":
        updateLastTurn((t) => ({ ...t, output: t.output + (ev.value ?? "") }));
        break;
      case "tool-call":
        updateLastTurn((t) => ({
          ...t,
          steps: [
            ...t.steps,
            { kind: "tool-call", tool: ev.tool!, summary: ev.summary ?? "" },
          ],
        }));
        break;
      case "tool-result":
        updateLastTurn((t) => ({
          ...t,
          steps: [
            ...t.steps,
            { kind: "tool-result", tool: ev.tool!, summary: ev.summary ?? "" },
          ],
        }));
        break;
      case "error":
        updateLastTurn((t) => ({
          ...t,
          error: ev.message ?? "Agent run failed",
        }));
        break;
      case "done":
        if (ev.outputDocId)
          updateLastTurn((t) => ({ ...t, outputDocId: ev.outputDocId ?? null }));
        break;
    }
  }

  if (agents.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        {/* The selector only matters when several agents share a panel; on the
            per-agent page there's a single agent named in the heading. */}
        {agents.length > 1 && (
          <label className="block min-w-56 max-w-xs">
            <span className="mb-1.5 block text-sm font-semibold text-navy-800/80">
              Agent
            </span>
            <select
              value={agentId}
              disabled={running}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full rounded-chip border border-navy-800/20 bg-white px-3.5 py-2.5 outline-none focus:border-mint-700"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {(agent?.requirements ?? [])
          .filter((req) => req.options.length > 0)
          .map((req) => (
            <label key={req.category} className="block min-w-44 max-w-xs">
              <span className="mb-1.5 block text-sm font-semibold text-navy-800/80">
                {req.label} connector
              </span>
              <select
                value={choices[req.category] ?? ""}
                disabled={running}
                onChange={(e) => setChoice(req.category, e.target.value)}
                className="w-full rounded-chip border border-navy-800/20 bg-white px-3.5 py-2.5 outline-none focus:border-mint-700"
              >
                {req.options.map((o) => (
                  <option key={o.provider} value={o.provider}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
      </div>

      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-navy-800/10 pb-4">
          {badges.map((b) => {
            const dot = (
              <span
                aria-hidden
                className={`inline-block h-2 w-2 rounded-full ${
                  b.status === "ok"
                    ? "bg-mint-400"
                    : b.status === "warn"
                      ? "bg-amber-400"
                      : "bg-coral-400"
                }`}
              />
            );
            return b.href ? (
              <Link
                key={b.label}
                href={b.href}
                title={b.hint}
                className="inline-flex items-center gap-1.5 text-sm text-navy-800/70 underline-offset-2 transition hover:text-navy-900 hover:underline"
              >
                {dot}
                {b.label}
              </Link>
            ) : (
              <span
                key={b.label}
                title={b.hint}
                className="inline-flex items-center gap-1.5 text-sm text-navy-800/70"
              >
                {dot}
                {b.label}
              </span>
            );
          })}
        </div>
      )}

      <EffortSlider
        value={effort as Effort}
        onChange={setEffort}
        disabled={running}
      />

      {blocked && (
        <div
          className={`mt-4 rounded-card border px-4 py-3 ${
            connectorBlocked
              ? "border-coral-400/40 bg-coral-400/8"
              : "border-amber-400/30 bg-amber-400/8"
          }`}
        >
          <p className="text-sm font-semibold text-navy-800/70">
            Before you can run this agent:
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {missingDocs.map((doc) => (
              <li
                key={doc.docType}
                className="flex items-center justify-between gap-3 text-sm text-navy-800/80"
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden className="text-amber-400">
                    ☐
                  </span>
                  Add the {doc.label}
                  <span className="rounded-full bg-amber-400/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-400">
                    Required
                  </span>
                </span>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    setUploadDocType(doc.docType);
                    fileRef.current?.click();
                  }}
                  className="shrink-0 rounded-chip border border-navy-800/20 px-2.5 py-1 text-xs font-semibold text-navy-800/70 transition hover:border-mint-700 hover:text-mint-700 disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
              </li>
            ))}
            {missingCategories.map((req) => (
              <li
                key={req.category}
                className="flex items-center gap-2 text-sm text-navy-800/80"
              >
                <span aria-hidden className="text-coral-400">
                  ☐
                </span>
                <Link
                  href={`${connectorsHref}?category=${req.category}`}
                  className="font-semibold text-mint-700 hover:underline"
                >
                  Connect {/^[aeio]/i.test(req.label) ? "an" : "a"} {req.label}{" "}
                  connector
                </Link>
                <span className="rounded-full bg-coral-400/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-coral-400">
                  Required
                </span>
              </li>
            ))}
            {missingProviders.map((provider) => (
              <li
                key={provider}
                className="flex items-center gap-2 text-sm text-navy-800/80"
              >
                <span aria-hidden className="text-coral-400">
                  ☐
                </span>
                <Link
                  href={connectorsHref}
                  className="font-semibold text-mint-700 hover:underline"
                >
                  Connect {connectorLabel(provider)}
                </Link>
                <span className="rounded-full bg-coral-400/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-coral-400">
                  Required
                </span>
              </li>
            ))}
          </ul>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && uploadDocType) void uploadRequiredDoc(f, uploadDocType);
            }}
          />
          {missingDocs.length > 0 && documentsHref && (
            <Link
              href={documentsHref}
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-mint-700 hover:underline"
            >
              Manage documents in the Documents tab →
            </Link>
          )}
        </div>
      )}

      {/* Conversation — the turns so far, oldest first, above the composer. */}
      {turns.length > 0 && (
        <div className="mt-5 space-y-6">
          {turns.map((turn) => (
            <div key={turn.id} className="space-y-3">
              {turn.task && (
                <div className="ml-auto max-w-[85%] rounded-card bg-mint-400/12 px-4 py-2.5 text-sm leading-relaxed text-navy-800/90">
                  {turn.task}
                </div>
              )}

              {(turn.steps.length > 0 || turn.running) && (
                <div className="rounded-card border border-navy-800/12 bg-cream-100/60 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-800/40">
                    What the agent did
                  </p>
                  <ol className="space-y-1.5">
                    {turn.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span aria-hidden className="mt-0.5 shrink-0">
                          {step.kind === "tool-call" ? "▸" : "✓"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-navy-800/80">
                            {toolLabel(step.tool)}
                          </span>
                          <span
                            className="block truncate text-xs text-navy-800/45"
                            title={step.summary}
                          >
                            {step.summary}
                          </span>
                        </span>
                      </li>
                    ))}
                    {turn.running && (
                      <li className="flex items-center gap-2 text-sm text-navy-800/45">
                        <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-mint-400" />
                        Thinking…
                      </li>
                    )}
                  </ol>
                </div>
              )}

              {(turn.output || turn.running) && (
                <div className="prose-calyflow rounded-card border border-navy-800/12 bg-white p-6">
                  {turn.running && !turn.output && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex items-center gap-2.5 text-sm font-medium text-navy-800/55"
                    >
                      <span
                        aria-hidden
                        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-mint-400/30 border-t-mint-400"
                      />
                      Working on it — this can take a moment…
                    </div>
                  )}
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {turn.output}
                  </ReactMarkdown>
                  {turn.running && turn.output && (
                    <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-mint-400 align-text-bottom" />
                  )}
                </div>
              )}

              {turn.error && (
                <p className="rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
                  {turn.error}
                </p>
              )}

              {turn.outputDocId && !turn.running && (
                <SavedDocumentCard docId={turn.outputDocId} />
              )}
            </div>
          ))}
        </div>
      )}

      {archived && (
        <p className="mt-3 text-sm font-medium text-amber-400">
          This project is archived.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
          {error}
        </p>
      )}

      {/* Composer — sticks to the bottom of the viewport so it's always
          reachable without scrolling through a long conversation. The white
          backing matches the card so it blends, and masks scrolled content. */}
      <div className="sticky bottom-0 z-10 mt-4 bg-white pt-2 shadow-[0_-10px_24px_-6px_rgba(255,255,255,0.95)]">
      <div className="rounded-panel border border-mint-400/40 bg-mint-400/8 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-mint-700">
            {turns.length > 0 ? "Continue the chat" : "Your task for this run"}
          </p>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={startNewChat}
              disabled={running}
              className="rounded-chip px-2 py-1 text-xs font-semibold text-navy-800/55 transition hover:bg-cream-100 hover:text-navy-800 disabled:opacity-50"
            >
              ＋ New chat
            </button>
          )}
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!running) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!running) void addAttachments(e.dataTransfer.files);
          }}
          className={`relative rounded-card border-[1.5px] bg-white shadow-[0_4px_18px_rgba(19,31,56,0.07)] transition focus-within:border-mint-700 ${
            dragOver
              ? "border-dashed border-mint-700 ring-2 ring-mint-400/40"
              : "border-navy-800/15"
          }`}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-card bg-mint-400/12 backdrop-blur-[1px]">
              <span aria-hidden className="text-2xl">
                📎
              </span>
              <span className="text-sm font-semibold text-mint-700">
                Drop files to attach for this run
              </span>
            </div>
          )}
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={3}
            disabled={running}
            placeholder={
              turns.length > 0
                ? "Send a follow-up…"
                : "Add clarifying information, or leave blank to run the agent's standard task."
            }
            className="block w-full resize-y border-0 bg-transparent px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-navy-800/35"
          />
          {attachments.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 border-t border-navy-800/8 px-3 py-2.5">
              {attachments.map((a, i) => (
                <li
                  key={`${a.name}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-chip bg-cream-100 px-2 py-1 text-xs font-medium text-navy-800/70"
                >
                  <span aria-hidden>📄</span>
                  <span className="max-w-44 truncate" title={a.name}>
                    {a.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    disabled={running}
                    aria-label={`Remove ${a.name}`}
                    className="text-navy-800/40 transition hover:text-coral-400 disabled:opacity-50"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-navy-800/8 px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-chip px-2 py-1.5 text-sm font-semibold text-navy-800/55 transition hover:bg-cream-100 hover:text-navy-800">
              <input
                ref={attachRef}
                type="file"
                multiple
                accept={ATTACH_ACCEPT}
                className="sr-only"
                disabled={running || attaching}
                onChange={(e) => void addAttachments(e.target.files)}
              />
              <span aria-hidden>📎</span>
              {attaching ? "Attaching…" : "Attach files"}
              <span className="font-normal text-navy-800/35">
                or drag &amp; drop
              </span>
            </label>
            <Button
              onClick={send}
              disabled={
                running ||
                archived ||
                !ready ||
                (turns.length > 0 && !task.trim())
              }
            >
              {running
                ? "Running…"
                : turns.length > 0
                  ? "Send ▸"
                  : "▶ Run agent"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-navy-800/40">
          Attached files (PDF, DOCX, TXT, MD · 20 MB) are used for this run only
          and aren&apos;t saved. To keep a file, add it in the Documents tab.
        </p>
      </div>
      </div>
      <div ref={bottomRef} aria-hidden />
    </div>
  );
}
