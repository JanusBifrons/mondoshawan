import { headers } from "next/headers";
import QRCode from "qrcode";
import { CheckCircle2, CircleAlert, Cloud, Smartphone, XCircle } from "lucide-react";
import { remoteInfo } from "@/lib/remote";
import { listApproved } from "@/lib/devices";
import { DeviceList } from "@/components/device-list";
import { getDb } from "@/lib/db";
import { lastDriveSync, listDriveFiles } from "@/lib/drive";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { configPath, loadConfig } from "@/lib/config";
import { getHookStatus } from "@/lib/hook-status";
import { checkProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { server, projects: registered } = loadConfig();
  const db = getDb();
  const drive = registered.map((p) => ({
    project: p.name,
    folder: p.knowledge?.drive?.folder ?? null,
    last: lastDriveSync(db, p.name),
    count: listDriveFiles(db, p.name).length,
  }));
  const hooks = getHookStatus();
  const projects = await checkProjects();
  // Set by the LAN gateway: the viewer is on a phone, so don't show the access token.
  const remote = (await headers()).get("x-mondo-remote") === "1";
  const allHooks = hooks.events.every((e) => e.installed);
  const someHooks = hooks.events.some((e) => e.installed);

  return (
    <>
      <PageHeader title="Settings" kicker="Control room" />
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Claude Code hooks
              {allHooks ? (
                <Badge variant="secondary" className="text-earth">
                  <CheckCircle2 /> Installed
                </Badge>
              ) : someHooks ? (
                <Badge variant="secondary" className="text-taxi">
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

        <PhoneAccess remote={remote} />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="size-4" /> Google Drive
            </CardTitle>
            <CardDescription>
              Each project can mirror one Drive folder. A Claude session syncs it through the Google Drive connector:
              ask Claude to <span className="font-medium text-foreground">&ldquo;sync Drive&rdquo;</span> (or run{" "}
              <code className="rounded bg-muted px-1">/drive-sync</code>) in the Mondo repo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Drive folder</TableHead>
                  <TableHead>Last sync</TableHead>
                  <TableHead className="text-right">Docs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drive.map((d) => (
                  <TableRow key={d.project}>
                    <TableCell className="font-medium">{d.project}</TableCell>
                    <TableCell>{d.folder ?? <span className="text-muted-foreground">not set</span>}</TableCell>
                    <TableCell>
                      {!d.last ? (
                        <span className="text-muted-foreground">{d.folder ? "never" : "—"}</span>
                      ) : d.last.error ? (
                        <span className="text-destructive" title={d.last.error}>
                          failed {new Date(d.last.startedAt).toLocaleString("en-GB")}
                        </span>
                      ) : (
                        <span title={`${d.last.filesChanged} changed, ${d.last.filesRemoved} removed`}>
                          {new Date(d.last.startedAt).toLocaleString("en-GB")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{d.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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

/** LAN gateway status, the pairing QR code (this PC only) and the approved phones. */
async function PhoneAccess({ remote }: { remote: boolean }) {
  const info = remoteInfo();
  const url = info.urls[0];
  const pairUrl = url && !remote ? url : null;
  const qr = pairUrl && info.enabled
    ? await QRCode.toString(pairUrl, { type: "svg", margin: 1, color: { dark: "#000000", light: "#ffffff" } })
    : null;
  const devices = listApproved();

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4" /> Phone access
          {info.enabled ? (
            <Badge variant="secondary" className="text-earth">
              <CheckCircle2 /> On
            </Badge>
          ) : (
            <Badge variant="secondary">Off</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Phones on your network reach Mondo through a gateway on port {info.port}. Each phone must be approved here on
          the PC before it can see or do anything. Mondo itself stays on this PC only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!info.enabled ? (
          <p className="text-muted-foreground">
            Turn it on with <code className="rounded bg-muted px-1">&quot;lan&quot;: {"{"} &quot;enabled&quot;: true {"}"}</code>{" "}
            under <code className="rounded bg-muted px-1">server</code> in mondo.config.json, then restart Mondo. Windows
            will ask to let it through the firewall.
          </p>
        ) : remote ? (
          <p className="text-muted-foreground">You&apos;re using Mondo from an approved device.</p>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {qr && (
              <div
                className="w-44 shrink-0 overflow-hidden rounded-md bg-white p-1"
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            )}
            <div className="min-w-0 space-y-2">
              <p>
                Open this address on your phone (or scan the code), tap <b>Request access</b>, then click <b>Allow</b>{" "}
                in this window if the 4-digit codes match. Approved phones stay signed in until you revoke them.
              </p>
              <div className="space-y-1">
                {info.urls.map((u) => (
                  <code key={u} className="block break-all">
                    {u}
                  </code>
                ))}
                {info.urls.length === 0 && <p className="text-taxi">No network address found.</p>}
              </div>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <h3 className="readout">Approved devices</h3>
          <DeviceList devices={devices} canRevoke={!remote} />
        </div>
      </CardContent>
    </Card>
  );
}
