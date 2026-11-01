/**
 * Links between design nodes inside design text (client-safe, no db). Write `[[Sectors]]`,
 * `[[Galaxy map/Sectors|sectors]]`, or a normal Markdown link to `node:<id or title path>`.
 */

export interface LinkableNode {
  id: string;
  parentId: string | null;
  title: string;
}

/** Find a node by id, title path ("Galaxy map/Sectors"), or the end of one if unique ("Sectors"). */
export function findNodeRef<T extends LinkableNode>(tree: T[], ref: string): T | null {
  const r = ref.trim();
  const byId = tree.find((n) => n.id === r);
  if (byId) return byId;
  const want = r.split("/").map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (!want.length) return null;
  const byIdMap = new Map(tree.map((n) => [n.id, n]));
  const pathOf = (n: T) => {
    const parts = [n.title.toLowerCase()];
    let cur = n.parentId ? byIdMap.get(n.parentId) : undefined;
    for (let g = 0; cur && g < 50; g++) {
      parts.unshift(cur.title.toLowerCase());
      cur = cur.parentId ? byIdMap.get(cur.parentId) : undefined;
    }
    return parts;
  };
  const hits = tree.filter((n) => {
    const p = pathOf(n);
    return p.length >= want.length && want.every((w, i) => p[p.length - want.length + i] === w);
  });
  if (hits.length === 1) return hits[0];
  // Ambiguous ending: accept only an exact full path.
  return hits.find((n) => pathOf(n).length === want.length) ?? null;
}

/** [[Ref]] and [[Ref|label]] become [label](node:Ref). */
export function wikiLinks(md: string): string {
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, ref: string, label?: string) => {
    const text = (label ?? ref.split("/").pop() ?? ref).trim();
    return `[${text}](node:${encodeURI(ref.trim())})`;
  });
}
