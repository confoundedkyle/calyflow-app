"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowNodeIcon,
} from "@/lib/workflow-graph";
import { CONNECTOR_DOMAINS } from "@/lib/connectors";
import {
  IconAiSpark,
  IconClientsBuilding,
  IconDatabase,
  IconDocumentCheck,
  IconEnvelope,
  IconFolder,
  IconIntegrationPlug,
  IconRobot,
  IconRocket,
  IconScorecard,
  IconWorkflowNodes,
} from "@/components/icons";

type CanvasNodeData = { node: WorkflowGraphNode };
type CanvasNode = Node<CanvasNodeData>;

const NODE_ICONS: Record<
  WorkflowNodeIcon,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  doc: IconDocumentCheck,
  notes: IconScorecard,
  files: IconFolder,
  workspace: IconDatabase,
  client: IconClientsBuilding,
  connector: IconIntegrationPlug,
  email: IconEnvelope,
  skill: IconWorkflowNodes,
  spark: IconAiSpark,
  robot: IconRobot,
  output: IconRocket,
};

// Gradient icon tiles — one color identity per icon, brand palette only.
const TILE_GRADIENTS: Record<WorkflowNodeIcon, string> = {
  workspace: "from-lavender-300 to-[#8b6fd8]",
  client: "from-sky-300 to-[#5688d4]",
  doc: "from-mint-400 to-mint-700",
  notes: "from-amber-400 to-[#b97c1f]",
  files: "from-[#62749c] to-navy-800",
  connector: "from-sky-300 to-navy-800",
  email: "from-amber-400 to-coral-400",
  skill: "from-coral-400 to-[#c4523a]",
  spark: "from-navy-800 to-mint-700",
  robot: "from-mint-400 to-sky-300",
  output: "from-mint-700 to-navy-800",
};

// Short, plain-language explanation shown in the modal when an item is clicked.
// Configuration (e.g. "which Drive file") is intentionally left for later — the
// `configHint` only promises it for the inputs the user will eventually pick.
interface NodeExplanation {
  kicker: string;
  body: string;
  configHint?: string;
}

const KNOWLEDGE_BODY: Record<string, string> = {
  "itm-workspace":
    "Your agency's shared knowledge base — guidelines, templates and reference material that apply across every client. It's pulled into each run automatically so the AI follows your standards.",
  "itm-client":
    "The knowledge base and files tied to this specific client. Added automatically so the AI has the right background for who you're working with.",
};

const INPUT_BODY: Record<string, string> = {
  "itm-jd":
    "The job description for this role. The AI reads it to understand the requirements it should work against.",
  "itm-intake_notes":
    "Notes captured when the role was taken on — the background and context behind the brief.",
  "itm-cv": "A candidate CV. The AI uses it as the material to analyse or write about.",
  "itm-note": "A free-text note from the project for the AI to take into account.",
  "itm-other":
    "Any file from the project you want to feed in — a brief, a spec, a transcript, and so on.",
  "itm-output":
    "A document produced by an earlier AI run, so this workflow can build on previous results.",
  "itm-input": "Notes or files you add when you start the run.",
  "itm-project-files": "Files attached to this project that the AI can draw on.",
};

function getNodeExplanation(node: WorkflowGraphNode): NodeExplanation {
  switch (node.kind) {
    case "skill":
      return {
        kicker: "Skill",
        body: "The skill that powers this workflow. It holds the instructions that tell the AI Engine exactly what to produce and how. Pick a different workflow above to swap in a different skill.",
      };
    case "step":
      return node.icon === "robot"
        ? {
            kicker: "AI Engine · Agent",
            body: "An autonomous engine that works in several steps, calling tools and connectors as it needs them until the task is done.",
          }
        : {
            kicker: "AI Engine",
            body: "The engine that does the work. It reads every input on the left, follows the skill's instructions, and writes the result on the right in a single AI call.",
          };
    case "output":
      return node.icon === "email"
        ? {
            kicker: "Output",
            body: "The emails this agent sends, delivered from your connected mailbox.",
          }
        : {
            kicker: "Output",
            body: "The document this run produces. It's saved straight to your project files, where you can review, edit and share it.",
          };
    case "item": {
      if (node.id in KNOWLEDGE_BODY) {
        return {
          kicker: "Knowledge · added automatically",
          body: KNOWLEDGE_BODY[node.id],
        };
      }
      if (node.id.startsWith("itm-conn-")) {
        return {
          kicker: "Connector",
          body: `Live data pulled from ${node.title} when this agent runs.`,
        };
      }
      const required = node.badge === "Required";
      return {
        kicker: required ? "Required input" : "Run input",
        body:
          INPUT_BODY[node.id] ??
          (required
            ? "A document this workflow needs before it can run. You'll choose it from the project when you start a run."
            : "An optional input you choose when you start a run."),
        configHint: "Soon you'll be able to pick exactly which file to use here.",
      };
    }
    default:
      return { kicker: "", body: "" };
  }
}

