"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getDocumentTextAction,
  setDocumentActiveAction,
  uploadDocumentAction,
  uploadInputForRunAction,
} from "@/lib/actions/documents";
import type { WorkflowGraph } from "@/lib/workflow-graph";
import { DownloadButtons } from "@/components/download-buttons";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import { Button, ButtonLink } from "@/components/ui";

interface DemoCv {
  id: string;
  filename: string;
}

interface CvRow extends DemoCv {
  sample: boolean;
}

interface Step {
  kind: "tool-call" | "tool-result";
  tool: string;
  summary: string;
}

const TOOL_LABELS: Record<string, string> = {
  calyflow_search_documents: "Searched knowledge base",
  calyflow_read_document: "Read document",
  calyflow_create_document: "Saved document",
};

/** Friendly label for a tool name, e.g. "calyflow_read_document" → "Read document". */
function toolLabel(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool];
  const [prefix, ...rest] = tool.split("_");
  return rest.length ? `${prefix} · ${rest.join(" ")}` : tool;
}

export function DemoExperience({
  projectId,
  agentId,
  agentName,
  graph,
  jd,
  cvs,
}: {
  projectId: string;
  agentId: string;
  agentName: string;
  graph: WorkflowGraph;
  jd: { id: string; filename: string; text: string };
  cvs: DemoCv[];
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <Hero agentName={agentName} />
      <CvScreener
        projectId={projectId}
        agentId={agentId}
        agentName={agentName}
        graph={graph}
        jd={jd}
        cvs={cvs}
      />
    </div>
  );
}

/** Deliberately minimal: a one-word headline so the page reads as a thing to
 *  try, not a wall of marketing copy — the interactive columns below are the
 *  point. */
function Hero({ agentName }: { agentName: string }) {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <span className="inline-flex items-center gap-1.5 rounded-chip bg-mint-400/15 px-3 py-1 text-xs font-bold tracking-wide text-mint-700">
        ✦ {agentName} Agent
      </span>
      <h1 className="mt-4 text-5xl font-bold leading-none sm:text-6xl">Demo</h1>
      <p className="mt-3 text-lg text-navy-800/55">
        See how this agent screens three CVs against a job description:
      </p>
    </div>
  );
}

