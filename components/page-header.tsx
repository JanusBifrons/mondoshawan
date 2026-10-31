import { Clock } from "@/components/clock";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Top bar for every page: sidebar toggle, wide title over an orange beam, a live clock. */
export function PageHeader({
  title,
  kicker,
  children,
}: {
  title: React.ReactNode;
  /** Small brass label above the title, e.g. "Monitor". */
  kicker?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 shrink-0 bg-background/80 backdrop-blur-md">
      <div className="flex h-16 items-center gap-3 px-4 md:px-6">
        <SidebarTrigger className="-ml-1 text-brass hover:text-leeloo" />
        <div className="min-w-0">
          {kicker && <div className="readout leading-none">{kicker}</div>}
          <h1 className="display glow truncate text-base font-bold md:text-lg">{title}</h1>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {children}
          <Clock />
        </div>
      </div>
      <div className="beam" />
    </header>
  );
}
