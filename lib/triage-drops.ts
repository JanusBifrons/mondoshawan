/** Reading a "Check the questions" result (client-safe: no server imports). */

export interface TriageDrop {
  question: number;
  /** Why it should go: micro detail, already answered (where), not a real decision, duplicate... */
  reason: string;
  /** The note to record when it's dismissed (e.g. "Already decided: a broke pilot gets a free ship. See [[Respawning]]."). */
  answer: string;
}

/** The drops from a finished triage job, ignoring anything malformed. Pure. */
export function triageDrops(result: Record<string, unknown> | null): TriageDrop[] {
  const list = Array.isArray(result?.drop) ? result.drop : [];
  return list.flatMap((d) => {
    if (!d || typeof d !== "object") return [];
    const x = d as Record<string, unknown>;
    const q = typeof x.question === "number" ? x.question : Number(x.question);
    return Number.isInteger(q) && q > 0 ? [{ question: q, reason: String(x.reason ?? ""), answer: String(x.answer ?? "") }] : [];
  });
}
