import { describe, expect, it } from "vitest";
import { parseJobLog, transcriptUsage } from "@/lib/job-events";

const line = (o: unknown) => JSON.stringify(o);

describe("job log", () => {
  const log = [
    line({ type: "system", subtype: "init", model: "claude-sonnet-5-5" }),
    line({ type: "assistant", message: { content: [{ type: "text", text: "Reading the node first.\nMore." }] } }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { description: "Read node", command: "npm run design" } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
    '{"type":"assistant","message":{"content":[{"ty', // half-written line
  ].join("\n");

  it("tracks the model, tool calls and latest step while running", () => {
    expect(parseJobLog(log)).toEqual({ model: "claude-sonnet-5-5", toolCalls: 1, lastStep: "Bash: Read node", result: null });
  });

  it("reads the final result: tokens per model, turns, time and structured output", () => {
    const done = parseJobLog(
      log.split("\n").slice(0, 4).join("\n") +
        "\n" +
        line({
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 4200,
          duration_api_ms: 3365,
          num_turns: 3,
          total_cost_usd: 0.0072,
          result: '{"summary":"x"}',
          usage: { input_tokens: 6, output_tokens: 230, cache_read_input_tokens: 20338, cache_creation_input_tokens: 34293, output_tokens_details: { thinking_tokens: 40 } },
          modelUsage: {
            "claude-sonnet-5-5": { inputTokens: 6, outputTokens: 230, cacheReadInputTokens: 20338, cacheCreationInputTokens: 34293, costUSD: 0.0072 },
          },
          structured_output: { summary: "Rewrote it", confidence: 0.85 },
        }),
    );
    expect(done.result).toMatchObject({
      ok: true,
      turns: 3,
      apiMs: 3365,
      input: 6,
      output: 230,
      thinking: 40,
      cacheRead: 20338,
      cacheWrite: 34293,
      models: [{ model: "claude-sonnet-5-5", input: 6, output: 230, cacheRead: 20338, cacheWrite: 34293 }],
      structured: { summary: "Rewrote it", confidence: 0.85 },
    });
  });

  it("marks an errored result as not ok", () => {
    expect(parseJobLog(line({ type: "result", subtype: "error_max_turns", is_error: true })).result?.ok).toBe(false);
  });
});

describe("transcript usage", () => {
  it("counts each reply once per message id, per model, and finds the time span", () => {
    const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 };
    const jsonl = [
      line({ type: "user", timestamp: "2026-11-01T10:00:00Z", message: { content: "hi" } }),
      // One streamed reply written as two lines sharing an id and usage.
      line({ type: "assistant", timestamp: "2026-11-01T10:00:05Z", message: { id: "m1", model: "claude-opus-5-5", usage } }),
      line({ type: "assistant", timestamp: "2026-11-01T10:00:06Z", message: { id: "m1", model: "claude-opus-5-5", usage } }),
      line({ type: "assistant", timestamp: "2026-11-01T10:01:00Z", message: { id: "m2", model: "claude-haiku-5-5", usage } }),
      line({ type: "assistant", message: { id: "m3", model: "<synthetic>", usage } }),
    ].join("\n");
    const u = transcriptUsage(jsonl);
    expect(u.calls).toBe(2);
    expect(u.models).toEqual([
      { model: "claude-opus-5-5", input: 10, output: 100, cacheRead: 1000, cacheWrite: 500 },
      { model: "claude-haiku-5-5", input: 10, output: 100, cacheRead: 1000, cacheWrite: 500 },
    ]);
    expect(u.lastAt! - u.firstAt!).toBe(60_000);
  });
});
