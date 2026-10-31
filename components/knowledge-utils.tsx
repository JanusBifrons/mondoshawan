import { Cloud, Folder, GitBranch, Link2 } from "lucide-react";
import type { KnowledgeSource } from "@/lib/knowledge";
import { cn } from "@/lib/utils";

/** "today", "3d ago", or a date for anything older than a month. */
export function since(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d < 1) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function OriginIcon({ origin, className }: { origin: KnowledgeSource["origin"]; className?: string }) {
  const Icon = { repo: GitBranch, folder: Folder, drive: Cloud, link: Link2 }[origin];
  return <Icon className={cn("size-3.5 shrink-0", className)} />;
}