function BrandLogo({ provider, size = 18 }: { provider: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const domain = CONNECTOR_DOMAINS[provider];
  if (!domain || failed) {
    return (
      <span
        style={{ width: size, height: size }}
        className="grid place-items-center rounded-full bg-cream-100 ring-2 ring-white"
      >
        <IconIntegrationPlug size={Math.round(size * 0.6)} className="text-navy-800/50" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny external favicons; next/image would need remotePatterns for ~50 hosts
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt={provider}
      title={provider}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="rounded-full bg-white object-contain ring-2 ring-white"
    />
  );
}

/** Main icon tile showing a single known connector's brand logo — replaces
 *  the generic gradient tile so the brand isn't shown twice on one node. */
function BrandTile({ provider }: { provider: string }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-navy-800/10 bg-white shadow-[0_2px_8px_rgba(19,31,56,0.1)]">
      <BrandLogo provider={provider} size={22} />
    </span>
  );
}

function BrandLogoRow({ providers }: { providers: string[] }) {
  const shown = providers.slice(0, 4);
  const extra = providers.length - shown.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((p) => (
        <BrandLogo key={p} provider={p} />
      ))}
      {extra > 0 && (
        <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-navy-800/8 px-1 text-[9px] font-bold text-navy-800/60 ring-2 ring-white">
          +{extra}
        </span>
      )}
    </span>
  );
}

const handleClass =
  "!h-2 !w-2 !rounded-full !border-2 !border-white !bg-navy-800/30";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function GroupNode({ data }: NodeProps<CanvasNode>) {
  const { node } = data;
  return (
    <div
      style={node.size}
      className="rounded-2xl border-[1.5px] border-dashed border-navy-800/20 bg-white/45"
    >
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={handleClass}
      />
      <div className="flex items-center justify-between px-3.5 pt-2.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-navy-800/50">
          {node.title}
        </span>
        {node.brandLogos && node.brandLogos.length > 0 && (
          <BrandLogoRow providers={node.brandLogos} />
        )}
      </div>
    </div>
  );
}

