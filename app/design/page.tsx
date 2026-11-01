import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { loadConfig, projectSlug } from "@/lib/config";
import { getDb } from "@/lib/db";
import { bandOf, gaps, listTree } from "@/lib/design";

export const dynamic = "force-dynamic";

/** Every project's design bible at a glance. */
export default function DesignPage() {
  const db = getDb();
  const projects = loadConfig().projects.map((p) => {
    const tree = listTree(db, p.name).filter((n) => n.stage !== "retired");
    const g = gaps(tree);
    return {
      name: p.name,
      slug: projectSlug(p.name),
      sky: tree.filter((n) => bandOf(n.stage) === "sky").length,
      grey: tree.filter((n) => bandOf(n.stage) === "grey").length,
      ground: tree.filter((n) => bandOf(n.stage) === "ground").length,
      attention: g.openReviews.length + g.drifted.length + g.blocking.length + g.flagged.length,
    };
  });

  return (
    <>
      <PageHeader title="Design bible" kicker="All projects" />
      <div className="space-y-6 p-4 md:p-6">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Each project&apos;s living design, from what the game does today (ground, written by agents from the code) through
          what&apos;s approved and being built (the grey zone) up to ideas (sky).
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.slug} href={`/design/${p.slug}`} className="frame block rounded-lg border bg-card/60 p-4 transition-colors hover:border-leeloo">
              <div className="display font-bold text-leeloo">{p.name}</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(
                  [
                    ["Sky", p.sky],
                    ["Grey zone", p.grey],
                    ["Ground", p.ground],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label}>
                    <div className="readout">{label}</div>
                    <div className="display text-lg">{n}</div>
                  </div>
                ))}
              </div>
              {p.attention > 0 && (
                <div className="mt-3 flex items-center gap-2 text-sm text-taxi">
                  <span className="hazard h-3 w-6 rounded-sm" /> {p.attention} need{p.attention === 1 ? "s" : ""} you
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
