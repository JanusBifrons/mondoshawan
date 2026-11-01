/**
 * Pure parsers for agent usage, so they can be tested without running anything:
 *  - parseJobLog: a job's `claude -p --output-format stream-json` log (progress + final result);
 *  - transcriptUsage: tokens per model from a session transcript (for visible agents, which
 *    report no cost of their own).
 */

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number | null;
}

export interface JobResult {
  ok: boolean;
  subtype: string | null;
  durationMs: number | null;
  apiMs: number | null;
  turns: number | null;
  costUsd: number | null;
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheWrite: number;
  models: ModelUsage[];
  /** The structured output (when a JSON schema was given), else null. */
  structured: Record<string, unknown> | null;
  text: string | null;
}

export interface JobLog {
  model: string | null;
  toolCalls: number;
  /** Latest human-readable step: a tool call summary or a line of Claude's text. */
  lastStep: string | null;
  result: JobResult | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function toolStep(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  for (const k of ["description", "command", "file_path", "pattern", "query"]) {
    if (typeof i[k] === "string" && i[k]) return `${name}: ${clip(String(i[k]).replace(/\s+/g, " "), 120)}`;
  }
  return name;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toResult(e: any): JobResult {
  const u = e.usage ?? {};
  const models: ModelUsage[] = Object.entries(e.modelUsage ?? {}).map(([model, m]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = m as any;
    return {
      model,
      input: num(x.inputTokens),
      output: num(x.outputTokens),
      cacheRead: num(x.cacheReadInputTokens),
      cacheWrite: num(x.cacheCreationInputTokens),
      costUsd: typeof x.costUSD === "number" ? x.costUSD : null,
    };
  });
  return {
    ok: !e.is_error && (e.subtype ?? "success") === "success",
    subtype: e.subtype ?? null,
    durationMs: typeof e.duration_ms === "number" ? e.duration_ms : null,
    apiMs: typeof e.duration_api_ms === "number" ? e.duration_api_ms : null,
    turns: typeof e.num_turns === "number" ? e.num_turns : null,
    costUsd: typeof e.total_cost_usd === "number" ? e.total_cost_usd : null,
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    thinking: num(u.output_tokens_details?.thinking_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    models,
    structured: e.structured_output && typeof e.structured_output === "object" ? e.structured_output : null,
    text: typeof e.result === "string" ? e.result : null,
  };
}

export function parseJobLog(text: string): JobLog {
  const log: JobLog = { model: null, toolCalls: 0, lastStep: null, result: null };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // a line still being written
    }
    if (e.type === "system" && e.subtype === "init" && typeof e.model === "string") log.model = e.model;
    else if (e.type === "assistant") {
      for (const b of e.message?.content ?? []) {
        if (b?.type === "tool_use") {
          log.toolCalls++;
          log.lastStep = toolStep(b.name, b.input);
        } else if (b?.type === "text" && b.text?.trim()) {
          log.lastStep = clip(b.text.trim().split("\n")[0], 200);
        }
      }
    } else if (e.type === "result") log.result = toResult(e);
  }
  return log;
}

export interface TranscriptUsage {
  models: Omit<ModelUsage, "costUsd">[];
  calls: number;
  firstAt: number | null;
  lastAt: number | null;
}

/**
 * Tokens per model from a session transcript. A streamed reply is written as several lines
 * that share one message id and usage, so each message id is counted once (its last line).
 */
export function transcriptUsage(jsonl: string): TranscriptUsage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byMessage = new Map<string, { model: string; usage: any }>();
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const at = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (Number.isFinite(at)) {
      firstAt = firstAt === null ? at : Math.min(firstAt, at);
      lastAt = lastAt === null ? at : Math.max(lastAt, at);
    }
    const m = e.message;
    if (e.type !== "assistant" || !m?.usage || !m.model || m.model === "<synthetic>") continue;
    byMessage.set(m.id ?? e.uuid ?? String(byMessage.size), { model: m.model, usage: m.usage });
  }
  const totals = new Map<string, Omit<ModelUsage, "costUsd">>();
  for (const { model, usage } of byMessage.values()) {
    const t = totals.get(model) ?? { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    t.input += num(usage.input_tokens);
    t.output += num(usage.output_tokens);
    t.cacheRead += num(usage.cache_read_input_tokens);
    t.cacheWrite += num(usage.cache_creation_input_tokens);
    totals.set(model, t);
  }
  return { models: [...totals.values()], calls: byMessage.size, firstAt, lastAt };
}