function ItemNode({ data }: NodeProps<CanvasNode>) {
  const { node } = data;
  const Icon = NODE_ICONS[node.icon ?? "doc"];
  // One known connector → its brand logo IS the tile (no duplicate icons).
  const soloBrand =
    node.brandLogos?.length === 1 ? node.brandLogos[0] : undefined;
  return (
    <div
      style={node.size}
      className="flex cursor-pointer items-center gap-2.5 rounded-card border border-navy-800/10 bg-white px-3 shadow-[0_2px_10px_rgba(19,31,56,0.06)] transition hover:border-navy-800/20 hover:bg-cream-50 hover:shadow-[0_4px_16px_rgba(19,31,56,0.1)]"
    >
      {soloBrand ? (
        <BrandTile provider={soloBrand} />
      ) : (
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-[10px] bg-linear-to-br text-white shadow-[0_2px_8px_rgba(19,31,56,0.18)] ${TILE_GRADIENTS[node.icon ?? "doc"]}`}
        >
          <Icon size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold leading-tight text-navy-900">
            {node.title}
          </span>
          {node.badge && (
            <span className="shrink-0 rounded-full bg-amber-400/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-400">
              {node.badge}
            </span>
          )}
        </span>
        {node.subtitle && (
          <span className="block truncate text-[11px] leading-tight text-navy-800/45">
            {node.subtitle}
          </span>
        )}
      </span>
      {node.brandLogos && node.brandLogos.length > 1 && (
        <BrandLogoRow providers={node.brandLogos} />
      )}
    </div>
  );
}

function SkillNode({ data }: NodeProps<CanvasNode>) {
  const { node } = data;
  return (
    <div className="flex h-[76px] w-[264px] cursor-pointer items-center gap-3 rounded-card border-[1.5px] border-coral-400/50 bg-white px-3.5 shadow-[0_4px_18px_rgba(19,31,56,0.07)] transition hover:bg-coral-400/5 hover:shadow-[0_6px_22px_rgba(19,31,56,0.1)]">
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={handleClass}
      />
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-coral-400 to-[#c4523a] text-white shadow-[0_3px_10px_rgba(19,31,56,0.18)]">
        <IconWorkflowNodes size={20} />
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-navy-900">
          {node.title}
        </span>
        <span className="block truncate text-[11px] leading-snug text-navy-800/45">
          {node.subtitle}
        </span>
      </span>
    </div>
  );
}

function StepNode({ data }: NodeProps<CanvasNode>) {
  const { node } = data;
  // The agent engine (robot) gets the dark "advanced system" treatment so it
  // immediately reads as more sophisticated than a one-step workflow.
  const isAgent = node.icon === "robot";
  const Icon = isAgent ? IconRobot : IconAiSpark;

  return (
    <div
      className={`flex h-[96px] w-[264px] cursor-pointer items-center gap-3.5 rounded-card border-[1.5px] px-4 shadow-lift transition ${
        isAgent
          ? "border-mint-400/80 bg-linear-to-br from-navy-900 to-navy-800 hover:border-mint-400 hover:brightness-110"
          : "border-mint-400/70 bg-white hover:bg-mint-400/5 hover:shadow-[0_8px_26px_rgba(19,31,56,0.12)]"
      }`}
    >
      <Handle
        id="in-left"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={handleClass}
      />
      <Handle
        id="in-top"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={handleClass}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={handleClass}
      />
      <span
        className={`grid size-12 shrink-0 place-items-center rounded-xl bg-linear-to-br shadow-[0_3px_10px_rgba(19,31,56,0.22)] ${
          isAgent
            ? "from-mint-400 to-sky-300 text-navy-900 ring-2 ring-mint-400/40"
            : "from-navy-800 to-mint-700 text-white"
        }`}
      >
        <Icon size={26} />
      </span>
      <span className="min-w-0">
        <span
          className={`line-clamp-2 text-[15px] font-semibold leading-snug ${
            isAgent ? "text-white" : "text-navy-900"
          }`}
        >
          {node.title}
          {isAgent && (
            <span className="ml-1.5 inline-block translate-y-[-1px] rounded-full bg-mint-400/25 px-1.5 py-px align-middle text-[9px] font-bold uppercase tracking-wide text-mint-400">
              Agent
            </span>
          )}
        </span>
        <span
          className={`block truncate text-[11px] leading-snug ${
            isAgent ? "text-white/55" : "text-navy-800/45"
          }`}
        >
          {node.subtitle}
        </span>
        {node.modelLine && (
          <span
            title={node.modelLine}
            className={`mt-1 inline-block max-w-full truncate rounded-full px-2 py-0.5 font-mono text-[10px] ${
              isAgent
                ? "bg-white/12 text-white/75"
                : "bg-navy-800/6 text-navy-800/65"
            }`}
          >
            {node.modelLine}
          </span>
        )}
      </span>
    </div>
  );
}

function OutputNode({ data }: NodeProps<CanvasNode>) {
  const { node } = data;
  const Icon = NODE_ICONS[node.icon ?? "output"];
  const soloBrand =
    node.brandLogos?.length === 1 ? node.brandLogos[0] : undefined;
  return (
    <div className="flex w-60 cursor-pointer items-center gap-3 rounded-card border-[1.5px] border-mint-700/35 bg-white px-3.5 py-3 shadow-[0_4px_18px_rgba(19,31,56,0.07)] transition hover:bg-mint-700/5 hover:shadow-[0_6px_22px_rgba(19,31,56,0.1)]">
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={handleClass}
      />
      {soloBrand ? (
        <BrandTile provider={soloBrand} />
      ) : (
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br text-white shadow-[0_3px_10px_rgba(19,31,56,0.18)] ${TILE_GRADIENTS[node.icon ?? "output"]}`}
        >
          <Icon size={20} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="line-clamp-2 text-sm font-semibold leading-snug text-navy-900">
            {node.title}
          </span>
          {node.badge && (
            <span className="shrink-0 rounded-full bg-amber-400/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-400">
              {node.badge}
            </span>
          )}
        </span>
        <span className="block truncate text-[11px] leading-snug text-navy-800/45">
          {node.subtitle}
        </span>
      </span>
      {node.brandLogos && node.brandLogos.length > 1 && (
        <BrandLogoRow providers={node.brandLogos} />
      )}
    </div>
  );
}

// Defined at module scope — React Flow re-mounts nodes if this is recreated.
// Keys are prefixed: bare "group"/"output" are React Flow built-in types and
// would inherit its default node CSS (black border, fixed width).
const NODE_TYPES: NodeTypes = {
  "wf-group": GroupNode,
  "wf-item": ItemNode,
  "wf-skill": SkillNode,
  "wf-step": StepNode,
  "wf-output": OutputNode,
};

const EDGE_STYLES: Record<string, React.CSSProperties> = {
  knowledge: {
    stroke: "rgba(27, 42, 74, 0.35)",
    strokeWidth: 1.75,
    strokeDasharray: "6 4",
  },
  project: { stroke: "#5bc8a8", strokeWidth: 2.25 },
  skill: { stroke: "#e8836b", strokeWidth: 2.25 },
  output: { stroke: "#1b7a5f", strokeWidth: 2.5 },
};

const EDGE_ARROWS: Record<string, string> = {
  knowledge: "rgba(27, 42, 74, 0.45)",
  project: "#5bc8a8",
  skill: "#e8836b",
  output: "#1b7a5f",
};

const CANVAS_PAD = 28;
const ZOOM_STEP = 1.25;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

export function WorkflowCanvas({
  graph,
  className,
}: {
  graph: WorkflowGraph;
  className?: string;
}) {
  // null = "fit to container" (the default); buttons switch to explicit zoom.
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // The node whose explanation modal is open (null = closed).
  const [selected, setSelected] = useState<WorkflowGraphNode | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitZoom = Math.min(
    1,
    (containerSize.width - CANVAS_PAD * 2) / graph.width,
    (containerSize.height - CANVAS_PAD * 2) / graph.height,
  );
  const zoom = clamp(zoomOverride ?? fitZoom, MIN_ZOOM, MAX_ZOOM);

  // The surface is at least as big as the zoomed graph, so zooming in grows
  // the scroll area instead of cropping; the graph stays centered inside it.
  const surfaceWidth = Math.max(
    containerSize.width,
    graph.width * zoom + CANVAS_PAD * 2,
  );
  const surfaceHeight = Math.max(
    containerSize.height,
    graph.height * zoom + CANVAS_PAD * 2,
  );
  const viewport = {
    x: (surfaceWidth - graph.width * zoom) / 2,
    y: (surfaceHeight - graph.height * zoom) / 2,
    zoom,
  };

  const nodes = useMemo<CanvasNode[]>(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: `wf-${node.kind}`,
        position: node.position,
        parentId: node.parentId,
        data: { node },
        draggable: false,
        selectable: false,
        connectable: false,
      })),
    [graph],
  );

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        // The engine has two target handles: groups arrive on the left,
        // the skill drops in from the top.
        targetHandle:
          edge.target === "step"
            ? edge.kind === "skill"
              ? "in-top"
              : "in-left"
            : undefined,
        animated: edge.kind === "output",
        style: EDGE_STYLES[edge.kind],
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: EDGE_ARROWS[edge.kind],
          width: 16,
          height: 16,
        },
      })),
    [graph],
  );

  return (
    <div className={className}>
      <div className="relative">
        {/* Wrapper scrolls; the surface grows with the zoomed graph, so
            narrow screens scroll to the rest instead of cropping it. */}
        <div
          ref={wrapperRef}
          className="h-80 w-full overflow-auto rounded-panel border border-navy-800/12 bg-linear-to-br from-cream-50 to-white sm:h-[26rem]"
        >
          <div style={{ width: surfaceWidth, height: surfaceHeight }}>
            {containerSize.width > 0 && (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodeClick={(_, node) => {
                  const clicked = (node.data as CanvasNodeData).node;
                  // Group containers are scaffolding, not items — skip them.
                  if (clicked.kind !== "group") setSelected(clicked);
                }}
                viewport={viewport}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                edgesFocusable={false}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                preventScrolling={false}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1.5}
                  color="rgba(27, 42, 74, 0.14)"
                />
              </ReactFlow>
            )}
          </div>
        </div>
        <div className="absolute right-3 top-3 flex overflow-hidden rounded-chip border border-navy-800/15 bg-white shadow-[0_2px_10px_rgba(19,31,56,0.08)]">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() =>
              setZoomOverride(clamp(zoom / ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))
            }
            className="px-2.5 py-1 text-sm font-semibold text-navy-800/60 transition hover:bg-cream-100 hover:text-navy-900"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Fit to view"
            onClick={() => setZoomOverride(null)}
            className="border-x border-navy-800/10 px-2.5 py-1 text-[11px] font-semibold text-navy-800/60 transition hover:bg-cream-100 hover:text-navy-900"
          >
            Fit
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() =>
              setZoomOverride(clamp(zoom * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))
            }
            className="px-2.5 py-1 text-sm font-semibold text-navy-800/60 transition hover:bg-cream-100 hover:text-navy-900"
          >
            +
          </button>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-navy-800/50">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-mint-400" />
          Inputs you pick
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-coral-400" />
          Skill
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-[1.5px] border-dashed border-navy-800/40" />
          Knowledge, added automatically
        </span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-amber-400/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-400">
            Required
          </span>
          Must exist before a run
        </span>
      </div>
      {selected && <NodeExplanationModal node={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function NodeExplanationModal({
  node,
  onClose,
}: {
  node: WorkflowGraphNode;
  onClose: () => void;
}) {
  const exp = getNodeExplanation(node);
  const Icon = NODE_ICONS[node.icon ?? "doc"];
  const soloBrand = node.brandLogos?.length === 1 ? node.brandLogos[0] : undefined;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={node.title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-panel border border-navy-800/12 bg-white shadow-lift"
      >
        <div className="flex items-start gap-3.5 border-b border-navy-800/8 px-5 py-4">
          {soloBrand ? (
            <BrandTile provider={soloBrand} />
          ) : (
            <span
              className={`grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br text-white shadow-[0_3px_10px_rgba(19,31,56,0.18)] ${TILE_GRADIENTS[node.icon ?? "doc"]}`}
            >
              <Icon size={22} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-800/45">
              {exp.kicker}
            </p>
            <h3 className="truncate text-base font-semibold text-navy-900">{node.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg px-2 py-1 text-lg leading-none text-navy-800/40 transition hover:bg-cream-100 hover:text-navy-900"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-[13.5px] leading-relaxed text-navy-800/80">{exp.body}</p>
          {node.modelLine && (
            <p className="mt-3 inline-block rounded-full bg-navy-800/6 px-2.5 py-1 font-mono text-[11px] text-navy-800/65">
              {node.modelLine}
            </p>
          )}
          {exp.configHint && (
            <div className="mt-4 flex items-start gap-2 rounded-card border border-navy-800/10 bg-cream-50 px-3 py-2.5">
              <span className="mt-px text-[13px]">⚙️</span>
              <p className="text-[12px] leading-snug text-navy-800/60">{exp.configHint}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