function CvScreener({
  projectId,
  agentId,
  agentName,
  graph,
  jd,
  cvs,
}: {
  projectId: string;
  agentId: string;
  agentName: string;
  graph: WorkflowGraph;
  jd: { id: string; filename: string; text: string };
  cvs: DemoCv[];
}) {
  const [jdMode, setJdMode] = useState<"sample" | "custom">("sample");
  const [jdLabel, setJdLabel] = useState(jd.filename);
  const [jdBusy, setJdBusy] = useState(false);

  const [cvRows, setCvRows] = useState<CvRow[]>(
    cvs.map((c) => ({ ...c, sample: true })),
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(cvs.map((c) => c.id)),
  );
  const [cvBusy, setCvBusy] = useState(false);

  const [output, setOutput] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const cvFileRef = useRef<HTMLInputElement>(null);
  const jdFileRef = useRef<HTMLInputElement>(null);

  function toggleCv(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function useSampleJd() {
    if (jdMode === "sample") return;
    setJdBusy(true);
    setError(null);
    try {
      await setDocumentActiveAction(jd.id, true);
      setJdMode("sample");
      setJdLabel(jd.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch the JD");
    } finally {
      setJdBusy(false);
    }
  }

  async function uploadJd(file: File) {
    setJdBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("scopeType", "project");
      fd.set("scopeId", projectId);
      fd.set("kind", "file");
      fd.set("docType", "jd");
      await uploadDocumentAction(fd);
      setJdMode("custom");
      setJdLabel(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the JD");
    } finally {
      setJdBusy(false);
    }
  }

  async function uploadCvs(files: FileList) {
    setCvBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("scopeId", projectId);
        fd.set("docType", "cv");
        const { docId } = await uploadInputForRunAction(fd);
        setCvRows((prev) => [
          ...prev,
          { id: docId, filename: file.name, sample: false },
        ]);
        setSelected((prev) => new Set(prev).add(docId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload a CV");
    } finally {
      setCvBusy(false);
      if (cvFileRef.current) cvFileRef.current.value = "";
    }
  }

  const busy = running || jdBusy || cvBusy;
  const canRun = selected.size > 0 && !busy;

  async function run() {
    if (selected.size === 0) {
      setError("Pick at least one CV to screen.");
      return;
    }
    setError(null);
    setOutput("");
    setSteps([]);
    setRunning(true);
    // The run happens below the fold — bring the live canvas and progress into
    // view so people don't sit on the button thinking nothing happened.
    canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      // The agent reads candidates from the project knowledge base via tools,
      // and search only returns *active* docs — so mirror the checkboxes onto
      // each CV's active state before the run.
      await Promise.all(
        cvRows.map((cv) =>
          setDocumentActiveAction(cv.id, selected.has(cv.id)),
        ),
      );

      // Only the selected CVs are active (above), and the agent's document
      // search only returns active docs — so a simple instruction screens
      // exactly the picked candidates without naming each one.
      const count = selected.size;
      const response = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          agentId,
          task:
            `Screen the ${count} candidate CV${count === 1 ? "" : "s"} in ` +
            "this project against the job description, then save one " +
            "screening report covering them.",
          connectors: {},
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Run failed (${response.status})`);
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let outputDocId: string | null = null;
      let streamed = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: {
            type: string;
            value?: string;
            tool?: string;
            summary?: string;
            message?: string;
            outputDocId?: string | null;
          };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "text") {
            streamed += ev.value ?? "";
            setOutput((prev) => prev + (ev.value ?? ""));
          } else if (ev.type === "tool-call" || ev.type === "tool-result") {
            setSteps((prev) => [
              ...prev,
              {
                kind: ev.type as "tool-call" | "tool-result",
                tool: ev.tool ?? "",
                summary: ev.summary ?? "",
              },
            ]);
          } else if (ev.type === "error") {
            throw new Error(ev.message ?? "The agent run failed.");
          } else if (ev.type === "done" && ev.outputDocId) {
            outputDocId = ev.outputDocId;
          }
        }
        outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
      }

      // The full screening report is saved as a document; show it in place of
      // the agent's short closing note so the demo lands the same payoff.
      if (outputDocId) {
        const report = await getDocumentTextAction(outputDocId);
        if (report.trim()) {
          setOutput(report);
          return;
        }
      }
      // The run ended without a saved report and without streamed text — most
      // often the agent hit its step budget before finishing. Never leave the
      // user staring at a blank panel with no explanation.
      if (!outputDocId && !streamed.trim()) {
        setError(
          "The agent finished without producing a screening report — it may have run out of steps. Please try running it again.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The agent run failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Two columns: Job Description (left) · CVs (right). */}
      <div className="grid gap-5 md:grid-cols-2">
        <ColumnCard
          step={1}
          title="Job description"
          subtitle="What we screen against"
        >
          <ModeToggle
            value={jdMode}
            disabled={jdBusy}
            onSample={useSampleJd}
            onCustomLabel="Upload your own"
            onCustom={() => jdFileRef.current?.click()}
          />
          <input
            ref={jdFileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="sr-only"
            disabled={jdBusy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadJd(f);
              e.target.value = "";
            }}
          />
          <div className="mt-3 rounded-card border border-navy-800/10 bg-cream-50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-navy-900">
              📄 {jdLabel}
              {jdMode === "sample" && (
                <span className="rounded-full bg-mint-400/20 px-2 py-px text-[10px] font-bold uppercase tracking-wide text-mint-700">
                  Sample
                </span>
              )}
            </p>
            {jdMode === "sample" && (
              <div className="prose-calyflow mt-2 max-h-64 overflow-y-auto rounded-card border border-navy-800/8 bg-white/60 p-3 text-[12.5px] leading-relaxed text-navy-800/65 [&_h1]:mb-1 [&_h1]:text-base [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-[13px]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {jd.text}
                </ReactMarkdown>
              </div>
            )}
            {jdBusy && (
              <p className="mt-2 text-xs text-navy-800/45">Updating…</p>
            )}
          </div>
        </ColumnCard>

        <ColumnCard step={2} title="Candidate CVs" subtitle="Who we screen">
          <div className="space-y-2">
            {cvRows.map((cv) => (
              <label
                key={cv.id}
                className="flex cursor-pointer items-center gap-3 rounded-card border border-navy-800/10 bg-white px-3.5 py-2.5 transition hover:border-mint-700/50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(cv.id)}
                  onChange={() => toggleCv(cv.id)}
                  disabled={busy}
                  className="size-4 accent-mint-700"
                />
                <span className="flex-1 truncate text-sm font-medium text-navy-900">
                  {cv.filename}
                </span>
                {cv.sample && (
                  <span className="rounded-full bg-mint-400/20 px-2 py-px text-[10px] font-bold uppercase tracking-wide text-mint-700">
                    Sample
                  </span>
                )}
              </label>
            ))}
          </div>
          <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-card border-[1.5px] border-dashed border-navy-800/25 px-3 py-3 text-sm font-semibold text-navy-800/60 transition hover:border-mint-700 hover:text-mint-700">
            <input
              ref={cvFileRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md"
              className="sr-only"
              disabled={busy}
              onChange={(e) => e.target.files && void uploadCvs(e.target.files)}
            />
            {cvBusy ? "Uploading…" : "📎 Upload your own CV(s)"}
          </label>
        </ColumnCard>
      </div>

      {error && (
        <p className="rounded-chip bg-coral-400/12 px-3 py-2 text-sm text-coral-400">
          {error}
        </p>
      )}

      {/* Run — the moment of truth. */}
      <div className="flex flex-col items-center gap-2 rounded-card bg-linear-to-br from-mint-400/15 to-sky-300/10 px-6 py-7 text-center">
        <Button onClick={run} disabled={!canRun} className="text-base">
          {running ? "Working… watch below ↓" : "▶ Run Agent"}
        </Button>
        <p className="text-sm text-navy-800/55">
          {selected.size > 0
            ? `Screening ${selected.size} CV${selected.size > 1 ? "s" : ""} against the job description`
            : "Pick at least one CV above to begin"}
        </p>
      </div>

      {/* The agent's shape, kept BELOW the action so people watch how it works
          while the run happens. We scroll here on run start, and the header
          switches to a live "running" state so it's obvious work is happening. */}
      <div
        ref={canvasRef}
        className="scroll-mt-4 rounded-card border border-navy-800/12 bg-white p-6"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">How this agent runs</h2>
            <p className="mt-0.5 max-w-[60ch] text-sm text-navy-800/55">
              {running
                ? "Your agent is working right now — here's what it's doing, step by step. The report appears below as soon as it's done."
                : "The agent reads your job description and CVs, screens each candidate, and writes an evidence-based report back."}
            </p>
          </div>
          {running && (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-chip bg-mint-400/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-mint-700">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-mint-700" />
              Working now
            </span>
          )}
        </div>
        <WorkflowCanvas graph={graph} highlightSkill />
      </div>

      {(steps.length > 0 || running) && (
        <div className="rounded-card border border-navy-800/12 bg-cream-100/60 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-800/40">
            What the agent did
          </p>
          <ol className="space-y-1.5">
            {steps.map((step, i) => (
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
            {running && (
              <li className="flex items-center gap-2 text-sm text-navy-800/45">
                <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-mint-400" />
                Thinking…
              </li>
            )}
          </ol>
        </div>
      )}

      <RunOutput
        output={output}
        running={running}
        outputRef={outputRef}
        filename={`${agentName} — screening report`}
      />

      {/* Once a report is in hand, point people at the real next step: their
          own workspace, with their own clients, files, and agents. */}
      {output && !running && (
        <div className="rounded-card border border-mint-400/40 bg-linear-to-br from-mint-400/15 to-sky-300/10 px-6 py-9 text-center">
          <h2 className="text-xl font-bold sm:text-2xl">
            Set up your own workspace and agents
          </h2>
          <p className="mx-auto mt-2 max-w-[54ch] text-navy-800/60">
            That was a real agent run on sample data. Now create your first
            client, add your own job descriptions and CVs, and put your agents
            to work on live roles.
          </p>
          <ButtonLink href="/clients" className="mt-6 inline-flex text-base">
            ＋ Create your first client
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

function ColumnCard({
  step,
  title,
  subtitle,
  children,
}: {
  step: number;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-navy-800/12 bg-white p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-navy-900 text-xs font-bold text-white">
          {step}
        </span>
        <div>
          <h3 className="text-sm font-semibold leading-tight text-navy-900">
            {title}
          </h3>
          <p className="text-xs text-navy-800/45">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ModeToggle({
  value,
  disabled,
  onSample,
  onCustom,
  onCustomLabel,
}: {
  value: "sample" | "custom";
  disabled: boolean;
  onSample: () => void;
  onCustom: () => void;
  onCustomLabel: string;
}) {
  const pill = "flex-1 rounded-chip px-3 py-1.5 text-sm font-semibold transition";
  return (
    <div className="flex gap-1 rounded-chip border border-navy-800/12 bg-cream-50 p-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onSample}
        className={`${pill} ${
          value === "sample"
            ? "bg-mint-400 text-navy-900"
            : "text-navy-800/55 hover:text-navy-900"
        }`}
      >
        Use our sample
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onCustom}
        className={`${pill} ${
          value === "custom"
            ? "bg-mint-400 text-navy-900"
            : "text-navy-800/55 hover:text-navy-900"
        }`}
      >
        {onCustomLabel}
      </button>
    </div>
  );
}

function RunOutput({
  output,
  running,
  outputRef,
  filename,
}: {
  output: string;
  running: boolean;
  outputRef: React.RefObject<HTMLDivElement | null>;
  filename: string;
}) {
  if (!output && !running) return null;
  return (
    <div>
      <div
        ref={outputRef}
        className="prose-calyflow max-h-130 overflow-y-auto rounded-card border border-navy-800/12 bg-white p-6"
      >
        {running && (
          <div
            role="status"
            aria-live="polite"
            className="mb-3 flex items-center gap-2.5 text-sm font-medium text-navy-800/55"
          >
            <span
              aria-hidden
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-mint-400/30 border-t-mint-400"
            />
            {output ? "Generating…" : "Working on it — this can take a moment…"}
          </div>
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
        {running && output && (
          <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-mint-400 align-text-bottom" />
        )}
      </div>
      {!running && output && (
        <div className="mt-3">
          <DownloadButtons text={output} filename={filename} />
        </div>
      )}
    </div>
  );
}
