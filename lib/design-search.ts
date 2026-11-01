import type { DB } from "./db";

/**
 * Search everything recorded about a project's design: node titles and summaries, the latest
 * Intent and Reality, every question with its answer (open or closed), and what the owner said in
 * design talks. Agents use it (design CLI `search`) before asking anything, so they don't ask what
 * the owner already answered: once, an owner's answer given in one talk was asked for again in another.
 */

export interface SearchHit {
  kind: "node" | "intent" | "reality" | "question" | "owner said";
  /** Node it belongs to (title path), when there is one. */
  node: string | null;
  nodeId: string | null;
  /** The matching text, trimmed around the first match. */
  snippet: string;
  /** For questions: open / answered / dismissed / accepted. For talks: the talk id. */
  detail: string | null;
  at: number;
}

const terms = (q: string) =>
  q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);

/** All terms present (case-insensitive). Pure. */
export function matchesAll(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}

/** A short piece of `text` around the first term found. Pure. */
export function snippetAround(text: string, words: string[], width = 280): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const low = flat.toLowerCase();
  const at = Math.min(...words.map((w) => low.indexOf(w)).filter((i) => i >= 0), flat.length);
  const start = Math.max(0, at - Math.floor(width / 3));
  const s = flat.slice(start, start + width);
  return (start > 0 ? "…" : "") + s + (start + width < flat.length ? "…" : "");
}

export function searchDesign(db: DB, project: string, query: string, limit = 25): SearchHit[] {
  const words = terms(query);
  if (!words.length) return [];
  const like = `%${words[0]}%`;

  // Node paths for labelling hits.
  const nodes = db.prepare("SELECT id, parent_id, title, summary, updated_at FROM design_nodes WHERE project = ?").all(project) as {
    id: string;
    parent_id: string | null;
    title: string;
    summary: string | null;
    updated_at: number;
  }[];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pathOf = (id: string | null) => {
    if (!id) return null;
    const parts: string[] = [];
    let cur = byId.get(id);
    for (let g = 0; cur && g < 50; g++) {
      parts.unshift(cur.title);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return parts.join("/");
  };

  const hits: SearchHit[] = [];
  for (const n of nodes) {
    const text = `${n.title}. ${n.summary ?? ""}`;
    if (matchesAll(text, words)) hits.push({ kind: "node", node: pathOf(n.id), nodeId: n.id, snippet: snippetAround(text, words), detail: null, at: n.updated_at });
  }

  const revs = db
    .prepare(
      `SELECT r.node_id, r.field, r.text, r.created_at FROM design_revisions r JOIN design_nodes n ON n.id = r.node_id
       WHERE n.project = ? AND lower(r.text) LIKE ?
         AND r.id = (SELECT MAX(id) FROM design_revisions WHERE node_id = r.node_id AND field = r.field)`,
    )
    .all(project, like) as { node_id: string; field: "intent" | "reality"; text: string; created_at: number }[];
  for (const r of revs) {
    if (matchesAll(r.text, words)) hits.push({ kind: r.field, node: pathOf(r.node_id), nodeId: r.node_id, snippet: snippetAround(r.text, words), detail: null, at: r.created_at });
  }

  const qs = db
    .prepare(
      `SELECT q.node_id, q.text, q.answer, q.status, q.created_at FROM design_questions q JOIN design_nodes n ON n.id = q.node_id
       WHERE n.project = ? AND (lower(q.text) LIKE ? OR lower(coalesce(q.answer, '')) LIKE ?)`,
    )
    .all(project, like, like) as { node_id: string; text: string; answer: string | null; status: string; created_at: number }[];
  for (const q of qs) {
    const text = `Q: ${q.text}${q.answer ? ` A: ${q.answer}` : ""}`;
    if (matchesAll(text, words)) hits.push({ kind: "question", node: pathOf(q.node_id), nodeId: q.node_id, snippet: snippetAround(text, words, 500), detail: q.status, at: q.created_at });
  }

  // The owner's own words in design talks (not Mondo's automatic notes).
  const said = db
    .prepare(
      `SELECT tt.text, tt.created_at, t.id AS talk, t.node_id FROM design_talk_turns tt JOIN design_talks t ON t.id = tt.talk_id
       WHERE t.project = ? AND tt.auto = 0 AND lower(tt.text) LIKE ?`,
    )
    .all(project, like) as { text: string; created_at: number; talk: string; node_id: string | null }[];
  for (const s of said) {
    if (matchesAll(s.text, words)) hits.push({ kind: "owner said", node: pathOf(s.node_id), nodeId: s.node_id, snippet: snippetAround(s.text, words, 600), detail: `talk ${s.talk}`, at: s.created_at });
  }

  // The owner's words and decisions first, then the newest.
  const rank: Record<SearchHit["kind"], number> = { "owner said": 0, question: 1, intent: 2, reality: 3, node: 4 };
  return hits.sort((a, b) => rank[a.kind] - rank[b.kind] || b.at - a.at).slice(0, limit);
}
