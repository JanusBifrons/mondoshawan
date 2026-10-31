import { MondoMark } from "@/components/elements";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} kicker="Coming soon" />
      <div className="p-4 md:p-6">
        <Card className="max-w-xl flex-row items-center gap-5 px-6 py-6">
          <MondoMark className="size-14 shrink-0 opacity-70" />
          <div className="space-y-1.5">
            <div className="readout">Status: in transit</div>
            <p className="display text-sm font-bold text-leeloo">Not landed yet</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </Card>
      </div>
    </>
  );
}
