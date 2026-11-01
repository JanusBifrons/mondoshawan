"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PendingDevice } from "@/lib/devices";

/**
 * "Allow this phone?" Shown on every page of the PC's Mondo window (never on a phone)
 * while a device is waiting. The gateway writes requests straight to the database, so we poll.
 */
export function PairingPrompt() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/remote/devices", { cache: "no-store" });
        if (r.ok && !stopped) setPending((await r.json()).pending);
      } catch {
        /* server restarting */
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (pending.length) document.title = `Allow phone? · Mondo`;
  }, [pending.length]);

  const decide = async (id: string, action: "approve" | "deny") => {
    setBusy(id);
    await fetch(`/api/remote/devices/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
    setPending((p) => p.filter((d) => d.id !== id));
    setBusy(null);
    router.refresh();
  };

  if (!pending.length) return null;
  return (
    <div className="fixed inset-x-4 bottom-4 z-50 space-y-2 sm:left-auto sm:w-96">
      {pending.map((d) => (
        <Card key={d.id} className="glow-box gap-3 px-4 pt-5">
          <div className="hazard absolute inset-x-0 top-0 h-1.5" />
          <div className="flex items-start gap-3">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-taxi" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">A device wants to use Mondo</p>
              <p className="readout normal-case">
                {d.name}
                {d.ip ? ` · ${d.ip.replace(/^::ffff:/, "")}` : ""}
              </p>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            Allow only if your phone shows this code:
            <div className="mt-1 font-mono text-3xl tracking-[0.35em] text-taxi">{d.code}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={busy === d.id} onClick={() => decide(d.id, "deny")}>
              <X /> Deny
            </Button>
            <Button className="flex-1" disabled={busy === d.id} onClick={() => decide(d.id, "approve")}>
              <Check /> Allow
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
