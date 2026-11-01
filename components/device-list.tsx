"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApprovedDevice } from "@/lib/devices";

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never");

/** Approved phones, each with a Revoke button (this PC only). */
export function DeviceList({ devices, canRevoke }: { devices: ApprovedDevice[]; canRevoke: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const revoke = async (d: ApprovedDevice) => {
    if (!confirm(`Sign out ${d.name}? It will need approving again.`)) return;
    setBusy(d.id);
    await fetch(`/api/remote/devices/${encodeURIComponent(d.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke" }),
    }).catch(() => {});
    setBusy(null);
    router.refresh();
  };

  if (!devices.length) return <p className="text-muted-foreground">No devices approved yet.</p>;
  return (
    <ul className="divide-y divide-brass/20 rounded-md border border-brass/20">
      {devices.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3 py-2">
          <Smartphone className="size-4 shrink-0 text-brass" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{d.name}</div>
            <div className="readout truncate normal-case">
              Approved {when(d.approvedAt)} · last used {when(d.lastSeen)}
            </div>
          </div>
          {canRevoke && (
            <Button size="sm" variant="outline" className="hover:text-destructive" disabled={busy === d.id} onClick={() => revoke(d)}>
              Revoke
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
