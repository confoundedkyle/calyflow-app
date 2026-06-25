"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePersistedSelection } from "@/lib/use-persisted-selection";
import { updateDocumentTextAction } from "@/lib/actions/documents";
import { DEFAULT_EFFORT, EFFORT_LEVELS, type Effort } from "@/lib/effort";
import type { AgentChatTurn } from "@/lib/types";
import { EffortSlider } from "./effort-slider";
import { Button } from "./ui";
import { Toast } from "./toast";

interface Step {
  kind: "tool-call" | "tool-result";
  tool: string;
  summary: string;
}

interface ChatTurn {
  id: string;
  task: string;
  output: string;
  steps: Step[];
  running: boolean;
  error: string | null;
}

export interface DocAgentConversation {
  conversationId: string;
  turns: AgentChatTurn[];
}

interface DocFile {
  id: string;
  filename: string;
  text: string;
  createdAt: string;
}

/** Copy + endpoint that distinguishes one two-column doc+agent page from another
 *  (Sourcing Plan vs Qualification). The layout and behaviour are identical. */
export interface DocAgentConfig {
  /** API route that streams NDJSON (generate/revise). */
  endpoint: string;
  /** localStorage key prefix for the persisted effort selection. */
  storageKey: string;
  heading: string;
  description: string;
  /** Heading over the left (document) column, e.g. "The plan". */
  leftHeading: string;
  /** Word for the document, e.g. "plan" / "criteria". */
  docNoun: string;
  /** Empty-state body copy. */
  emptyText: string;
  /** Generate-button label, e.g. "✨ Generate plan". */
  generateLabel: string;
  /** Done-confirmation lines shown in the chat after a run. */
  doneNew: string;
  doneRevise: string;
  /** Placeholder for the revision composer. */
  askPlaceholder: string;
}

const TOOL_LABELS: Record<string, string> = {
  calyflow_search_documents: "Searched knowledge base",
  calyflow_read_document: "Read document",
  web_search: "Searched the web",
  web_scrape: "Read a web page",
};

function toolLabel(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool];
  const [prefix, ...rest] = tool.split("_");
  return rest.length ? `${prefix} · ${rest.join(" ")}` : tool;
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
    running: false,
    error: t.error_message,
  };
}

