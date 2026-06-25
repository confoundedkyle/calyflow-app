import "server-only";
import { streamText, type LanguageModel, type ModelMessage } from "ai";

export interface FinalizeUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export interface FinalizeResult {
  text: string;
  usage: FinalizeUsage;
}

/**
 * Force a tool-free completion when a research loop hits its step cap before the
 * model writes its document. A `stopWhen: stepCountIs(N)` loop can end right
 * after a tool call — denying the model the turn where it writes the output and
 * throwing the research away. This feeds the gathered research (the prior
 * messages, including tool calls/results) back with a final nudge and NO tools,
 * so the model must produce the document from what it already found. Streams text
 * deltas via `onDelta`. Returns the assembled text and the finalize call's usage.
 */
export async function finalizeWrite(opts: {
  model: LanguageModel;
  system: string;
  priorMessages: ModelMessage[];
  nudge: string;
  onDelta: (text: string) => void;
  timeoutMs?: number;
}): Promise<FinalizeResult> {
  let text = "";
  let streamErr: unknown = null;
  const result = streamText({
    model: opts.model,
    system: opts.system,
    messages: [...opts.priorMessages, { role: "user", content: opts.nudge }],
    abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    onError: ({ error }) => {
      streamErr = error;
    },
  });
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      text += part.text;
      opts.onDelta(part.text);
    } else if (part.type === "error") {
      streamErr = part.error;
    }
  }
  if (streamErr) throw streamErr;
  const u = await result.totalUsage;
  return {
    text,
    usage: {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cachedInputTokens: (u as { cachedInputTokens?: number }).cachedInputTokens,
    },
  };
}
