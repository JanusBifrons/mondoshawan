import fs from "node:fs";
import { getAgents } from "./agents";
import { transcriptFile } from "./fleet";
import { transcriptUsage, type TranscriptUsage } from "./job-events";
import { getJobs, type Job } from "./jobs";
import { getStore } from "./store";

/**
 * The usage log: every run Mondo started, with what it used, in tokens.
 *  - Jobs report exact usage (Claude Code's result line).
 *  - Visible (Remote Control) agents are read from their transcripts.
 */

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Fresh tokens: input + output + cache writes (cache reads are cheap re-use, shown apart). */
  total: number;
}

export interface UsageRun {
  id: string;
  type: "job" | "agent";
  kind: string;
  title: string;
  project: string | null;
  status: string;
  models: string[];
  effort: string | null;
  startedAt: number;
  durationMs: number | null;
  turns: number | null;
  toolCalls: number | null;
  tokens: Tokens;
  thinking: number | null;
  confidence: number | null;
  /** Where to see it: the job or agent drill-down. */
  href: string;
}

const total = (t: Omit<Tokens, "total">): Tokens => ({ ...t, total: t.input + t.output + t.cacheWrite });

const g = globalThis as unknown as { __mondoUsageCache?: Map<string, { mtime: number; size: number; usage: TranscriptUsage }> };
const cache = (g.__mondoUsageCache ??= new Map());

/** Token usage of one session from its transcript, cached until the file changes. */
export function sessionUsage(sessionId: string, cwd: string, transcriptPath: string | null): TranscriptUsage | null {
  const file = transcriptFile({ sessionId, cwd, transcriptPath });
  if (!file) return null;
  try {
    const st = fs.statSync(/*turbopackIgnore: true*/ file);
    const hit = cache.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.usage;
    const usage = transcriptUsage(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
    cache.set(file, { mtime: st.mtimeMs, size: st.size, usage });
    return usage;
  } catch {
    return null;
  }
}

export function sumModels(models: { input: number; output: number; cacheRead: number; cacheWrite: number }[]): Tokens {
  return total(
    models.reduce(
      (a, m) => ({ input: a.input + m.input, output: a.output + m.output, cacheRead: a.cacheRead + m.cacheRead, cacheWrite: a.cacheWrite + m.cacheWrite }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ),
  );
}

export function jobRun(j: Job): UsageRun {
  return {
    id: j.id,
    type: "job",
    kind: j.kind,
    title: j.title,
    project: j.project,
    status: j.status,
    models: j.modelUsage.length ? j.modelUsage.map((m) => m.model) : j.model ? [j.model] : [],
    effort: j.effort,
    startedAt: j.startedAt ?? j.createdAt,
    durationMs: j.durationMs ?? (j.status === "running" ? Date.now() - (j.startedAt ?? j.createdAt) : null),
    turns: j.turns,
    toolCalls: j.toolCalls,
    tokens: total({
      input: j.inputTokens ?? 0,
      output: j.outputTokens ?? 0,
      cacheRead: j.cacheReadTokens ?? 0,
      cacheWrite: j.cacheWriteTokens ?? 0,
    }),
    thinking: j.thinkingTokens,
    confidence: j.confidence,
    href: j.kind === "talk" && typeof j.input.talkId === "string" ? `/design/talk/${j.input.talkId}` : `/agents/job/${j.id}`,
  };
}

export function usageRuns(): UsageRun[] {
  const rows = new Map(getStore().list().map((s) => [s.id, s]));
  const runs: UsageRun[] = getJobs().list().map(jobRun);
  for (const a of getAgents().list()) {
    const row = rows.get(a.sessionId);
    const u = sessionUsage(a.sessionId, row?.cwd ?? a.cwd, row?.transcriptPath ?? null);
    const end = a.status === "running" || a.status === "starting" ? Date.now() : (u?.lastAt ?? a.lastActivity);
    runs.push({
      id: a.sessionId,
      type: "agent",
      kind: a.name.startsWith("design-") ? "discussion" : "agent",
      title: a.name,
      project: a.project,
      status: a.status,
      models: u?.models.map((m) => m.model) ?? (a.model ? [a.model] : []),
      effort: null,
      startedAt: a.createdAt,
      durationMs: end - a.createdAt,
      turns: u?.calls ?? null,
      toolCalls: null,
      tokens: sumModels(u?.models ?? []),
      thinking: null,
      confidence: null,
      href: `/agents/${a.sessionId}`,
    });
  }
  return runs.sort((x, y) => y.startedAt - x.startedAt);
}
