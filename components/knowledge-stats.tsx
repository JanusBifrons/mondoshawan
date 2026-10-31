import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OriginIcon, since } from "@/components/knowledge-utils";
import type { KnowledgeSource } from "@/lib/knowledge";

/** Small summary cards: one per group (project or source), with counts and last update. */
export function KnowledgeStats({
  sources,
  groupBy,
}: {
  sources: KnowledgeSource[];
  groupBy: "project" | "origin";
}) {
  const groups = new Map<string, KnowledgeSource[]>();
  for (const s of sources) {
    const k = groupBy === "project" ? s.project : s.originLabel;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[...groups.entries()].map(([name, items]) => {
        const latest = items.reduce<string | null>((a, s) => (s.modified && (!a || s.modified > a) ? s.modified : a), null);
        const origins = [...new Set(items.map((s) => s.originLabel))];
        const card = (
          <Card className="gap-2 py-4 transition-colors hover:bg-accent/40">
            <CardHeader className="px-4">
              <CardDescription className="flex items-center gap-1.5">
                {groupBy === "origin" && <OriginIcon origin={items[0].origin} />}
                {name}
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums">{items.length}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 text-xs text-muted-foreground">
              {groupBy === "project" ? origins.join(" · ") : "sources"} · updated {since(latest)}
            </CardContent>
          </Card>
        );
        return groupBy === "project" ? (
          <Link key={name} href={`/knowledge/${items[0].projectSlug}`}>
            {card}
          </Link>
        ) : (
          <div key={name}>{card}</div>
        );
      })}
    </div>
  );
}
