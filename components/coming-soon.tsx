import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="p-4 md:p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}
