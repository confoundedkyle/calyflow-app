"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { KB_AREAS } from "@/lib/kb-onboarding/areas";
import type { AgentChatTurn } from "@/lib/types";
import { Button } from "./ui";

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

export interface KbOnboardingConversation {
  conversationId: string;
  turns: AgentChatTurn[];
}

const ENDPOINT = "/api/knowledge/onboarding";

function toChatTurn(t: AgentChatTurn): ChatTurn {
  return {
    id: t.id,
    task: t.task ?? "",
    output: t.output_text ?? "",
    steps: (t.steps ?? [])
      .filter((s) => s.type === "tool-call" || s.type === "tool-result")
      .map((s) => ({
        kind: s.type === "tool-call" ? "tool-call" : "tool-result",
        tool: s.tool,
        summary: s.summary,
      })),
    running: false,
    error: t.error_message,
  };
}

/** "Saved company.md" reads better than the raw tool name in the trace. */
function stepLabel(step: Step): string {
  if (step.tool === "onboarding_save_kb_doc") {
    const match = step.summary.match(/"?filename"?\s*[:=]\s*"?([\w.-]+)/);
    const file = match?.[1];
    return file ? `Saved ${file}` : "Saved a document";
  }
  return step.tool;
}

export function KbOnboardingPanel({
  model,
  capturedFilenames,
  initialConversation = null,
}: {
  model: { providerLabel: string; modelId: string } | null;
  /** KB filenames that already exist — drives the progress checklist. */
  capturedFilenames: string[];
  initialConversation?: KbOnboardingConversation | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [turns, setTurns] = useState<ChatTurn[]>(
    () => initialConversation?.turns.map(toChatTurn) ?? [],
  );
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversation?.conversationId ?? null,
  );
  const [active, setActive] = useState(turns.length > 0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState("");

  const captured = new Set(capturedFilenames);
  const capturedCount = KB_AREAS.filter((a) => captured.has(a.filename)).length;

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = (behavior: ScrollBehavior = "auto") =>
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });

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
        updateLastTurn((t) => ({ ...t, error: ev.message ?? "Chat failed" }));
        break;
    }
  }

  /** Send a turn. Empty `text` is the opening turn (the assistant greets). */
  async function send(text: string) {
    if (running) return;
    setError(null);
    setActive(true);
    setTurns((prev) => [
      ...prev,
      {
        id: `pending-${prev.length}`,
        task: text,
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
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: text, conversationId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Chat failed (${response.status})`);
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
      if (resolvedConvId && resolvedConvId !== conversationId) {
        setConversationId(resolvedConvId);
        router.replace(`${pathname}?c=${resolvedConvId}`, { scroll: false });
      }
      // Reload the page so newly-saved KB documents (and the progress
      // checklist) reflect what the assistant just wrote.
      router.refresh();
    } catch (err) {
      updateLastTurn((t) => ({
        ...t,
        error: err instanceof Error ? err.message : "Chat failed",
      }));
    } finally {
      updateLastTurn((t) => ({ ...t, running: false }));
      setRunning(false);
    }
  }

  // Hero / entry state — no conversation started yet.
  if (!active) {
    return (
      <div className="rounded-card border border-mint-400/40 bg-gradient-to-br from-mint-400/10 via-white to-sky-300/10 px-6 py-10 text-center shadow-[0_1px_3px_rgba(19,31,56,0.04)]">
        <span aria-hidden className="text-3xl">
          ✨
        </span>
        <h2 className="mt-3 text-xl font-semibold text-navy-900">
          Let&apos;s set up your knowledge base
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-navy-800/60">
          Instead of filling in blank templates, I&apos;ll ask you a few quick
          questions about your company, how you recruit, and how you talk to
          candidates — and turn your answers into the documents every AI run
          reads. It only takes a few minutes, and you can stop and continue
          anytime.
        </p>
        <div className="mt-6">
          <Button onClick={() => send("")} disabled={running}>
            {running ? "Starting…" : "✨ Start creating"}
          </Button>
        </div>
        <p className="mt-4 text-xs text-navy-800/40">
          {KB_AREAS.length} areas · saved as you go · resume whenever you like
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-navy-800/12 bg-white shadow-[0_1px_3px_rgba(19,31,56,0.04)]">
      {/* Progress checklist */}
      <div className="border-b border-navy-800/8 bg-navy-800/[0.02] px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-navy-800/45">
            Setup progress
          </p>
          <p className="text-xs font-semibold text-navy-800/55">
            {capturedCount} of {KB_AREAS.length} areas
          </p>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {KB_AREAS.map((area) => {
            const done = captured.has(area.filename);
            return (
              <span
                key={area.filename}
                title={area.filename}
                className={[
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  done
                    ? "bg-mint-400/20 text-mint-700"
                    : "bg-navy-800/[0.05] text-navy-800/45",
                ].join(" ")}
              >
                <span aria-hidden>{done ? "✓" : "○"}</span>
                {area.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Conversation */}
      <div className="max-h-[34rem] space-y-5 overflow-y-auto px-5 py-5">
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-3">
            {turn.task && (
              <div className="ml-auto max-w-[85%] rounded-card bg-mint-400/12 px-4 py-2.5 text-sm leading-relaxed text-navy-800/90">
                {turn.task}
              </div>
            )}

            {turn.steps.length > 0 && (
              <ul className="space-y-1">
                {turn.steps
                  .filter((s) => s.kind === "tool-call")
                  .map((step, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 text-xs text-navy-800/50"
                    >
                      <span aria-hidden className="text-mint-700">
                        ✓
                      </span>
                      {stepLabel(step)}
                    </li>
                  ))}
              </ul>
            )}

            {turn.output && (
              <div className="prose-calyflow max-w-none rounded-card border border-navy-800/10 bg-cream-50/50 px-4 py-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {turn.output}
                </ReactMarkdown>
                {turn.running && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-mint-400 align-middle" />
                )}
              </div>
            )}

            {turn.running && !turn.output && (
              <div
                className="flex items-center gap-2 text-sm text-navy-800/55"
                role="status"
                aria-live="polite"
              >
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-mint-400/30 border-t-mint-400" />
                Working on it — this can take a moment…
              </div>
            )}

            {turn.error && (
              <p className="rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
                {turn.error}
              </p>
            )}
          </div>
        ))}
        <div ref={bottomRef} aria-hidden />
      </div>

      {/* Composer */}
      <div className="border-t border-navy-800/8 bg-cream-50/60 px-5 py-4">
        {error && (
          <p className="mb-2 rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
            {error}
          </p>
        )}
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (task.trim()) void send(task.trim());
            }
          }}
          rows={2}
          disabled={running}
          placeholder="Type your answer… (Enter to send, Shift+Enter for a new line)"
          className="block w-full resize-y rounded-card border border-navy-800/15 bg-white px-4 py-3 text-sm leading-relaxed outline-none focus:border-mint-700 placeholder:text-navy-800/35"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-navy-800/40">
            {model ? `Runs on ${model.providerLabel} · ${model.modelId}` : ""}
          </span>
          <Button
            onClick={() => task.trim() && send(task.trim())}
            disabled={running || !task.trim()}
          >
            {running ? "Working…" : "Send ▸"}
          </Button>
        </div>
      </div>
    </div>
  );
}
