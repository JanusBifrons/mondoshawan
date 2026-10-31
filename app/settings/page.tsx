import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { configPath, loadConfig } from "@/lib/config";
import { getHookStatus } from "@/lib/hook-status";
import { checkProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { server } = loadConfig();
  const hooks = getHookStatus();
  const projects = await checkProjects();
  const allHooks = hooks.events.every((e) => e.installed);
  const someHooks = hooks.events.some((e) => e.installed);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Claude Code hooks
              {allHooks ? (
                <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 /> Installed
                </Badge>
              ) : someHooks ? (
                <Badge variant="secondary" className="text-amber-700 dark:text-amber-400">
                  <CircleAlert /> Partly installed
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle /> Not installed
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="break-all">
              {hooks.settingsFile}
              {!hooks.readable && " (not found or unreadable)"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {hooks.events.map((e) => (
                <Badge key={e.event} variant={e.installed ? "outline" : "destructive"}>
                  {e.installed ? <CheckCircle2 /> : <XCircle />}
                  {e.event}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Change with <code className="rounded bg-muted px-1">npm run hooks:install -- --apply</code> or{" "}
              <code className="rounded bg-muted px-1">npm run hooks:uninstall</code>. New Claude Code sessions pick
              up changes.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Server</CardTitle>
            <CardDescription className="break-all">{configPath()}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Address</span>
              <code>
                http://{server.host}:{server.port}
              </code>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Access</span>
              <span>{server.host === "127.0.0.1" || server.host === "localhost" ? "This PC only" : "Network"}</span>
            </div>
            <p className="pt-2 text-muted-foreground">
              Set <code className="rounded bg-muted px-1">MONDO_HOST</code> /{" "}
              <code className="rounded bg-muted px-1">MONDO_PORT</code> or edit the config file, then restart Mondo.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <CardDescription>Registered in mondo.config.json. Sessions are matched to these folders and their worktrees.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Worktrees</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium">
                      {p.name}
                      {!p.exists && (
                        <Badge variant="destructive" className="ml-2">
                          missing
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.path}</TableCell>
                    <TableCell className="font-mono text-xs">{p.branch ?? "—"}</TableCell>
                    <TableCell className="text-right">{p.worktrees.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