export function DocAgentPanel({
  config,
  projectId,
  doc,
  hasJd,
  archived,
  model,
  documentsHref,
  initialConversation = null,
}: {
  config: DocAgentConfig;
  projectId: string;
  doc: DocFile | null;
  hasJd: boolean;
  archived: boolean;
  model: { providerLabel: string; modelId: string } | null;
  documentsHref: string;
  initialConversation?: DocAgentConversation | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [effort, setEffort] = usePersistedSelection(
    `${config.storageKey}:${projectId}`,
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
  const [task, setTask] = useState("");

  // Inline editor state. Re-initialise the draft when a different doc loads.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc?.text ?? "");
  const [seenDocId, setSeenDocId] = useState(doc?.id ?? null);
  if ((doc?.id ?? null) !== seenDocId) {
    setSeenDocId(doc?.id ?? null);
    if (!editing) setDraft(doc?.text ?? "");
  }
  const [pending, startTransition] = useTransition();
  const [toastKey, setToastKey] = useState(0);
  const [toastMsg, setToastMsg] = useState("Saved");
  function showToast(msg: string) {
    setToastMsg(msg);
    setToastKey((k) => k + 1);
  }

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = (behavior: ScrollBehavior = "auto") =>
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });

  const syncConversationUrl = (cid: string | null) =>
    router.replace(cid ? `${pathname}?c=${cid}` : pathname, { scroll: false });

  const updateLastTurn = (patch: (t: ChatTurn) => ChatTurn) =>
    setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? patch(t) : t)));

  function handleEvent(ev: {
    type: string;
    value?: string;
    tool?: string;
    summary?: string;
    message?: string;
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
        updateLastTurn((t) => ({ ...t, error: ev.message ?? "Run failed" }));
        break;
    }
  }

  async function run(kind: "generate" | "revise") {
    if (running || archived) return;
    const revising = kind === "revise";
    const sentTask = task.trim();
    if (revising && !sentTask) return;

    setError(null);
    const useConversationId = revising ? conversationId : null;
    if (!revising) {
      setTurns([]);
      setConversationId(null);
    }
    setTurns((prev) => [
      ...prev,
      {
        id: `pending-${prev.length}`,
        task: revising ? sentTask : "",
        output: "",
        steps: [],
        running: true,
        error: null,
      },
    ]);
    setTask("");
    setRunning(true);
    requestAnimationFrame(() => scrollToBottom("smooth"));

    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          task: revising ? sentTask : "",
          conversationId: useConversationId,
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
      let resolvedConvId = useConversationId;
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
      if (resolvedConvId && resolvedConvId !== conversationId) {
        setConversationId(resolvedConvId);
        syncConversationUrl(resolvedConvId);
      }
      router.refresh();
    } catch (err) {
      updateLastTurn((t) => ({
        ...t,
        error: err instanceof Error ? err.message : "Run failed",
      }));
    } finally {
      updateLastTurn((t) => ({ ...t, running: false }));
      setRunning(false);
    }
  }

  function saveDoc() {
    if (!doc) return;
    startTransition(async () => {
      try {
        setError(null);
        await updateDocumentTextAction(doc.id, draft);
        setEditing(false);
        showToast(`${config.docNoun[0].toUpperCase()}${config.docNoun.slice(1)} saved`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save");
      }
    });
  }

  return (
    <div>
      {toastKey > 0 && <Toast key={toastKey} message={toastMsg} />}

      <div className="mb-4">
        <h2 className="text-lg font-semibold">{config.heading}</h2>
        <p className="mt-0.5 text-sm text-navy-800/55">{config.description}</p>
      </div>

      {!hasJd && (
        <div className="mb-4 rounded-card border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-sm text-navy-800/80">
          No active job description in this project yet. Add a JD in the{" "}
          <Link href={documentsHref} className="font-semibold text-mint-700 hover:underline">
            Documents tab
          </Link>{" "}
          first — the {config.docNoun} is built from it.
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: the document (preview + inline editor) */}
        <section className="min-w-0">
          <div className="flex items-center justify-between gap-3 border-b border-navy-800/10 pb-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-navy-800/45">
              {config.leftHeading}
            </h3>
            {doc && !editing && (
              <Button
                variant="smallSecondary"
                onClick={() => {
                  setDraft(doc.text);
                  setEditing(true);
                }}
              >
                ✎ Edit
              </Button>
            )}
            {doc && editing && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={pending}
                  className="rounded-chip px-3 py-1.5 text-sm font-medium text-navy-800/55 transition hover:text-navy-900"
                >
                  Cancel
                </button>
                <Button variant="small" onClick={saveDoc} disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </div>

          {!doc ? (
            <div className="mt-4 rounded-card border border-dashed border-navy-800/15 px-6 py-12 text-center">
              <p className="text-sm text-navy-800/55">{config.emptyText}</p>
              <div className="mt-4">
                <Button onClick={() => run("generate")} disabled={running || archived}>
                  {running ? "Generating…" : config.generateLabel}
                </Button>
              </div>
            </div>
          ) : editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={28}
              autoFocus
              className="mt-3 block w-full resize-y rounded-card border border-navy-800/15 bg-white px-4 py-3 font-mono text-[13px] leading-relaxed outline-none focus:border-mint-700"
            />
          ) : (
            <div className="prose-calyflow mt-3 max-h-[40rem] overflow-y-auto rounded-card border border-navy-800/12 bg-white p-6">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.text}</ReactMarkdown>
            </div>
          )}
        </section>

        {/* Right: generate / regenerate + revision chat */}
        <section className="min-w-0">
          <div className="flex items-center justify-between gap-3 border-b border-navy-800/10 pb-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-navy-800/45">
              {doc ? "Refine with the agent" : "Generate"}
            </h3>
            {doc && (
              <Button
                variant="smallSecondary"
                onClick={() => run("generate")}
                disabled={running || archived}
              >
                ↻ Regenerate
              </Button>
            )}
          </div>

          <div className="mt-3">
            <EffortSlider
              value={effort as Effort}
              onChange={setEffort}
              disabled={running}
            />
          </div>

          {turns.length > 0 && (
            <div className="mt-4 space-y-5">
              {turns.map((turn) => (
                <div key={turn.id} className="space-y-3">
                  {turn.task && (
                    <div className="ml-auto max-w-[85%] rounded-card bg-mint-400/12 px-4 py-2.5 text-sm leading-relaxed text-navy-800/90">
                      {turn.task}
                    </div>
                  )}

                  {turn.running ? (
                    <>
                      <div className="rounded-card border border-navy-800/12 bg-cream-100/60 p-4">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-800/40">
                          What the agent is doing
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
                          <li className="flex items-center gap-2 text-sm text-navy-800/45">
                            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-mint-400" />
                            Researching…
                          </li>
                        </ol>
                      </div>
                      {turn.output && (
                        <div className="prose-calyflow max-h-[24rem] overflow-y-auto rounded-card border border-navy-800/12 bg-white p-5">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {turn.output}
                          </ReactMarkdown>
                        </div>
                      )}
                    </>
                  ) : turn.error ? (
                    <p className="rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
                      {turn.error}
                    </p>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-navy-800/55">
                      <span aria-hidden className="text-mint-700">
                        ✓
                      </span>
                      {turn.task ? config.doneRevise : config.doneNew}
                    </p>
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

          <div className="sticky bottom-0 z-10 mt-4 bg-cream-50/95 pt-3 backdrop-blur-sm">
            <div className="rounded-panel border border-mint-400/40 bg-mint-400/8 p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-mint-700">
                {doc ? "Ask for a change" : "Generate the first draft"}
              </p>
              {doc ? (
                <>
                  <textarea
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void run("revise");
                      }
                    }}
                    rows={3}
                    disabled={running || archived}
                    placeholder={config.askPlaceholder}
                    className="block w-full resize-y rounded-card border border-navy-800/15 bg-white px-4 py-3 text-sm leading-relaxed outline-none focus:border-mint-700 placeholder:text-navy-800/35"
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-[11px] text-navy-800/40">
                      {model
                        ? `Runs on ${model.providerLabel} · ${model.modelId}`
                        : ""}
                    </span>
                    <Button
                      onClick={() => run("revise")}
                      disabled={running || archived || !task.trim()}
                    >
                      {running ? "Working…" : "Send ▸"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-navy-800/60">
                    Generate a researched {config.docNoun}, then refine it here or
                    edit it directly on the left.
                  </p>
                  <Button onClick={() => run("generate")} disabled={running || archived}>
                    {running ? "Generating…" : "✨ Generate"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
      <div ref={bottomRef} aria-hidden />
    </div>
  );
}
